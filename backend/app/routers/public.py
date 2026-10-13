from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.auth import AppSettings
from app.db import DbSession
from app.errors import not_found
from app.models import RuleSection, ScheduleItem, Team
from app.routers.common import ERROR_RESPONSES, no_store
from app.schemas.competition import Bracket, Leaderboard, LiveState, TeamPublic
from app.schemas.content import PublicSettings, RuleSectionPublic, ScheduleItemPublic
from app.services.bracket import build_bracket
from app.services.leaderboard import build_leaderboard
from app.services.live_state import build_live_state
from app.services.rules_package import stored_file
from app.services.rules_refs import ASSET_TYPES, asset_type
from app.services.site_settings import read_settings

router = APIRouter(
    prefix="/api", tags=["public"], dependencies=[Depends(no_store)], responses=ERROR_RESPONSES
)


# 규칙 본문의 그림. no-store 대신 no-cache(ETag 로 다시 확인)를 쓰므로 라우터를 나눈다.
files_router = APIRouter(prefix="/api", tags=["public"], responses=ERROR_RESPONSES)


class HealthStatus(BaseModel):
    status: str


@router.get("/health", response_model=HealthStatus)
def health() -> HealthStatus:
    return HealthStatus(status="ok")


@router.get("/settings/public", response_model=PublicSettings)
def get_public_settings(db: DbSession, settings: AppSettings) -> PublicSettings:
    values = read_settings(db)
    return PublicSettings(**values.model_dump(), event_timezone=settings.event_timezone)


@router.get("/schedule", response_model=list[ScheduleItemPublic])
def get_public_schedule(db: DbSession) -> list[ScheduleItemPublic]:
    items = db.scalars(
        select(ScheduleItem)
        .where(ScheduleItem.is_published)
        .order_by(ScheduleItem.starts_at, ScheduleItem.sort_order, ScheduleItem.id)
    )
    return [ScheduleItemPublic.model_validate(item) for item in items]


@router.get("/rules", response_model=list[RuleSectionPublic])
def get_public_rules(db: DbSession) -> list[RuleSectionPublic]:
    sections = db.scalars(
        select(RuleSection)
        .where(RuleSection.is_published)
        .order_by(RuleSection.sort_order, RuleSection.id)
    )
    return [RuleSectionPublic.model_validate(section) for section in sections]


@router.get("/teams", response_model=list[TeamPublic])
def get_public_teams(db: DbSession) -> list[TeamPublic]:
    teams = db.scalars(select(Team).where(Team.is_active).order_by(Team.car_number))
    return [TeamPublic.model_validate(team) for team in teams]


@router.get("/qualifying/leaderboard", response_model=Leaderboard)
def get_leaderboard(db: DbSession) -> Leaderboard:
    return build_leaderboard(db)


@router.get("/bracket", response_model=Bracket)
def get_bracket(db: DbSession) -> Bracket:
    return build_bracket(db)


@router.get("/live/state", response_model=LiveState)
def get_live_state(db: DbSession) -> LiveState:
    return build_live_state(db)


_IMAGE_CONTENT = {
    media_type: {"schema": {"type": "string", "format": "binary"}}
    for media_type in sorted(set(ASSET_TYPES.values()))
}


@files_router.get(
    "/rules/files/{path:path}",
    response_class=FileResponse,
    responses={200: {"description": "그림 파일", "content": _IMAGE_CONTENT}},
)
def get_rule_file(path: str, settings: AppSettings) -> FileResponse:
    """규칙 본문이 `/경로` 로 가리키는 그림 (관리자가 올린 ZIP 에서 저장한 것)."""
    file = stored_file(settings.rules_dir, path)
    if file is None:
        raise not_found("그림")
    return FileResponse(
        file,
        media_type=asset_type(file.name),
        headers={"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"},
    )
