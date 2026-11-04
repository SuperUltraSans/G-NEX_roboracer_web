"""게시: 일정·규칙·사이트 설정은 고쳐도 바로 공개되지 않는다.

관리자 화면에서 고친 내용(초안)은 미리보기로만 보이고, '게시'하면 그때의 공개 모습을
`published_content` 에 통째로 저장해 공개 API 가 그것을 내준다. 대회 기록(예선·본선·진행 상태·팀)은
실시간이어야 하므로 게시를 거치지 않는다. 모니터링 관리 비밀 값도 바로 적용한다.
"""

import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, get_args

from pydantic import BaseModel
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.models import PublishedContent, RuleSection, ScheduleItem, User, utcnow
from app.schemas.content import (
    PageKey,
    PublishResource,
    PublishState,
    RuleSectionPublic,
    ScheduleItemPublic,
)
from app.services import audit
from app.services.site_settings import read_settings

logger = logging.getLogger(__name__)

RESOURCES: tuple[PublishResource, ...] = get_args(PublishResource)


def draft_schedule(db: Session) -> list[ScheduleItemPublic]:
    items = db.scalars(
        select(ScheduleItem)
        .where(ScheduleItem.is_published)
        .order_by(ScheduleItem.starts_at, ScheduleItem.sort_order, ScheduleItem.id)
    )
    return [ScheduleItemPublic.model_validate(item) for item in items]


def draft_rules(db: Session) -> list[RuleSectionPublic]:
    sections = db.scalars(
        select(RuleSection)
        .where(RuleSection.is_published)
        .order_by(RuleSection.sort_order, RuleSection.id)
    )
    return [RuleSectionPublic.model_validate(section) for section in sections]


def draft_settings(db: Session) -> dict[str, Any]:
    """공개 설정(시간대 제외). 모니터링 관리 비밀 값은 절대 넣지 않는다."""
    return read_settings(db).model_dump(mode="json", exclude={"monitor_key"})


def _json(model: BaseModel) -> dict[str, Any]:
    """시각은 UTC 로 맞춰 적는다.

    같은 시각이 +09:00·Z 로 달리 적혀 '게시 전 변경'으로 보이지 않게 한다.
    """
    utc = {
        key: value.astimezone(UTC)
        for key, value in model
        if isinstance(value, datetime) and value.tzinfo is not None
    }
    return model.model_copy(update=utc).model_dump(mode="json")


_DRAFTS: dict[PublishResource, Callable[[Session], Any]] = {
    "schedule": lambda db: [_json(item) for item in draft_schedule(db)],
    "rules": lambda db: [_json(section) for section in draft_rules(db)],
    "settings": draft_settings,
}


def _draft(db: Session, resource: PublishResource) -> Any:
    return _DRAFTS[resource](db)


def _same(a: Any, b: Any) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _row(db: Session, resource: PublishResource) -> PublishedContent:
    """공개본. 아직 없으면(처음 배포한 직후 등) 지금 내용으로 만든다."""
    row = db.get(PublishedContent, resource)
    if row is None:
        row = PublishedContent(resource=resource, data=_draft(db, resource), published_at=utcnow())
        db.add(row)
        db.flush()
    return row


def published(db: Session, resource: PublishResource) -> Any:
    return _row(db, resource).data


def published_page_open(db: Session, page: PageKey) -> bool:
    pages = published(db, "settings").get("pages", {})
    return bool(pages.get(page, {}).get("open", True))


# 목록 공개본을 지금 형식으로 다시 읽는 모델 (예전에 게시한 공개본에 없는 칸은 기본값으로 채운다)
_ITEM_MODELS: dict[PublishResource, type[BaseModel]] = {
    "schedule": ScheduleItemPublic,
    "rules": RuleSectionPublic,
}


def _current_form(resource: PublishResource, data: Any) -> Any:
    """공개본을 지금 형식으로. 새 칸이 생겼다고 '게시 전 변경'으로 보이지 않게 한다."""
    model = _ITEM_MODELS.get(resource)
    if model is None:
        return data
    return [_json(model.model_validate(item)) for item in data]


def state(db: Session, resource: PublishResource) -> PublishState:
    row = _row(db, resource)
    user = db.get(User, row.published_by) if row.published_by else None
    return PublishState(
        resource=resource,
        pending=not _same(_current_form(resource, row.data), _draft(db, resource)),
        published_at=row.published_at,
        published_by=user.username if user else None,
    )


def publish(db: Session, resource: PublishResource, actor: User | None) -> PublishState:
    row = _row(db, resource)
    draft = _draft(db, resource)
    before = _summary(resource, row.data)
    row.data = draft
    row.published_at = utcnow()
    row.published_by = actor.id if actor else None
    db.flush()
    audit.record(
        db, actor, "publish", "published_content", resource, before, _summary(resource, draft)
    )
    return state(db, resource)


def _summary(resource: PublishResource, data: Any) -> dict[str, Any]:
    # 규칙 본문처럼 긴 내용은 변경 이력에 통째로 남기지 않는다
    if resource == "settings":
        return data
    return {"titles": [item["title_ko"] for item in data]}


def ensure_published(session_factory: Callable[[], Session]) -> None:
    """서버를 시작할 때 공개본이 없는 것을 지금 내용으로 만든다. 실패해도 시작은 한다."""
    try:
        with session_factory() as db:
            if not inspect(db.get_bind()).has_table(PublishedContent.__tablename__):
                return
            for resource in RESOURCES:
                _row(db, resource)
            db.commit()
    except Exception:
        logger.exception("공개본을 준비하지 못했습니다")
