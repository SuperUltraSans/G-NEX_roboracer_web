"""게시와 미리보기 (관리자). 고친 일정·규칙·사이트 설정은 '게시'해야 공개 사이트에 보인다."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.auth import AdminUser, AppSettings
from app.db import DbSession
from app.errors import not_found
from app.live.events import Events
from app.schemas.content import (
    PublicSettings,
    PublishResource,
    PublishState,
    RuleSectionPublic,
    ScheduleItemPublic,
)
from app.services import publishing
from app.services.rules_package import stored_file
from app.services.rules_refs import asset_type

router = APIRouter(tags=["publish"])


@router.get("/publish", response_model=list[PublishState])
def get_publish_states(_: AdminUser, db: DbSession) -> list[PublishState]:
    return [publishing.state(db, resource) for resource in publishing.RESOURCES]


@router.post("/publish/{resource}", response_model=PublishState)
def publish(
    resource: PublishResource, actor: AdminUser, db: DbSession, events: Events
) -> PublishState:
    """지금 고친 내용을 공개 사이트에 올린다."""
    result = publishing.publish(db, resource, actor)
    db.commit()
    events.content(resource)
    return result


# ---- 미리보기: 게시하면 공개 사이트에 보일 모습 (닫힌 페이지의 내용도 내준다) ----


@router.get("/preview/settings", response_model=PublicSettings)
def preview_settings(_: AdminUser, db: DbSession, settings: AppSettings) -> PublicSettings:
    return PublicSettings(**publishing.draft_settings(db), event_timezone=settings.event_timezone)


@router.get("/preview/schedule", response_model=list[ScheduleItemPublic])
def preview_schedule(_: AdminUser, db: DbSession) -> list[ScheduleItemPublic]:
    return publishing.draft_schedule(db)


@router.get("/preview/rules", response_model=list[RuleSectionPublic])
def preview_rules(_: AdminUser, db: DbSession) -> list[RuleSectionPublic]:
    return publishing.draft_rules(db)


@router.get("/preview/rules/files/{path:path}", response_class=FileResponse)
def preview_rule_file(path: str, _: AdminUser, settings: AppSettings) -> FileResponse:
    """규칙 그림 (미리보기·관리자 화면용). 규칙 페이지가 닫혀 있어도 보인다."""
    file = stored_file(settings.rules_dir, path)
    if file is None:
        raise not_found("그림")
    return FileResponse(
        file,
        media_type=asset_type(file.name),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
