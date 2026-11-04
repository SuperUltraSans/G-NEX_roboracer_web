from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.auth import AppSettings
from app.db import DbSession
from app.errors import not_found, page_closed
from app.models import Team
from app.routers.common import ERROR_RESPONSES, no_store
from app.schemas.competition import Bracket, Leaderboard, LiveState, Results, TeamPublic
from app.schemas.content import PublicSettings, RuleSectionPublic, ScheduleItemPublic
from app.services.bracket import build_bracket
from app.services.leaderboard import build_leaderboard
from app.services.live_state import build_live_state
from app.services.publishing import published, published_page_open
from app.services.results import build_results
from app.services.rules_package import stored_file
from app.services.rules_refs import ASSET_TYPES, asset_type

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


# 일정·규칙·사이트 설정은 '게시'한 공개본을 내준다 (관리자가 고친 초안은 미리보기에서만 보인다)


@router.get("/settings/public", response_model=PublicSettings)
def get_public_settings(db: DbSession, settings: AppSettings) -> PublicSettings:
    # 공개본에는 모니터링 관리 비밀 값이 들어 있지 않다
    return PublicSettings(**published(db, "settings"), event_timezone=settings.event_timezone)


@router.get("/schedule", response_model=list[ScheduleItemPublic])
def get_public_schedule(db: DbSession) -> list[ScheduleItemPublic]:
    # 일정 페이지를 닫아 게시했으면 공개 목록도 내주지 않는다 (작업 중인 일정이 새지 않게)
    if not published_page_open(db, "schedule"):
        raise page_closed()
    return [ScheduleItemPublic.model_validate(item) for item in published(db, "schedule")]


@router.get("/rules", response_model=list[RuleSectionPublic])
def get_public_rules(db: DbSession) -> list[RuleSectionPublic]:
    if not published_page_open(db, "rules"):
        raise page_closed()
    return [RuleSectionPublic.model_validate(section) for section in published(db, "rules")]


@router.get("/teams", response_model=list[TeamPublic])
def get_public_teams(db: DbSession) -> list[TeamPublic]:
    teams = db.scalars(select(Team).where(Team.is_active).order_by(Team.id))
    return [TeamPublic.model_validate(team) for team in teams]


@router.get("/qualifying/leaderboard", response_model=Leaderboard)
def get_leaderboard(db: DbSession) -> Leaderboard:
    return build_leaderboard(db)


@router.get("/bracket", response_model=Bracket)
def get_bracket(db: DbSession) -> Bracket:
    return build_bracket(db)


@router.get("/results", response_model=Results)
def get_results(db: DbSession) -> Results:
    """대회 최종 순위와 시상 (공개 '결과' 페이지)."""
    return build_results(db)


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
def get_rule_file(path: str, settings: AppSettings, db: DbSession) -> FileResponse:
    """규칙 본문이 `/경로` 로 가리키는 그림 (관리자가 올린 ZIP 에서 저장한 것)."""
    if not published_page_open(db, "rules"):
        raise page_closed()
    file = stored_file(settings.rules_dir, path)
    if file is None:
        raise not_found("그림")
    return FileResponse(
        file,
        media_type=asset_type(file.name),
        headers={"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"},
    )
