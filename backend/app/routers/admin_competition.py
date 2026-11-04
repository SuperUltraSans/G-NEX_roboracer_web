from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.auth import AdminUser, MonitorActor
from app.db import DbSession
from app.errors import AppError, check_version, invalid, not_found
from app.live.events import Events
from app.models import BracketRound, QualifyingEvent, QualifyingLap, Team, utcnow
from app.schemas import competition as s
from app.services import audit
from app.services import bracket as bracket_service
from app.services import mapping as mapping_service
from app.services import practice as practice_service
from app.services import ranking as ranking_service
from app.services.leaderboard import build_leaderboard, current_mission, inspection_key
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
    _: MonitorActor,
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
    body: s.QualifyingLapCreate, actor: MonitorActor, db: DbSession, events: Events
) -> s.QualifyingLapAdmin:
    team = db.get(Team, body.team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    # 미션을 보내지 않으면 저장하는 순간의 진행으로 정한다 (화면이 갱신되기 전에 눌러도 맞게)
    mission = body.mission or current_mission(db, team)
    if mission == "Q3" and body.status == "valid" and body.lap_time_ms is None:
        raise invalid("Q3 의 유효 랩에는 랩타임이 필요합니다.")
    last_attempt = db.scalar(
        select(func.max(QualifyingLap.attempt_no)).where(QualifyingLap.team_id == team.id)
    )
    lap = QualifyingLap(
        team_id=team.id,
        attempt_no=(last_attempt or 0) + 1,
        mission=mission,
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
    lap_id: int, body: s.QualifyingLapUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> s.QualifyingLapAdmin:
    lap = _get_lap(db, lap_id)
    check_version(lap.version, body.version)
    changes = body.model_dump(exclude_unset=True)
    new_mission = changes.get("mission") or lap.mission
    new_status = changes.get("status") or lap.status
    new_time = changes.get("lap_time_ms", lap.lap_time_ms)
    if new_mission == "Q3" and new_status == "valid" and new_time is None:
        raise invalid("Q3 의 유효 랩에는 랩타임이 필요합니다.")
    before = audit.snapshot(lap)
    lap.mission = new_mission
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
    lap_id: int, body: s.QualifyingLapVoid, actor: MonitorActor, db: DbSession, events: Events
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


# ---- 예선 판정 (FA 달성 불가, 순위 강등)과 차량 검사 순서 ----


@router.get("/qualifying/events", response_model=list[s.QualifyingEventAdmin], tags=["qualifying"])
def list_events(
    _: MonitorActor, db: DbSession, team_id: int | None = None
) -> list[s.QualifyingEventAdmin]:
    query = select(QualifyingEvent).options(
        selectinload(QualifyingEvent.team), selectinload(QualifyingEvent.recorder)
    )
    if team_id is not None:
        query = query.where(QualifyingEvent.team_id == team_id)
    events = db.scalars(query.order_by(QualifyingEvent.recorded_at, QualifyingEvent.id))
    return [s.QualifyingEventAdmin.model_validate(event) for event in events]


@router.post(
    "/qualifying/events",
    response_model=s.QualifyingEventAdmin,
    status_code=status.HTTP_201_CREATED,
    tags=["qualifying"],
)
def create_event(
    body: s.QualifyingEventCreate, actor: MonitorActor, db: DbSession, events: Events
) -> s.QualifyingEventAdmin:
    team = db.get(Team, body.team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    if body.kind == "fa_lost" and db.scalar(
        select(QualifyingEvent.id).where(
            QualifyingEvent.team_id == team.id, QualifyingEvent.kind == "fa_lost"
        )
    ):
        raise invalid("이미 FA 달성 불가 판정을 받은 팀입니다.")
    event = QualifyingEvent(
        team_id=team.id,
        kind=body.kind,
        reason=body.reason,
        recorded_by=actor.id,
        recorded_at=utcnow(),
    )
    db.add(event)
    audit.record_change(db, actor, "create", event, None)
    db.commit()
    events.qualifying()
    return s.QualifyingEventAdmin.model_validate(event)


@router.delete(
    "/qualifying/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["qualifying"]
)
def delete_event(event_id: int, actor: MonitorActor, db: DbSession, events: Events) -> Response:
    """판정을 취소한다. 변경 이력에는 남는다."""
    event = db.get(QualifyingEvent, event_id)
    if event is None:
        raise not_found("판정")
    before = audit.snapshot(event)
    db.delete(event)
    audit.record_change(db, actor, "delete", event, before)
    db.commit()
    events.qualifying()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _inspection(db: DbSession) -> list[s.InspectionEntry]:
    teams = db.scalars(select(Team).where(Team.is_active).order_by(Team.id)).all()
    done = sorted(
        (
            team
            for team in teams
            if team.inspection_order is not None or team.inspected_at is not None
        ),
        key=lambda team: (inspection_key(team), team.id),
    )
    order = {team.id: index for index, team in enumerate(done, start=1)}
    return [
        s.InspectionEntry(
            team=s.TeamPublic.model_validate(team),
            inspected_at=team.inspected_at,
            inspection_order=team.inspection_order,
            order=order.get(team.id),
        )
        for team in teams
    ]


@router.get("/qualifying/inspection", response_model=list[s.InspectionEntry], tags=["qualifying"])
def list_inspection(_: MonitorActor, db: DbSession) -> list[s.InspectionEntry]:
    """차량 검사를 마친 순서. 예선 순위가 같으면 먼저 마친 팀이 앞선다."""
    return _inspection(db)


@router.put(
    "/qualifying/inspection/{team_id}",
    response_model=list[s.InspectionEntry],
    tags=["qualifying"],
)
def set_inspection(
    team_id: int, body: s.InspectionUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> list[s.InspectionEntry]:
    team = db.get(Team, team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    before = audit.snapshot(team)
    if body.done and team.inspected_at is None:
        team.inspected_at = utcnow()
    elif not body.done:
        team.inspected_at = None
    audit.record_change(db, actor, "update", team, before)
    db.commit()
    events.qualifying()
    return _inspection(db)


@router.put("/qualifying/order", response_model=s.Leaderboard, tags=["qualifying"])
def set_qualifying_order(
    body: s.QualifyingOrderUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> s.Leaderboard:
    """예선 출전 순서를 바꾼다 (콘솔에서 끌어 놓기). 맵핑 순서는 그대로 두고 잠근다."""
    mapping_service.set_qualifying_order(db, body.team_ids, actor)
    db.commit()
    events.qualifying()
    events.live_state()
    return build_leaderboard(db)


@router.put(
    "/qualifying/inspection-order",
    response_model=list[s.InspectionEntry],
    tags=["qualifying"],
)
def set_inspection_order(
    body: s.InspectionOrderUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> list[s.InspectionEntry]:
    """검차 완료 순서를 직접 적는다. 한 번호를 두 팀에 줄 수 없다 (409 INSPECTION_ORDER_TAKEN)."""
    teams = {team.id: team for team in db.scalars(select(Team).where(Team.is_active))}
    if any(item.team_id not in teams for item in body.items):
        raise invalid("활성 상태의 팀이 아닙니다.")
    wanted = {team_id: team.inspection_order for team_id, team in teams.items()}
    wanted.update({item.team_id: item.order for item in body.items})
    numbers = [n for n in wanted.values() if n is not None]
    taken = sorted({n for n in numbers if numbers.count(n) > 1})
    if taken:
        listed = ", ".join(str(n) for n in taken)
        detail = f"검차 순서 {listed}번을 두 팀 이상에 적었습니다."
        raise AppError(409, "INSPECTION_ORDER_TAKEN", detail)
    for team_id, order in wanted.items():
        team = teams[team_id]
        if team.inspection_order != order:
            before = audit.snapshot(team)
            team.inspection_order = order
            audit.record_change(db, actor, "update", team, before)
    db.commit()
    events.qualifying()
    return _inspection(db)


# ---- 대진 편집 ----


def _is_current_match(db: DbSession, match_id: int) -> bool:
    return get_row(db).current_match_id == match_id


@router.get("/bracket/rounds", response_model=list[s.BracketRoundAdmin], tags=["bracket"])
def list_rounds(_: MonitorActor, db: DbSession) -> list[s.BracketRoundAdmin]:
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


@router.post("/bracket/slots/swap", response_model=s.Bracket, tags=["bracket"])
def swap_slots(
    body: s.BracketSlotSwap, actor: AdminUser, db: DbSession, events: Events
) -> s.Bracket:
    """두 칸의 자리를 바꾼다 (관리자 화면에서 끌어 놓기). 두 매치가 바뀌어 대진 전체를 돌려준다."""
    bracket_service.swap_slots(db, body, actor)
    db.commit()
    events.bracket()
    return bracket_service.build_bracket(db)


@router.post("/bracket/seed-from-ranking", response_model=s.Bracket, tags=["bracket"])
def seed_from_ranking(actor: MonitorActor, db: DbSession, events: Events) -> s.Bracket:
    """'예선 N위' 슬롯을 랭킹 N위 팀으로 채운다 (모니터링 관리)."""
    bracket_service.seed_from_ranking(db, actor)
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


# ---- 결과 입력 (모니터링 관리) ----


@router.post("/matches/{match_id}/result", response_model=s.BracketMatch, tags=["bracket"])
def submit_match_result(
    match_id: int, body: s.MatchResultSubmit, actor: MonitorActor, db: DbSession, events: Events
) -> s.BracketMatch:
    match = bracket_service.get_match(db, match_id)
    bracket_service.submit_result(db, match, body, actor)
    db.commit()
    events.bracket()
    return s.BracketMatch.model_validate(match)


@router.post("/matches/{match_id}/reopen", response_model=s.BracketMatch, tags=["bracket"])
def reopen_match(
    match_id: int,
    actor: MonitorActor,
    db: DbSession,
    events: Events,
    body: s.MatchReopen | None = None,
) -> s.BracketMatch:
    match = bracket_service.get_match(db, match_id)
    bracket_service.reopen_match(db, match, body or s.MatchReopen(), actor)
    db.commit()
    events.bracket()
    return s.BracketMatch.model_validate(match)


# ---- 맵핑 순서 (모니터링 관리) ----


@router.post("/mapping/shuffle", response_model=s.LiveState, tags=["live"])
def shuffle_mapping(actor: MonitorActor, db: DbSession, events: Events) -> s.LiveState:
    """참가 팀의 맵핑 순서를 무작위로 섞는다. 맵핑을 마친 팀은 지금 순서대로 앞에 둔다."""
    mapping_service.shuffle(db, actor)
    db.commit()
    events.live_state()
    return build_live_state(db)


@router.delete("/mapping", response_model=s.LiveState, tags=["live"])
def reset_mapping(actor: MonitorActor, db: DbSession, events: Events) -> s.LiveState:
    """맵핑 전체 취소: 순서와 완료 기록을 모두 지운다. 현재 단계와 트랙 위 팀은 그대로 둔다."""
    mapping_service.reset(db, actor)
    db.commit()
    events.live_state()
    return build_live_state(db)


@router.put("/mapping/{team_id}", response_model=s.LiveState, tags=["live"])
def set_mapping_done(
    team_id: int, body: s.MappingUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> s.LiveState:
    mapping_service.set_done(db, team_id, body.done, actor)
    db.commit()
    events.live_state()
    return build_live_state(db)


# ---- 그룹 연습 조 (모니터링 관리) ----


@router.put("/practice/{team_id}", response_model=s.LiveState, tags=["live"])
def set_practice_group(
    team_id: int, body: s.PracticeUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> s.LiveState:
    """차량 검사를 마친 팀의 연습 조를 정한다. 조마다 정원이 차면 409 GROUP_FULL."""
    practice_service.set_group(db, team_id, body.group, actor)
    db.commit()
    events.live_state()
    return build_live_state(db)


# ---- 진행 상태 ----


@router.put("/live/state", response_model=s.LiveState, tags=["live"])
def put_live_state(
    body: s.LiveStateUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> s.LiveState:
    update_live_state(db, body, actor)
    db.commit()
    events.live_state()
    # 진행 중 매치를 바꾸면 매치 상태도 따라 바뀐다
    events.bracket()
    return build_live_state(db)


# ---- 랭킹 (모니터링 관리) ----


@router.get("/ranking", response_model=s.Ranking, tags=["ranking"])
def get_ranking(_: MonitorActor, db: DbSession) -> s.Ranking:
    return ranking_service.build_ranking(db)


@router.put("/ranking", response_model=s.Ranking, tags=["ranking"])
def put_ranking(
    body: s.RankingUpdate, actor: MonitorActor, db: DbSession, events: Events
) -> s.Ranking:
    """1위부터 차례로 팀 ID 로 랭킹을 통째로 바꾼다. 본선 시드는 '시드 채우기'를 눌러야 바뀐다."""
    result = ranking_service.write_ranking(db, body.team_ids, actor)
    db.commit()
    events.content("ranking")
    return result


# ---- 모니터링 관리 주소 확인 ----


@router.get("/monitor/access", response_model=s.MonitorAccess, tags=["monitor"])
def monitor_access(actor: MonitorActor, db: DbSession) -> s.MonitorAccess:
    """주소의 비밀 값이나 로그인으로 모니터링 관리를 쓸 수 있는지 확인한다."""
    db.commit()
    return s.MonitorAccess(via="key" if actor.is_system else "session", username=actor.username)
