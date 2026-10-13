"""규칙 문서 패키지(ZIP: Markdown 문서 하나 + 그림)와 서버에 저장하는 그림 파일.

- 올리기: ZIP 을 검사하고, 문서 안의 그림 주소를 ZIP 안의 파일로 찾아 `/` + 패키지 경로
  (rules_refs.encode_path)로 바꾼 뒤 문서를 가져오고(rules_document.import_document), 쓰는
  그림만 RULES_DIR/files/<패키지 경로> 에 저장한다. 끝으로 어떤 섹션 본문(ko, en)도 쓰지 않는
  그림을 지운다.
- 패키지 루트: ZIP 안의 모든 파일이 한 폴더 안에 있으면(폴더를 통째로 압축한 경우, 노션) 그
  폴더가 루트다. 상대 주소는 문서가 있는 폴더 기준, / 로 시작하는 주소는 패키지 루트 기준이고,
  작성자 컴퓨터의 절대 경로는 뒷부분이 일치하는 파일로 찾는다 (rules_refs.PathIndex).
- 한 언어의 패키지가 다른 언어 본문이 쓰는 그림을 바꾸지 않는다: 같은 경로에 내용이 다른 그림이
  있으면 새 그림은 이름 뒤에 내용 해시 8자리를 붙여 저장한다 (image.png → image-1a2b3c4d.png).
- Markdown 문서만 올리면 그림 주소를 이미 저장된 그림으로 찾는다 (경로, 없으면 파일 이름).
"""

import hashlib
import io
import logging
import os
import re
import shutil
import stat
import tempfile
import threading
import unicodedata
import zipfile
import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.errors import AppError, invalid
from app.models import User
from app.services import rules_document
from app.services.rules_document import ImportCounts
from app.services.rules_markdown import (
    MAX_DOCUMENT_CHARS,
    Lang,
    filename,
    normalize_tables,
    parse_document,
)
from app.services.rules_refs import (
    ASSET_EXTENSIONS_TEXT,
    LocalPath,
    PathIndex,
    Resolution,
    RewriteResult,
    asset_type,
    referenced_paths,
    rewrite_references,
)

logger = logging.getLogger(__name__)

MB = 1024 * 1024
MAX_PACKAGE_BYTES = 50 * MB  # 요청 본문 (프론트와 리버스 프록시도 같은 한도)
MAX_UNCOMPRESSED_BYTES = 200 * MB
MAX_ENTRIES = 1000
MAX_MARKDOWN_BYTES = MAX_DOCUMENT_CHARS * 4
FILES_DIR = "files"

_IGNORED_NAMES = frozenset({".ds_store", "thumbs.db", "desktop.ini"})
_MARKDOWN_SUFFIXES = (".md", ".markdown")
_DRIVE_NAME = re.compile(r"^[A-Za-z]:")
_UTF8_NAMES = 0x800
_ENCRYPTED = 0x1
_LIST_LIMIT = 20
_CHUNK = 1 * MB

# 그림 파일을 바꾸는 작업(가져오기, 정리)은 한 번에 하나씩
_lock = threading.Lock()


def files_dir(rules_dir: Path) -> Path:
    return rules_dir / FILES_DIR


def payload_too_large() -> AppError:
    return AppError(
        413,
        "PAYLOAD_TOO_LARGE",
        f"ZIP 파일이 너무 큽니다. {MAX_PACKAGE_BYTES // MB}MB 이하로 줄여서 올리세요"
        " (그림 크기를 줄이거나 쓰지 않는 파일을 빼세요).",
    )


@dataclass
class ImportReport:
    counts: ImportCounts
    assets: int  # 올린 문서가 쓰는 그림 수
    warnings: list[str] = field(default_factory=list)


def _names(paths: list[str]) -> str:
    shown = ", ".join(paths[:_LIST_LIMIT])
    return shown if len(paths) <= _LIST_LIMIT else f"{shown} 외 {len(paths) - _LIST_LIMIT}개"


# ---- 저장된 그림 ----


def stored_file(rules_dir: Path, path: str) -> Path | None:
    """files/ 안의 그림 파일. 그림이 아니거나, 없거나, 폴더 밖을 가리키면 None."""
    path = unicodedata.normalize("NFC", path)
    if asset_type(path) is None:
        return None
    root = files_dir(rules_dir).resolve()
    try:
        candidate = (root / path).resolve()
    except (OSError, ValueError):
        return None
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


def stored_paths(rules_dir: Path) -> list[str]:
    root = files_dir(rules_dir)
    if not root.is_dir():
        return []
    return sorted(
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and not path.is_symlink() and asset_type(path.name)
    )


def _referenced(db: Session, langs: tuple[Lang, ...] = ("ko", "en")) -> set[str]:
    paths: set[str] = set()
    for section in rules_document.list_sections(db):
        for lang in langs:
            paths |= referenced_paths(section.body_ko if lang == "ko" else section.body_en)
    return paths


def prune(db: Session, rules_dir: Path) -> list[str]:
    """어떤 섹션 본문(ko, en)도 쓰지 않는 파일과 빈 폴더를 files/ 에서 지운다."""
    root = files_dir(rules_dir)
    if not root.is_dir():
        return []
    keep = _referenced(db)
    removed: list[str] = []
    # 깊은 경로부터: 파일을 지운 뒤 빈 폴더를 지운다
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink() or not path.is_dir():
            if relative not in keep:
                path.unlink()
                removed.append(relative)
        elif not any(path.iterdir()):
            path.rmdir()
    if removed:
        logger.info("쓰지 않는 규칙 그림 %d개를 지웠습니다", len(removed))
    return removed


def _finish(db: Session, rules_dir: Path) -> None:
    """커밋한 뒤: 문서 파일을 다시 쓰고 쓰지 않는 그림을 지운다. 실패해도 로그만 남긴다."""
    rules_document.write_documents_safely(db, rules_dir)
    try:
        prune(db, rules_dir)
    except Exception:
        logger.exception("쓰지 않는 규칙 그림을 %s 에서 지우지 못했습니다", files_dir(rules_dir))


# ---- Markdown 문서만 올리기 ----


def import_markdown(
    db: Session, actor: User | None, lang: Lang, markdown: str, rules_dir: Path
) -> ImportReport:
    """Markdown 문서를 가져오고 커밋한다. 그림 주소는 이미 저장된 그림으로 찾는다."""
    if len(markdown) > MAX_DOCUMENT_CHARS:
        parse_document(markdown)  # 길이 오류(422)를 낸다
    markdown = normalize_tables(markdown)
    with _lock:
        index = PathIndex(stored_paths(rules_dir))
        result = rewrite_references(markdown, lambda ref: index.find(ref))
        counts = rules_document.import_document(
            db, actor, lang, result.markdown, {"source": "markdown", "assets": len(result.paths)}
        )
        db.commit()
        _finish(db, rules_dir)
    return ImportReport(counts, len(result.paths), result.warnings)


# ---- ZIP 읽기 ----


def _entry_name(info: zipfile.ZipInfo) -> str:
    """UTF-8 표시가 없는 이름(윈도 압축 프로그램)은 UTF-8, 안 되면 CP949 로 다시 읽는다."""
    name = info.filename
    if not info.flag_bits & _UTF8_NAMES and name == info.orig_filename:
        raw = name.encode("cp437")
        for encoding in ("utf-8", "cp949"):
            try:
                name = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
    return unicodedata.normalize("NFC", name.replace("\\", "/"))


def _ignored(parts: list[str]) -> bool:
    name = parts[-1]
    return parts[0] == "__MACOSX" or name.casefold() in _IGNORED_NAMES or name.startswith("._")


def _clean_name(name: str) -> list[str]:
    """ZIP 항목 이름을 경로 조각으로. 루트 밖을 가리키거나 쓸 수 없는 이름이면 422."""
    if name.startswith("/") or _DRIVE_NAME.match(name) or ".." in name.split("/"):
        raise invalid(
            f"ZIP 안에 허용하지 않는 경로가 있습니다: {name}"
            " (절대 경로나 '..' 가 든 경로는 받지 않습니다). 폴더 안에서 다시 압축하세요."
        )
    if any(ord(char) < 32 or char == "\x7f" for char in name):
        raise invalid(f"ZIP 안에 제어 문자가 든 파일 이름이 있습니다: {name!r}")
    parts = [part for part in name.split("/") if part not in ("", ".")]
    for part in parts:
        if len(part.encode("utf-8")) > 255:
            raise invalid(f"ZIP 안의 파일 이름이 너무 깁니다: {part[:40]}…")
    return parts


@contextmanager
def _reading(name: str) -> Iterator[None]:
    try:
        yield
    except (zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise invalid(f"ZIP 안의 '{name}'을(를) 풀지 못했습니다(파일이 손상됨): {exc}") from exc
    except NotImplementedError as exc:
        raise invalid(
            f"ZIP 안의 '{name}'은(는) 지원하지 않는 압축 방식입니다. 일반(Deflate) ZIP 으로"
            " 다시 압축하세요."
        ) from exc


@dataclass
class _Package:
    archive: zipfile.ZipFile
    files: dict[str, zipfile.ZipInfo]  # 패키지 경로 → 항목 (무시할 파일, 폴더 제외)

    def read(self, path: str) -> bytes:
        with _reading(path), self.archive.open(self.files[path]) as source:
            return source.read()


def _strip_wrapper(files: dict[str, zipfile.ZipInfo]) -> dict[str, zipfile.ZipInfo]:
    """모든 파일이 한 폴더 안에 있으면 그 폴더를 루트로 삼는다 (여러 겹이면 모두 벗긴다)."""
    while files and all("/" in path for path in files):
        tops = {path.split("/", 1)[0] for path in files}
        if len(tops) != 1:
            break
        cut = len(tops.pop()) + 1
        files = {path[cut:]: info for path, info in files.items()}
    return files


def _open_package(data: bytes, *, nested: bool = False) -> _Package:
    if len(data) > MAX_PACKAGE_BYTES:
        raise payload_too_large()
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        infos = archive.infolist()
    except (zipfile.BadZipFile, NotImplementedError, ValueError, EOFError) as exc:
        raise invalid(
            "ZIP 파일로 읽을 수 없습니다. Markdown 문서와 그림을 ZIP 으로 압축해 올리세요."
        ) from exc
    if len(infos) > MAX_ENTRIES:
        raise invalid(
            f"ZIP 안의 항목이 너무 많습니다({len(infos):,}개). {MAX_ENTRIES:,}개 이하로 줄이세요."
        )
    total = sum(info.file_size for info in infos)
    if total > MAX_UNCOMPRESSED_BYTES:
        raise invalid(
            f"ZIP 을 풀면 너무 큽니다({total / MB:,.0f}MB). 압축을 푼 크기가"
            f" {MAX_UNCOMPRESSED_BYTES // MB}MB 이하가 되게 줄이세요."
        )

    files: dict[str, zipfile.ZipInfo] = {}
    for info in infos:
        name = _entry_name(info)
        parts = _clean_name(name)
        if not parts or name.endswith("/"):
            continue  # 폴더
        path = "/".join(parts)
        if stat.S_ISLNK(info.external_attr >> 16):
            raise invalid(f"ZIP 안에 심볼릭 링크가 있습니다: {path}. 실제 파일로 바꿔 압축하세요.")
        if info.flag_bits & _ENCRYPTED:
            raise invalid(f"ZIP 안에 암호가 걸린 파일이 있습니다: {path}. 암호 없이 압축하세요.")
        if _ignored(parts):
            continue
        if path in files:
            raise invalid(f"ZIP 안에 같은 경로의 파일이 두 번 들어 있습니다: {path}")
        files[path] = info
    package = _Package(archive, _strip_wrapper(files))

    # 노션 내보내기처럼 ZIP 안에 ZIP 하나만 있으면 그 안을 읽는다 (한 겹만)
    inner = [path for path in package.files if path.lower().endswith(".zip")]
    has_markdown = any(path.lower().endswith(_MARKDOWN_SUFFIXES) for path in package.files)
    if not nested and not has_markdown and len(inner) == 1:
        return _open_package(package.read(inner[0]), nested=True)
    return package


def _pick_markdown(package: _Package, lang: Lang) -> tuple[str, str]:
    """(문서 경로, 문서 내용)."""
    found = sorted(path for path in package.files if path.lower().endswith(_MARKDOWN_SUFFIXES))
    if len(found) > 1:
        named = [path for path in found if path.rsplit("/", 1)[-1].lower() == filename(lang)]
        if len(named) != 1:
            raise invalid(
                f"ZIP 안에 Markdown 문서가 여러 개입니다({_names(found)})."
                f" 문서를 하나만 넣거나, 올릴 문서의 이름을 {filename(lang)} 로 바꾸세요."
            )
        found = named
    if not found:
        listing = f" 들어 있는 파일: {_names(sorted(package.files))}." if package.files else ""
        raise invalid(f"ZIP 안에 Markdown 문서(.md)가 없습니다.{listing}")
    path = found[0]
    if package.files[path].file_size > MAX_MARKDOWN_BYTES:
        raise invalid(
            f"문서 '{path}'가 너무 큽니다."
            f" 규칙 문서는 {MAX_DOCUMENT_CHARS:,}자까지 올릴 수 있습니다."
        )
    try:
        return path, package.read(path).decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise invalid(
            f"문서 '{path}'를 UTF-8 로 읽을 수 없습니다. 편집기에서 UTF-8 로 저장한 뒤 다시"
            " 압축하세요."
        ) from exc


# ---- ZIP 올리기 ----


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _stage(package: _Package, paths: list[str], staging: Path) -> dict[str, str]:
    """쓰는 그림을 임시 폴더에 풀고 경로별 sha256 을 돌려준다."""
    digests: dict[str, str] = {}
    for path in paths:
        target = staging / path
        digest = hashlib.sha256()
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with (
                _reading(path),
                package.archive.open(package.files[path]) as source,
                target.open("wb") as out,
            ):
                while chunk := source.read(_CHUNK):
                    digest.update(chunk)
                    out.write(chunk)
        except (NotADirectoryError, IsADirectoryError, FileExistsError) as exc:
            raise invalid(f"ZIP 안에 이름이 같은 파일과 폴더가 있습니다: {path}") from exc
        digests[path] = digest.hexdigest()
    return digests


def _stored_name(path: str, digest: str, protected: set[str], root: Path) -> str:
    """다른 언어 본문이 쓰는 같은 경로의 그림과 내용이 다르면 해시를 붙인 이름."""
    existing = root / path
    if path not in protected or not existing.is_file() or _sha256(existing) == digest:
        return path
    stem, _, ext = path.rpartition(".")
    return f"{stem}-{digest[:8]}.{ext}"


def _install(staging: Path, stored: dict[str, str], root: Path) -> None:
    for source, target in stored.items():
        destination = root / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        staged = staging / source
        os.chmod(staged, 0o644)
        os.replace(staged, destination)


def import_package(
    db: Session, actor: User | None, lang: Lang, data: bytes, rules_dir: Path
) -> ImportReport:
    """ZIP 패키지를 가져오고 커밋한다. 형식이 맞지 않으면 아무것도 바꾸지 않고 422."""
    package = _open_package(data)
    md_path, markdown = _pick_markdown(package, lang)
    markdown = normalize_tables(markdown)
    base = tuple(md_path.split("/")[:-1])
    index = PathIndex(package.files)

    def resolve(ref: LocalPath) -> Resolution:
        return index.find(ref, base)

    first = rewrite_references(markdown, resolve)
    parse_document(first.markdown)  # 형식 오류는 그림을 풀기 전에 알린다
    warnings = list(first.warnings)

    with _lock:
        root = files_dir(rules_dir)
        rules_dir.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".package-", dir=rules_dir))
        try:
            digests = _stage(package, first.paths, staging)
            protected = _referenced(db, ("en",) if lang == "ko" else ("ko",))
            stored = {
                path: _stored_name(path, digests[path], protected, root) for path in first.paths
            }
            final: RewriteResult = first
            if any(path != name for path, name in stored.items()):

                def renamed(ref: LocalPath) -> Resolution:
                    found = resolve(ref)
                    return Resolution(stored.get(found.path or "", found.path), found.ambiguous)

                final = rewrite_references(markdown, renamed)
                for path, name in stored.items():
                    if path != name:
                        warnings.append(
                            f"다른 언어 문서가 쓰는 같은 이름의 그림과 내용이 달라 {path} 를"
                            f" {name} 로 저장했습니다."
                        )
            counts = rules_document.import_document(
                db, actor, lang, final.markdown, {"source": "package", "assets": len(stored)}
            )
            _install(staging, stored, root)
            db.commit()
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        _finish(db, rules_dir)

    used = {md_path, *first.paths, *first.other_files}
    unused = [path for path in sorted(package.files) if path not in used]
    images = [path for path in unused if asset_type(path)]
    others = [path for path in unused if not asset_type(path)]
    if images:
        warnings.append(
            f"문서에서 쓰지 않는 그림이라 넣지 않았습니다({len(images)}개): {_names(images)}"
        )
    if others:
        warnings.append(
            f"그림({ASSET_EXTENSIONS_TEXT})이 아니라 건너뛴 파일({len(others)}개): {_names(others)}"
        )
    return ImportReport(counts, len(stored), warnings)


# ---- ZIP 내려받기 ----


def export_package(db: Session, lang: Lang, rules_dir: Path) -> bytes:
    """rules.<lang>.md 와 문서가 쓰는 그림을 패키지 경로에 담은 ZIP. 다시 올리면 그대로 돌아온다."""
    markdown = rules_document.render(rules_document.list_sections(db), lang)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(filename(lang), markdown)
        for path in sorted(referenced_paths(markdown)):
            if (file := stored_file(rules_dir, path)) is not None:
                # 그림은 이미 압축된 형식이라 다시 압축하지 않는다
                archive.write(file, path, compress_type=zipfile.ZIP_STORED)
    return buffer.getvalue()


def package_filename(lang: Lang) -> str:
    return f"rules.{lang}.zip"
