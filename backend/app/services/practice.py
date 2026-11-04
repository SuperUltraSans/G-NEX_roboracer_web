"""그룹 연습 조: A·B·C조에 3·3·4팀. 차량 검사를 마친 팀이 검사 순서대로 원하는 조를 먼저 고른다.

조 편성은 진행 상태(live_state)에 함께 실어 공개 모니터링 '연습' 탭에 실시간으로 보인다.
"""

from datetime import UTC, datetime
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, invalid
from app.models import Team, User, utcnow
from app.schemas import competition as s
from app.services import audit


class Slot(NamedTuple):
    capacity: int
    starts_at: datetime
    ends_at: datetime


def _at(hour: int, minute: int) -> datetime:
    """2026-11-01 의 그 시각(UTC)"""
    return datetime(2026, 11, 1, hour, minute, tzinfo=UTC)


# 조마다 정원과 연습 시간. 공개 일정 '조별 연습'(KST 20:00부터 40분씩)과 같게 둔다
GROUPS: dict[str, Slot] = {
    "A": Slot(3, _at(11, 0), _at(11, 40)),
    "B": Slot(3, _at(11, 40), _at(12, 20)),
    "C": Slot(4, _at(12, 20), _at(13, 0)),
}


def groups(db: Session) -> list[s.PracticeGroup]:
    teams = db.scalars(
        select(Team)
        .where(Team.is_active, Team.practice_group.is_not(None))
        .order_by(Team.practice_group_at, Team.id)
    ).all()
    return [
        s.PracticeGroup(
            name=name,
            capacity=slot.capacity,
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
            teams=[
                s.PracticeMember(team=s.TeamPublic.model_validate(t), chosen_at=t.practice_group_at)
                for t in teams
                if t.practice_group == name
            ],
        )
        for name, slot in GROUPS.items()
    ]


def set_group(db: Session, team_id: int, group: str | None, actor: User) -> None:
    team = db.get(Team, team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    if group == team.practice_group:
        return
    if group is not None:
        if team.inspected_at is None:
            raise invalid("차량 검사를 마친 팀만 연습 조를 고를 수 있습니다.")
        taken = db.scalar(
            select(Team.id)
            .where(Team.is_active, Team.practice_group == group, Team.id != team.id)
            .offset(GROUPS[group].capacity - 1)
            .limit(1)
        )
        if taken is not None:
            capacity = GROUPS[group].capacity
            raise AppError(409, "GROUP_FULL", f"{group}조는 이미 {capacity}팀이 찼습니다.")
    before = audit.snapshot(team)
    team.practice_group = group
    team.practice_group_at = utcnow() if group is not None else None
    audit.record_change(db, actor, "update", team, before)
