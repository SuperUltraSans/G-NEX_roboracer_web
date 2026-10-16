from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SiteSetting, User
from app.schemas.content import (
    PAGE_KEYS,
    AdminSettings,
    AdminSettingsUpdate,
    PageKey,
    PageState,
    PageStates,
)
from app.services import audit

# 이 키만 읽고 쓴다. DB 에 남은 다른 키(예: 예전의 design)는 무시한다.
KEYS = ("apply_form_url", "apply_open_at", "apply_close_at")
DATETIME_KEYS = {"apply_open_at", "apply_close_at"}
# 참/거짓 값: "1" 이면 참
FLAG_KEYS = ("apply_close_date_only",)
# 페이지 열림 상태: page_<페이지>_open ("0" 이면 닫힘, 없으면 열림), page_<페이지>_note_ko/en
PAGE_FIELDS = ("open", "note_ko", "note_en")


def _page_key(page: PageKey, field: str) -> str:
    return f"page_{page}_{field}"


def _read_pages(stored: dict[str, str]) -> PageStates:
    return PageStates.model_validate(
        {
            page: {
                "open": stored.get(_page_key(page, "open")) != "0",
                "note_ko": stored.get(_page_key(page, "note_ko")) or None,
                "note_en": stored.get(_page_key(page, "note_en")) or None,
            }
            for page in PAGE_KEYS
        }
    )


def read_settings(db: Session) -> AdminSettings:
    stored = {row.key: row.value for row in db.scalars(select(SiteSetting))}
    values: dict[str, object] = {}
    for key in KEYS:
        raw = stored.get(key) or None
        values[key] = datetime.fromisoformat(raw) if raw and key in DATETIME_KEYS else raw
    for key in FLAG_KEYS:
        values[key] = stored.get(key) == "1"
    values["pages"] = _read_pages(stored)
    return AdminSettings.model_validate(values)


def page_open(db: Session, page: PageKey) -> bool:
    row = db.get(SiteSetting, _page_key(page, "open"))
    return row is None or row.value != "0"


def _write(db: Session, key: str, text: str, actor: User | None) -> None:
    # actor 가 없으면 서버 명령으로 바꾼 것이다 (변경 이력에 "서버 명령으로 바뀜")
    user_id = actor.id if actor else None
    row = db.get(SiteSetting, key)
    if row is None:
        db.add(SiteSetting(key=key, value=text, updated_by=user_id))
    elif row.value != text:
        row.value = text
        row.updated_by = user_id


def write_settings(db: Session, body: AdminSettingsUpdate, actor: User | None) -> AdminSettings:
    before = read_settings(db).model_dump(mode="json")
    for key in KEYS:
        value = getattr(body, key)
        text = value.astimezone(UTC).isoformat() if isinstance(value, datetime) else (value or "")
        _write(db, key, text, actor)
    # 마감이 없으면 "날짜만" 표시도 의미가 없다
    date_only = body.apply_close_date_only and body.apply_close_at is not None
    _write(db, "apply_close_date_only", "1" if date_only else "", actor)
    db.flush()
    after = read_settings(db)
    audit.record(
        db, actor, "update", "site_settings", "apply", before, after.model_dump(mode="json")
    )
    return after


def write_pages(db: Session, body: PageStates, actor: User | None) -> AdminSettings:
    before = read_settings(db).pages.model_dump(mode="json")
    for page in PAGE_KEYS:
        state: PageState = getattr(body, page)
        _write(db, _page_key(page, "open"), "1" if state.open else "0", actor)
        _write(db, _page_key(page, "note_ko"), state.note_ko or "", actor)
        _write(db, _page_key(page, "note_en"), state.note_en or "", actor)
    db.flush()
    after = read_settings(db)
    audit.record(
        db, actor, "update", "site_settings", "pages", before, after.pages.model_dump(mode="json")
    )
    return after
