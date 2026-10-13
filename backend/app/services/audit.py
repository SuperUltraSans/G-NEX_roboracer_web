import json
from datetime import datetime
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.models import AuditLog, Base, User

_HIDDEN_COLUMNS = {"password_hash"}


def snapshot(obj: Base) -> dict[str, Any]:
    """감사 로그용으로 행의 컬럼 값을 JSON 직렬화 가능한 dict 로 만든다."""
    data: dict[str, Any] = {}
    for attr in inspect(obj).mapper.column_attrs:
        if attr.key in _HIDDEN_COLUMNS:
            continue
        value = getattr(obj, attr.key)
        data[attr.key] = value.isoformat() if isinstance(value, datetime) else value
    return data


def _dump(value: dict[str, Any] | None) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False, default=str)


def record(
    db: Session,
    user: User | None,
    action: str,
    entity: str,
    entity_id: object,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """호출한 쪽의 트랜잭션 안에 감사 로그 행을 추가한다. 커밋은 호출한 쪽이 한다."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id),
            before_json=_dump(before),
            after_json=_dump(after),
        )
    )


def record_change(
    db: Session, user: User | None, action: str, obj: Base, before: dict[str, Any] | None
) -> None:
    """flush 후의 값을 after 로 남긴다 (id, version, updated_at 반영)."""
    db.flush()
    after = None if action == "delete" else snapshot(obj)
    record(db, user, action, obj.__tablename__, inspect(obj).identity[0], before, after)
