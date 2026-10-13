from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SiteSetting, User
from app.schemas.content import AdminSettings, AdminSettingsUpdate
from app.services import audit

# 이 키만 읽고 쓴다. DB 에 남은 다른 키(예: 예전의 design)는 무시한다.
KEYS = ("apply_form_url", "apply_open_at", "apply_close_at")
DATETIME_KEYS = {"apply_open_at", "apply_close_at"}


def read_settings(db: Session) -> AdminSettings:
    stored = {row.key: row.value for row in db.scalars(select(SiteSetting))}
    values: dict[str, str | datetime | None] = {}
    for key in KEYS:
        raw = stored.get(key) or None
        values[key] = datetime.fromisoformat(raw) if raw and key in DATETIME_KEYS else raw
    return AdminSettings.model_validate(values)


def write_settings(db: Session, body: AdminSettingsUpdate, actor: User) -> AdminSettings:
    before = read_settings(db).model_dump(mode="json")
    for key in KEYS:
        value = getattr(body, key)
        text = value.astimezone(UTC).isoformat() if isinstance(value, datetime) else (value or "")
        row = db.get(SiteSetting, key)
        if row is None:
            db.add(SiteSetting(key=key, value=text, updated_by=actor.id))
        elif row.value != text:
            row.value = text
            row.updated_by = actor.id
    db.flush()
    after = read_settings(db)
    audit.record(
        db, actor, "update", "site_settings", "apply", before, after.model_dump(mode="json")
    )
    return after
