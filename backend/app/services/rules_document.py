"""규칙 섹션(DB) ⇄ 서버의 Markdown 문서 (RULES_DIR/rules.ko.md, rules.en.md).

DB 가 원본이다. 웹에서 규칙을 바꿀 때마다 두 문서를 DB 내용으로 다시 쓰고, 문서를 올리면
(관리자 화면, `import-rules`) DB 에 반영한 뒤 다시 쓴다. 서버의 파일을 직접 고쳤다면
`import-rules` 로 DB 에 넣는다. 그 전에 웹에서 규칙을 바꾸거나 서버를 다시 시작하면 파일이
DB 내용으로 바뀌는데, 이때 바뀌기 전 파일은 `rules.<lang>.md.bak` 에 남는다.
문서 형식은 rules_markdown.py 에 있다.
"""

import logging
import os
import tempfile
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, sessionmaker

from app.errors import invalid
from app.models import RuleSection, User
from app.services import audit
from app.services.rules_markdown import (
    CHAPTER,
    DOCUMENT_TITLES,
    LANGS,
    DocumentSection,
    Lang,
    filename,
    parse_document,
    render_document,
)

logger = logging.getLogger(__name__)

# 동시에 들어온 변경 요청이 서로의 파일을 덮어쓰지 않게, DB 읽기부터 파일 쓰기까지 한 번에 하나씩
_write_lock = threading.Lock()


def list_sections(db: Session) -> list[RuleSection]:
    return list(db.scalars(select(RuleSection).order_by(RuleSection.sort_order, RuleSection.id)))


def _title(section: RuleSection, lang: Lang) -> str:
    # 영어 제목이 비어 있으면 화면처럼 한국어 제목을 쓴다. 본문은 대체하지 않는다:
    # 영어 본문이 비어 있어야 공개 화면이 한국어 본문으로 대체한다.
    return section.title_ko if lang == "ko" else (section.title_en or section.title_ko)


def render(sections: Sequence[RuleSection], lang: Lang) -> str:
    return render_document(
        DOCUMENT_TITLES[lang],
        (
            DocumentSection(
                title=_title(section, lang),
                body=section.body_ko if lang == "ko" else section.body_en,
                hidden=lang == "ko" and not section.is_published,
                level=section.level,
            )
            for section in sections
        ),
    )


# ---- 파일 ----


def _replace_file(path: Path, text: str) -> None:
    """같은 폴더의 임시 파일에 쓴 뒤 바꿔 끼운다. 내용이 같으면 건드리지 않는다."""
    data = text.encode("utf-8")
    try:
        current: bytes | None = path.read_bytes()
    except FileNotFoundError:
        current = None
    if current == data:
        return
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(tmp, 0o644)
        if current is not None:
            path.with_name(path.name + ".bak").write_bytes(current)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_documents(db: Session, rules_dir: Path) -> list[Path]:
    """DB 의 규칙 섹션으로 두 문서를 다시 쓰고 경로를 돌려준다."""
    with _write_lock:
        sections = list_sections(db)
        rules_dir.mkdir(parents=True, exist_ok=True)
        paths = [rules_dir / filename(lang) for lang in LANGS]
        for lang, path in zip(LANGS, paths, strict=True):
            _replace_file(path, render(sections, lang))
    return paths


def write_documents_safely(db: Session, rules_dir: Path) -> bool:
    """변경 요청이 커밋된 뒤에 부른다. 파일을 못 써도 요청은 성공으로 두고 로그만 남긴다."""
    try:
        write_documents(db, rules_dir)
    except Exception:
        logger.exception("규칙 문서를 %s 에 쓰지 못했습니다", rules_dir)
        return False
    return True


def sync_on_startup(session_factory: sessionmaker[Session], rules_dir: Path) -> None:
    """서버를 시작할 때 문서를 DB 와 맞춘다. 어떤 경우에도 시작을 막지 않는다."""
    try:
        with session_factory() as db:
            if not inspect(db.get_bind()).has_table(RuleSection.__tablename__):
                logger.warning("DB 가 아직 준비되지 않아 규칙 문서를 쓰지 않았습니다")
                return
            write_documents(db, rules_dir)
    except Exception:
        logger.exception("시작할 때 규칙 문서를 %s 에 쓰지 못했습니다", rules_dir)


# ---- 가져오기 ----


@dataclass
class ImportCounts:
    created: int = 0
    updated: int = 0
    deleted: int = 0


def _summary(sections: Sequence[RuleSection], lang: Lang) -> list[dict[str, Any]]:
    # 감사 로그에는 본문 전체 대신 id 와 제목만 남긴다
    return [{"id": section.id, "title": _title(section, lang)} for section in sections]


def _assign(section: RuleSection, actor: User | None, **values: Any) -> bool:
    """바뀐 값만 넣고 version 을 올린다. 바뀐 것이 없으면 False."""
    changed = {key: value for key, value in values.items() if getattr(section, key) != value}
    if not changed:
        return False
    for key, value in changed.items():
        setattr(section, key, value)
    section.updated_by = actor.id if actor else None
    section.bump_version()
    return True


def import_document(
    db: Session,
    actor: User | None,
    lang: Lang,
    markdown: str,
    audit_extra: dict[str, Any] | None = None,
) -> ImportCounts:
    """문서를 DB 에 반영한다 (커밋은 호출한 쪽이 한다). audit_extra 는 감사 로그에 더할 값.

    - ko: 문서의 i번째 섹션이 지금 i번째 섹션의 한국어 제목·본문·공개 여부를 바꾼다. 모자라면
      새로 만들고, 남는 섹션은 지운다. 영어 제목·본문은 같은 자리의 섹션에 그대로 남는다.
    - en: i번째 섹션의 영어 제목·본문만 바꾼다. 문서에 없는 뒤쪽 섹션은 영어 값을 비운다
      (공개 화면이 한국어로 대체). 섹션을 만들거나 지우지 않는다.
    """
    parsed = parse_document(markdown)
    sections = list_sections(db)
    before = _summary(sections, lang)
    actor_id = actor.id if actor else None
    counts = ImportCounts()

    if lang == "ko":
        for position, item in enumerate(parsed):
            values = {
                "title_ko": item.title,
                "body_ko": item.body,
                "is_published": not item.hidden,
                "level": item.level,
            }
            if position < len(sections):
                section = sections[position]
                section.sort_order = position
                if _assign(section, actor, **values):
                    counts.updated += 1
            else:
                db.add(
                    RuleSection(
                        **values, title_en="", body_en="", sort_order=position, updated_by=actor_id
                    )
                )
                counts.created += 1
        for section in sections[len(parsed) :]:
            db.delete(section)
            counts.deleted += 1
    else:
        if len(parsed) > len(sections):
            raise invalid(
                f"영어 문서의 섹션 수({len(parsed)})가 지금 규칙 섹션 수({len(sections)})보다"
                " 많습니다. 한국어 문서를 먼저 올리세요."
            )
        for position, (item, section) in enumerate(zip(parsed, sections, strict=False)):
            # 영어 문서는 한국어 문서와 장(#)·절(##) 구조가 같아야 같은 자리의 섹션에 들어간다
            if item.level != section.level:
                expected = "장(# 제목)" if section.level == CHAPTER else "절(## 제목)"
                raise invalid(
                    f'영어 문서의 {position + 1}번째 섹션 "{item.title}"은(는) {expected}이어야'
                    " 합니다. 한국어 문서와 같은 구조로 쓰세요(영어 문서를 내려받아 고치면 됩니다)."
                )
        for position, section in enumerate(sections):
            item = parsed[position] if position < len(parsed) else DocumentSection("", "")
            # 한국어와 같은 제목은 비워 둬야 나중에 한국어 제목을 고쳐도 영어 화면이 따라간다
            title_en = "" if item.title == section.title_ko else item.title
            if _assign(section, actor, title_en=title_en, body_en=item.body):
                counts.updated += 1

    db.flush()
    audit.record(
        db,
        actor,
        "import",
        "rule_sections",
        "*",
        {"lang": lang, "sections": before},
        {
            "lang": lang,
            "created": counts.created,
            "updated": counts.updated,
            "deleted": counts.deleted,
            "sections": _summary(list_sections(db), lang),
            **(audit_extra or {}),
        },
    )
    return counts
