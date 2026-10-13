"""규칙 Markdown 안의 그림·링크 주소를 찾고 바꾼다. DB 와 파일을 모르는 순수 함수만 둔다.

저장되는 본문의 그림 주소는 패키지 루트 기준 절대 경로다: `/` + 올린 ZIP 안의 경로
(예: `![QR](/images/qr.png)`). 서버는 그 파일을 `GET /api/rules/files/<경로>` 로 내준다.

주소를 Markdown 에 쓸 때는 퍼센트 인코딩을 쓴다 (encode_path). URL 경로에 그대로 둘 수 없는
ASCII 문자(공백, %, #, ?, 괄호, &, 따옴표 …)와 공백·제어 문자만 UTF-8 %XX 로 바꾸고, 한글 같은
나머지 글자는 그대로 둔다. 그래서 주소는 이미 올바른 URL 경로이고 CommonMark 가 그대로 읽는다.
"""

import contextlib
import html
import re
import string
import unicodedata
from bisect import bisect_right
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote, unquote

from app.services.rules_markdown import fenced_lines

# 공개로 내주는 그림 형식. SVG 는 같은 origin 에서 스크립트를 실행할 수 있어 받지 않는다.
ASSET_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
}
ASSET_EXTENSIONS_TEXT = "png, jpg, gif, webp, avif"


def asset_type(path: str) -> str | None:
    """그림 파일이면 Content-Type, 아니면 None."""
    dot = path.rfind(".")
    return ASSET_TYPES.get(path[dot:].lower()) if dot > path.rfind("/") else None


# ---- 경로 → Markdown 주소 ----

_SAFE_ASCII = frozenset(string.ascii_letters + string.digits + "-._~/!$*+,;:@")


def encode_path(path: str) -> str:
    """패키지 경로("images/내 그림.png")를 본문에 쓸 주소("/images/내%20그림.png")로 만든다."""
    out: list[str] = []
    for char in "/" + path:
        if char in _SAFE_ASCII:
            out.append(char)
        elif ord(char) < 128 or unicodedata.category(char)[0] in "CZ":
            out.append(quote(char, safe=""))
        else:
            out.append(char)
    return "".join(out)


# ---- Markdown 주소 → 경로 ----


@dataclass(frozen=True)
class LocalPath:
    """http:, data:, mailto: 같은 바깥 주소가 아닌 파일 경로를 조각으로 나눈 것."""

    parts: tuple[str, ...]
    absolute: bool  # /..., C:\..., \\server\..., file:///...
    rooted: bool  # / 하나로 시작한다 (패키지 루트 기준 경로가 될 수 있다)

    @property
    def name(self) -> str:
        return self.parts[-1]


_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")
_DRIVE = re.compile(r"^/?[A-Za-z][:|](?:[\\/]|$)")
_ESCAPE = re.compile(r"\\([!-/:-@\[-`{-~])")  # CommonMark 백슬래시 이스케이프 (ASCII 문장부호)
_ENTITY = re.compile(r"&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});")


def local_path(url: str, *, markdown: bool = True) -> LocalPath | None:
    """본문에 쓰인 주소를 파일 경로로 읽는다. 바깥 주소나 #앵커, 빈 주소면 None.

    file:// 주소, 백슬래시(윈도 경로), %XX, ?쿼리·#조각을 정리한다. markdown=False 는 HTML 속성 값.
    """
    url = url.strip()
    if not url or url.startswith("#"):
        return None
    windows = bool(_DRIVE.match(url)) or url.startswith("\\\\")
    url = _ENTITY.sub(lambda m: html.unescape(m[0]), url)
    if markdown and not windows:
        url = _ESCAPE.sub(r"\1", url)

    if url[:5].lower() == "file:":
        rest = url[5:]
        if rest.startswith("//"):
            host, _, rest = rest[2:].partition("/")
            rest = "/" + rest if host.lower() in ("", "localhost") else f"//{host}/{rest}"
        url = rest
    elif not windows and (_SCHEME.match(url) or url.startswith("//")):
        return None

    url = re.split(r"[?#]", url, maxsplit=1)[0]
    with contextlib.suppress(UnicodeDecodeError):  # UTF-8 이 아닌 %XX 는 그대로 둔다
        url = unquote(url, errors="strict")
    url = unicodedata.normalize("NFC", url.replace("\\", "/"))
    rooted = url.startswith("/") and not url.startswith("//") and not _DRIVE.match(url)
    absolute = url.startswith("/") or bool(_DRIVE.match(url))
    if drive := _DRIVE.match(url):
        url = url[drive.end() :]
    parts = tuple(part for part in url.split("/") if part not in ("", "."))
    if not parts or parts[-1] == "..":
        return None
    return LocalPath(parts, absolute, rooted)


def join(base: tuple[str, ...], parts: Iterable[str]) -> str | None:
    """base 폴더에서 parts 로 간 경로. 루트 밖으로 나가면 None."""
    out = list(base)
    for part in parts:
        if part == "..":
            if not out:
                return None
            out.pop()
        else:
            out.append(part)
    return "/".join(out) if out else None


# ---- 경로 찾기 ----


@dataclass(frozen=True)
class Resolution:
    path: str | None
    ambiguous: tuple[str, ...] = ()


class PathIndex:
    """올린 ZIP 이나 서버에 저장된 파일 목록에서 본문의 주소가 가리키는 파일을 찾는다.

    1. 상대 경로는 문서가 있는 폴더(base) 기준, / 로 시작하면 패키지 루트 기준
    2. 없으면(예: 작성자 컴퓨터의 절대 경로) 뒤쪽이 가장 길게 일치하는 파일
       (Users/kim/문서/images/qr.png → images/qr.png). 대소문자만 다르면 하나뿐일 때 쓴다.
    3. 그래도 없으면 파일 이름이 같은 파일이 하나뿐일 때 그 파일
    """

    def __init__(self, paths: Iterable[str]) -> None:
        self.paths = set(paths)
        self._folded: dict[str, list[str]] = defaultdict(list)
        self._names: dict[str, list[str]] = defaultdict(list)
        self._folded_names: dict[str, list[str]] = defaultdict(list)
        for path in sorted(self.paths):
            name = path.rsplit("/", 1)[-1]
            self._folded[path.casefold()].append(path)
            self._names[name].append(path)
            self._folded_names[name.casefold()].append(path)

    def find(self, ref: LocalPath, base: tuple[str, ...] = ()) -> Resolution:
        direct = join(() if ref.absolute else base, ref.parts)
        if direct in self.paths:
            return Resolution(direct)
        # .. 뒤쪽만 뒷부분 맞추기에 쓴다
        tail = ref.parts
        while ".." in tail:
            tail = tail[tail.index("..") + 1 :]
        for size in range(len(tail), 0, -1):
            suffix = "/".join(tail[-size:])
            if suffix in self.paths:
                return Resolution(suffix)
            folded = self._folded.get(suffix.casefold(), [])
            if len(folded) == 1:
                return Resolution(folded[0])
        exact = self._names.get(ref.name, [])
        folded_names = self._folded_names.get(ref.name.casefold(), [])
        for names in (exact, folded_names):
            if len(names) == 1:
                return Resolution(names[0])
            if len(names) > 1:
                return Resolution(None, tuple(names))
        return Resolution(None)


# ---- 본문에서 주소 찾기 ----

Kind = Literal["image", "link"]


@dataclass(frozen=True)
class Candidate:
    start: int  # 본문에서 주소가 차지한 범위 (<...> 이면 꺾쇠 포함)
    end: int
    url: str  # 꺾쇠를 뗀 주소


@dataclass(frozen=True)
class Reference:
    kind: Kind
    candidates: tuple[Candidate, ...]  # CommonMark 에 맞는 주소면 하나, 어긋나면 해석 후보 여럿
    strict: bool
    markdown: bool = True  # False 면 HTML <img src> 값


_BLANK_LINE = re.compile(r"\n[ \t]*(?=\n)")
_BACKTICKS = re.compile(r"`+")
_DEFINITION = re.compile(
    r"^ {0,3}\[(?!\^)(?:[^\]\\\n]|\\.)+\]:[ \t]*(?:\n[ \t]*)?(<[^<>\n]*>|\S+)", re.M
)
_IMG_SRC = re.compile(
    r"<img\b[^>]*?\bsrc[ \t\n]*=[ \t\n]*(?:\"([^\"]*)\"|'([^']*)'|([^\s\"'=<>`]+))", re.I
)
_TITLE_TAIL = re.compile(r"""[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\))[ \t]*$""")


def _escaped(text: str, index: int) -> bool:
    backslashes = 0
    while index - backslashes - 1 >= 0 and text[index - backslashes - 1] == "\\":
        backslashes += 1
    return backslashes % 2 == 1


def _mask_code(text: str) -> str:
    """코드 블록과 `코드` 를 같은 길이의 공백으로 가린다 (위치는 그대로)."""
    lines = text.split("\n")
    fenced = fenced_lines(lines)
    out = "\n".join(" " * len(line) if f else line for line, f in zip(lines, fenced, strict=True))
    pos = 0
    while run := _BACKTICKS.search(out, pos):
        if _escaped(out, run.start()):
            pos = run.start() + 1
            continue
        close = re.compile(rf"(?<!`)`{{{len(run[0])}}}(?!`)").search(out, run.end())
        if close is None or _BLANK_LINE.search(out, run.end(), close.start()):
            pos = run.end()
            continue
        out = out[: run.start()] + " " * (close.end() - run.start()) + out[close.end() :]
        pos = close.end()
    return out


def _opening_bracket(text: str, close: int, lower: int) -> int | None:
    """close 위치의 ] 와 짝이 되는 [ 의 위치. lower(문단 시작) 앞으로는 가지 않는다."""
    depth = 0
    for i in range(close - 1, lower - 1, -1):
        if text[i] not in "[]" or _escaped(text, i):
            continue
        if text[i] == "]":
            depth += 1
        elif depth:
            depth -= 1
        else:
            return i
    return None


def _skip_space(text: str, i: int) -> int:
    """공백과 줄바꿈 하나까지 건너뛴다."""
    newline = False
    while i < len(text) and text[i] in " \t\n":
        if text[i] == "\n":
            if newline:
                break
            newline = True
        i += 1
    return i


def _closes(text: str, i: int) -> bool:
    """주소 뒤에 (선택적인 제목과) 닫는 ) 가 오는지."""
    j = _skip_space(text, i)
    if j < len(text) and text[j] == ")":
        return True
    if j == i or j >= len(text) or text[j] not in "\"'(":
        return False
    closer = ")" if text[j] == "(" else text[j]
    k = j + 1
    while k < len(text) and not (text[k] == closer and not _escaped(text, k)):
        k += 1
    if k >= len(text) or _BLANK_LINE.search(text, j, k):
        return False
    k = _skip_space(text, k + 1)
    return k < len(text) and text[k] == ")"


def _destination(text: str, start: int) -> tuple[int, int, bool] | None:
    """`(` 바로 뒤 start 에서 CommonMark 링크 주소를 읽는다. (시작, 끝, 꺾쇠 여부)."""
    i = _skip_space(text, start)
    if i < len(text) and text[i] == "<":
        j = i + 1
        while j < len(text) and text[j] not in "<>\n":
            j += 2 if text[j] == "\\" else 1
        if j < len(text) and text[j] == ">" and _closes(text, j + 1):
            return i, j + 1, True
        return None
    depth = 0
    j = i
    while j < len(text):
        char = text[j]
        if char == "\\" and j + 1 < len(text):
            j += 2
            continue
        if char <= " " or char == "\x7f" or (char == ")" and depth == 0):
            break
        depth += {"(": 1, ")": -1}.get(char, 0)
        j += 1
    return (i, j, False) if _closes(text, j) else None


def _lenient(text: str, start: int) -> tuple[Candidate, ...]:
    """CommonMark 로는 주소가 아닌 경우(공백이 든 경로, 짝 없는 괄호)의 해석 후보.

    같은 줄의 ) 마다 그 앞까지를 주소로 본다. 끝에 "제목" 이 붙어 있으면 뗀 것도 넣는다.
    """
    line_end = text.find("\n", start)
    line_end = len(text) if line_end < 0 else line_end
    out: dict[Candidate, None] = {}
    for close in re.finditer(r"\)", text[start:line_end]):
        inner = text[start : start + close.start()]
        for value in (inner, _TITLE_TAIL.sub("", inner)):
            stripped = value.strip()
            if stripped:
                begin = start + len(value) - len(value.lstrip())
                out[Candidate(begin, begin + len(stripped), stripped)] = None
    return tuple(out)


def find_references(markdown: str) -> list[Reference]:
    """본문의 링크·그림 주소, 참조 정의([id]: 주소), HTML <img src> 를 찾는다.

    코드 블록과 `코드` 안은 보지 않는다.
    """
    text = _mask_code(markdown)
    paragraph_starts = [m.end() for m in _BLANK_LINE.finditer(text)]
    refs: list[Reference] = []
    for match in re.finditer(r"\]\(", text):
        close = match.start()
        if _escaped(text, close):
            continue
        before = bisect_right(paragraph_starts, close)
        lower = paragraph_starts[before - 1] if before else 0
        opening = _opening_bracket(text, close, lower)
        if opening is None:
            continue
        image = opening > 0 and text[opening - 1] == "!" and not _escaped(text, opening - 1)
        kind: Kind = "image" if image else "link"
        parsed = _destination(text, match.end())
        if parsed is not None:
            start, end, bracketed = parsed
            url = markdown[start + 1 : end - 1] if bracketed else markdown[start:end]
            refs.append(Reference(kind, (Candidate(start, end, url),), True))
        elif candidates := _lenient(markdown, match.end()):
            refs.append(Reference(kind, candidates, False))
    for match in _DEFINITION.finditer(text):
        start, end = match.span(1)
        raw = markdown[start:end]
        url = raw[1:-1] if raw.startswith("<") else raw
        refs.append(Reference("link", (Candidate(start, end, url),), True))
    for match in _IMG_SRC.finditer(text):
        group = next(g for g in (1, 2, 3) if match[g] is not None)
        start, end = match.span(group)
        refs.append(Reference("image", (Candidate(start, end, markdown[start:end]),), True, False))
    return sorted(refs, key=lambda ref: ref.candidates[0].start)


def referenced_paths(markdown: str) -> set[str]:
    """본문이 / 로 시작하는 주소로 가리키는 그림의 패키지 경로들 (그림 정리·내보내기용)."""
    paths: set[str] = set()
    for ref in find_references(markdown):
        if not ref.strict:
            continue
        local = local_path(ref.candidates[0].url, markdown=ref.markdown)
        path = join((), local.parts) if local is not None and local.rooted else None
        if path is not None and asset_type(path) is not None:
            paths.add(path)
    return paths


# ---- 주소 바꾸기 ----


@dataclass
class RewriteResult:
    markdown: str
    paths: list[str] = field(default_factory=list)  # 본문이 쓰는 그림 (찾은 순서, 중복 없음)
    warnings: list[str] = field(default_factory=list)
    other_files: list[str] = field(default_factory=list)  # 찾았지만 그림이 아니라 둔 파일


def _readable(url: str) -> str:
    """경고에 보일 주소. %XX 는 풀어서 작성자가 쓴 이름으로 보인다."""
    with contextlib.suppress(UnicodeDecodeError):
        return unquote(url, errors="strict")
    return url


def _has_extension(local: LocalPath) -> bool:
    return "." in local.name.strip(".")


def rewrite_references(markdown: str, resolve: Callable[[LocalPath], Resolution]) -> RewriteResult:
    """파일 경로 주소를 resolve 로 찾아 `/` + 패키지 경로(encode_path)로 바꾼다.

    찾지 못하거나 그림이 아닌 파일은 그대로 두고 경고를 남긴다. 바깥 주소는 건드리지 않는다.
    """
    replacements: list[tuple[int, int, str]] = []
    warnings: dict[str, None] = {}
    paths: dict[str, None] = {}
    others: dict[str, None] = {}
    for ref in find_references(markdown):
        found: tuple[Candidate, str] | None = None
        tried: list[tuple[Candidate, LocalPath]] = []
        ambiguous: tuple[str, ...] = ()
        for candidate in ref.candidates:
            local = local_path(candidate.url, markdown=ref.markdown)
            if local is None:
                continue
            tried.append((candidate, local))
            resolution = resolve(local)
            if resolution.path is not None:
                found = (candidate, resolution.path)
                break
            ambiguous = ambiguous or resolution.ambiguous
        if found is None:
            # 경고에는 확장자가 있는 첫 후보를 보인다 ("image (1).png" 를 "image (1" 로 보이지 않게)
            shown = next(((c, loc) for c, loc in tried if _has_extension(loc)), None)
            if shown is None and (ref.kind == "link" or not tried):
                continue  # 바깥 주소, 또는 확장자 없는 페이지 링크(/schedule 같은)
            candidate, _ = shown or tried[0]
            what = "그림" if ref.kind == "image" else "링크가 가리키는 파일"
            message = f"{what}을 찾지 못해 주소를 그대로 두었습니다: {_readable(candidate.url)}"
            if ambiguous:
                message += f" (이름이 같은 파일이 여러 개입니다: {', '.join(ambiguous[:5])})"
            warnings[message] = None
            continue
        candidate, path = found
        if asset_type(path) is None:
            others[path] = None
            kinds = ASSET_EXTENSIONS_TEXT
            warnings[f"그림 파일({kinds})이 아니라 넣지 않았습니다(주소는 그대로): {path}"] = None
            continue
        paths[path] = None
        replacements.append((candidate.start, candidate.end, encode_path(path)))

    text = markdown
    limit = len(text) + 1
    for start, end, value in sorted(replacements, reverse=True):
        if end <= limit:  # 겹치는 범위는 건너뛴다
            text = text[:start] + value + text[end:]
            limit = start
    return RewriteResult(text, list(paths), list(warnings), list(others))
