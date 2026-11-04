"""맵핑 순서: 콘솔에서 참가 팀 순서를 무작위로 섞고, 팀마다 맵핑을 마치면 표시한다.

순서는 진행 상태(live_state)에 함께 실어 공개 모니터링 '맵핑' 탭에 실시간으로 보인다.
맵핑을 마치면 순서를 동결해 예선 출전 순서(Team.qualifying_order)로 옮겨 적는다(그 뒤로 못 바꾼다).
"""

import random

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.errors import AppError, invalid
from app.models import Team, User, utcnow
from app.schemas import competition as s
from app.services import audit

_random = random.SystemRandom()


def entries(db: Session) -> list[s.MappingEntry]:
    """참가 중인 팀만 순서대로. 중간에 기권한 팀은 빼고 1부터 다시 센다."""
    teams = db.scalars(
        select(Team)
        .where(Team.is_active, Team.mapping_order.is_not(None))
        .order_by(Team.mapping_order, Team.id)
    )
    return [
        s.MappingEntry(
            order=order, team=s.TeamPublic.model_validate(team), mapped_at=team.mapped_at
        )
        for order, team in enumerate(teams, start=1)
    ]


def frozen(db: Session) -> bool:
    """맵핑 순서를 동결했나 (예선 출전 순서가 한 팀이라도 있으면)."""
    return bool(db.scalar(select(exists().where(Team.qualifying_order.is_not(None)))))


def _check_not_frozen(db: Session) -> None:
    if frozen(db):
        raise AppError(
            409, "MAPPING_FROZEN", "맵핑 순서를 동결해 예선 순서로 쓰고 있어 바꿀 수 없습니다."
        )


def freeze(db: Session, actor: User | None) -> None:
    """지금 맵핑 순서(맵핑 탭에 보이는 순서)를 예선 출전 순서로 옮겨 적고 동결한다."""
    _check_not_frozen(db)
    order = entries(db)
    if not order:
        raise invalid("맵핑 순서가 없습니다. 먼저 순서를 섞으세요.")
    for entry in order:
        team = db.get(Team, entry.team.id)
        assert team is not None
        team.qualifying_order = entry.order
    audit.record(
        db,
        actor,
        "freeze",
        "teams",
        "qualifying_order",
        None,
        {"order": [entry.team.id for entry in order]},
    )


def set_qualifying_order(db: Session, team_ids: list[int], actor: User) -> None:
    """예선 출전 순서를 통째로 바꾼다 (콘솔에서 끌어 놓기). 참가 중인 팀을 빠짐없이 한 번씩."""
    teams = {team.id: team for team in db.scalars(select(Team).where(Team.is_active))}
    if len(set(team_ids)) != len(team_ids) or set(team_ids) != set(teams):
        raise invalid("참가 중인 팀을 빠짐없이 한 번씩 보내세요.")
    before = sorted(
        (team for team in teams.values() if team.qualifying_order is not None),
        key=lambda team: (team.qualifying_order, team.id),
    )
    for position, team_id in enumerate(team_ids, start=1):
        teams[team_id].qualifying_order = position
    audit.record(
        db,
        actor,
        "reorder",
        "teams",
        "qualifying_order",
        {"order": [team.id for team in before]},
        {"order": team_ids},
    )


def shuffle(db: Session, actor: User) -> None:
    """참가 팀의 맵핑 순서를 무작위로 정한다. 이미 맵핑을 마친 팀은 지금 순서 그대로 앞에 둔다."""
    _check_not_frozen(db)
    teams = list(db.scalars(select(Team).where(Team.is_active).order_by(Team.id)))
    done = sorted(
        (t for t in teams if t.mapped_at is not None and t.mapping_order is not None),
        key=lambda t: (t.mapping_order, t.id),
    )
    rest = [t for t in teams if t not in done]
    _random.shuffle(rest)
    order = done + rest
    before = {t.id: t.mapping_order for t in teams}
    for position, team in enumerate(order, start=1):
        team.mapping_order = position
    audit.record(
        db,
        actor,
        "shuffle",
        "teams",
        "mapping_order",
        {"order": sorted(before, key=lambda i: (before[i] is None, before[i] or 0, i))},
        {"order": [t.id for t in order]},
    )


def set_done(db: Session, team_id: int, done: bool, actor: User) -> None:
    _check_not_frozen(db)
    team = db.get(Team, team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    if team.mapping_order is None:
        raise invalid("맵핑 순서에 없는 팀입니다. 먼저 순서를 섞으세요.")
    before = audit.snapshot(team)
    if done and team.mapped_at is None:
        team.mapped_at = utcnow()
    elif not done:
        team.mapped_at = None
    audit.record_change(db, actor, "update", team, before)


def reset(db: Session, actor: User) -> None:
    """맵핑 전체 취소: 순서와 완료 기록을 모두 지워 순서를 정하기 전으로 돌린다."""
    _check_not_frozen(db)
    teams = list(
        db.scalars(
            select(Team)
            .where((Team.mapping_order.is_not(None)) | (Team.mapped_at.is_not(None)))
            .order_by(Team.mapping_order, Team.id)
        )
    )
    if not teams:
        return
    before = {
        "order": [t.id for t in teams if t.mapping_order is not None],
        "done": [t.id for t in teams if t.mapped_at is not None],
    }
    for team in teams:
        team.mapping_order = None
        team.mapped_at = None
    audit.record(db, actor, "mapping_reset", "teams", "mapping_order", before, None)
