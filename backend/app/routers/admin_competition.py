from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.auth import AdminUser, StaffUser
from app.db import DbSession
from app.errors import check_version, invalid, not_found
from app.live.events import Events
from app.models import BracketRound, QualifyingLap, Team, utcnow
from app.schemas import competition as s
from app.services import audit
from app.services import bracket as bracket_service
from app.services.live_state import build_live_state, get_row, update_live_state

router = APIRouter()


# ---- 예선 기록 ----


def _get_lap(db: DbSession, lap_id: int) -> QualifyingLap:
    lap = db.get(QualifyingLap, lap_id)
    if lap is None:
        raise not_found("기록")
    if lap.status == "void":
        raise invalid("무효 처리된 기록은 바꿀 수 없습니다.")
    return lap


@router.get("/qualifying/laps", response_model=list[s.QualifyingLapAdmin], tags=["qualifying"])
def list_laps(
    _: StaffUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    team_id: int | None = None,
) -> list[s.QualifyingLapAdmin]:
    query = select(QualifyingLap).options(
        selectinload(QualifyingLap.team), selectinload(QualifyingLap.recorder)
    )
    if team_id is not None:
        query = query.where(QualifyingLap.team_id == team_id)
    laps = db.scalars(
        query.order_by(QualifyingLap.recorded_at.desc(), QualifyingLap.id.desc()).limit(limit)
    )
    return [s.QualifyingLapAdmin.model_validate(lap) for lap in laps]


@router.post(
    "/qualifying/laps",
    response_model=s.QualifyingLapAdmin,
    status_code=status.HTTP_201_CREATED,
    tags=["qualifying"],
)
def create_lap(
    body: s.QualifyingLapCreate, actor: StaffUser, db: DbSession, events: Events
) -> s.QualifyingLapAdmin:
    team = db.get(Team, body.team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    last_attempt = db.scalar(
        select(func.max(QualifyingLap.attempt_no)).where(QualifyingLap.team_id == team.id)
    )
    lap = QualifyingLap(
        team_id=team.id,
        attempt_no=(last_attempt or 0) + 1,
        lap_time_ms=body.lap_time_ms,
        status=body.status,
        recorded_by=actor.id,
        recorded_at=utcnow(),
    )
    db.add(lap)
    audit.record_change(db, actor, "create", lap, None)
    db.commit()
    events.qualifying()
    return s.QualifyingLapAdmin.model_validate(lap)


@router.patch("/qualifying/laps/{lap_id}", response_model=s.QualifyingLapAdmin, tags=["qualifying"])
def update_lap(
    lap_id: int, body: s.QualifyingLapUpdate, actor: StaffUser, db: DbSession, events: Events
) -> s.QualifyingLapAdmin:
    lap = _get_lap(db, lap_id)
    check_version(lap.version, body.version)
    changes = body.model_dump(exclude_unset=True)
    new_status = changes.get("status", lap.status)
    new_time = None if new_status == "dnf" else changes.get("lap_time_ms", lap.lap_time_ms)
    if new_status == "valid" and new_time is None:
        raise invalid("정상 기록에는 랩타임이 필요합니다.")
    before = audit.snapshot(lap)
    lap.status = new_status
    lap.lap_time_ms = new_time
    lap.bump_version()
    audit.record_change(db, actor, "update", lap, before)
    db.commit()
    events.qualifying()
    return s.QualifyingLapAdmin.model_validate(lap)


@router.post(
    "/qualifying/laps/{lap_id}/void", response_model=s.QualifyingLapAdmin, tags=["qualifying"]
)
def void_lap(
    lap_id: int, body: s.QualifyingLapVoid, actor: StaffUser, db: DbSession, events: Events
) -> s.QualifyingLapAdmin:
    lap = _get_lap(db, lap_id)
    if body.version is not None:
        check_version(lap.version, body.version)
    before = audit.snapshot(lap)
    lap.status = "void"
    lap.void_reason = body.reason
    lap.bump_version()
    audit.record_change(db, actor, "void", lap, before)
    db.commit()
    events.qualifying()
    return s.QualifyingLapAdmin.model_validate(lap)


# ---- 대진 편집 ----


def _is_current_match(db: DbSession, match_id: int) -> bool:
    return get_row(db).current_match_id == match_id


@router.get("/bracket/rounds", response_model=list[s.BracketRoundAdmin], tags=["bracket"])
def list_rounds(_: AdminUser, db: DbSession) -> list[s.BracketRoundAdmin]:
    rounds = db.scalars(select(BracketRound).order_by(BracketRound.sort_order, BracketRound.id))
    return [s.BracketRoundAdmin.model_validate(r) for r in rounds]


@router.post(
    "/bracket/rounds",
    response_model=s.BracketRoundAdmin,
    status_code=status.HTTP_201_CREATED,
    tags=["bracket"],
)
def create_round(
    body: s.BracketRoundCreate, actor: AdminUser, db: DbSession, events: Events
) -> s.BracketRoundAdmin:
    round_ = bracket_service.create_round(db, body, actor)
    db.commit()
    events.bracket()
    return s.BracketRoundAdmin.model_validate(round_)


@router.patch("/bracket/rounds/{round_id}", response_model=s.BracketRoundAdmin, tags=["bracket"])
def update_round(
    round_id: int, body: s.BracketRoundUpdate, actor: AdminUser, db: DbSession, events: Events
) -> s.BracketRoundAdmin:
    round_ = bracket_service.get_round(db, round_id)
    bracket_service.update_round(db, round_, body, actor)
    db.commit()
    events.bracket()
    return s.BracketRoundAdmin.model_validate(round_)


@router.delete(
    "/bracket/rounds/{round_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["bracket"]
)
def delete_round(round_id: int, actor: AdminUser, db: DbSession, events: Events) -> Response:
    live_changed = bracket_service.delete_round(db, bracket_service.get_round(db, round_id), actor)
    db.commit()
    events.bracket()
    if live_changed:
        events.live_state()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/bracket/matches",
    response_model=s.BracketMatch,
    status_code=status.HTTP_201_CREATED,
    tags=["bracket"],
)
def create_match(
    body: s.BracketMatchCreate, actor: AdminUser, db: DbSession, events: Events
) -> s.BracketMatch:
    match = bracket_service.create_match(db, body, actor)
    db.commit()
    events.bracket()
    return s.BracketMatch.model_validate(match)


@router.patch("/bracket/matches/{match_id}", response_model=s.BracketMatch, tags=["bracket"])
def update_match(
    match_id: int, body: s.BracketMatchUpdate, actor: AdminUser, db: DbSession, events: Events
) -> s.BracketMatch:
    match = bracket_service.get_match(db, match_id)
    bracket_service.update_match(db, match, body, actor)
    db.commit()
    events.bracket()
    if _is_current_match(db, match.id):
        events.live_state()
    return s.BracketMatch.model_validate(match)


@router.delete(
    "/bracket/matches/{match_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["bracket"]
)
def delete_match(match_id: int, actor: AdminUser, db: DbSession, events: Events) -> Response:
    live_changed = bracket_service.delete_match(db, bracket_service.get_match(db, match_id), actor)
    db.commit()
    events.bracket()
    if live_changed:
        events.live_state()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/bracket/slots/{slot_id}", response_model=s.BracketMatch, tags=["bracket"])
def update_slot(
    slot_id: int, body: s.BracketSlotUpdate, actor: AdminUser, db: DbSession, events: Events
) -> s.BracketMatch:
    """바뀐 슬롯이 속한 매치를 돌려준다 (매치 version 이 올라간다)."""
    match = bracket_service.update_slot(db, bracket_service.get_slot(db, slot_id), body, actor)
    db.commit()
    events.bracket()
    return s.BracketMatch.model_validate(match)


@router.post("/bracket/seed-from-qualifying", response_model=s.Bracket, tags=["bracket"])
def seed_from_qualifying(actor: AdminUser, db: DbSession, events: Events) -> s.Bracket:
    bracket_service.seed_from_qualifying(db, actor)
    db.commit()
    events.bracket()
    return bracket_service.build_bracket(db)


@router.post(
    "/bracket/generate",
    response_model=s.Bracket,
    status_code=status.HTTP_201_CREATED,
    tags=["bracket"],
)
def generate_bracket(
    body: s.BracketGenerate, actor: AdminUser, db: DbSession, events: Events
) -> s.Bracket:
    bracket_service.generate(db, body, actor)
    db.commit()
    events.bracket()
    return bracket_service.build_bracket(db)


# ---- 결과 입력 (심판 가능) ----


@router.post("/matches/{match_id}/result", response_model=s.BracketMatch, tags=["bracket"])
def submit_match_result(
    match_id: int, body: s.MatchResultSubmit, actor: StaffUser, db: DbSession, events: Events
) -> s.BracketMatch:
    match = bracket_service.get_match(db, match_id)
    bracket_service.submit_result(db, match, body, actor)
    db.commit()
    events.bracket()
    return s.BracketMatch.model_validate(match)


@router.post("/matches/{match_id}/reopen", response_model=s.BracketMatch, tags=["bracket"])
def reopen_match(
    match_id: int,
    actor: StaffUser,
    db: DbSession,
    events: Events,
    body: s.MatchReopen | None = None,
) -> s.BracketMatch:
    match = bracket_service.get_match(db, match_id)
    bracket_service.reopen_match(db, match, body or s.MatchReopen(), actor)
    db.commit()
    events.bracket()
    return s.BracketMatch.model_validate(match)


# ---- 진행 상태 ----


@router.put("/live/state", response_model=s.LiveState, tags=["live"])
def put_live_state(
    body: s.LiveStateUpdate, actor: StaffUser, db: DbSession, events: Events
) -> s.LiveState:
    update_live_state(db, body, actor)
    db.commit()
    events.live_state()
    return build_live_state(db)
