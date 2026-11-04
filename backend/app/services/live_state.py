from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import LiveState, Match, Team, User
from app.schemas import competition as s
from app.services import audit, bracket, mapping, practice


def get_row(db: Session) -> LiveState:
    row = db.get(LiveState, 1)
    if row is None:  # 마이그레이션이 만들어 두지만, 지워졌을 때를 대비한다
        row = LiveState(id=1, phase="idle")
        db.add(row)
        db.flush()
    return row


def build_live_state(db: Session) -> s.LiveState:
    state = s.LiveState.model_validate(get_row(db))
    state.mapping = mapping.entries(db)
    state.mapping_frozen = mapping.frozen(db)
    state.bracket_frozen = bracket.frozen(db)
    state.practice = practice.groups(db)
    return state


def update_live_state(db: Session, body: s.LiveStateUpdate, actor: User) -> LiveState:
    if body.on_track_team_id is not None:
        team = db.get(Team, body.on_track_team_id)
        if team is None or not team.is_active:
            raise invalid("활성 상태의 팀이 아닙니다.")
    if body.current_match_id is not None and db.get(Match, body.current_match_id) is None:
        raise invalid("매치가 없습니다.")
    row = get_row(db)
    before = audit.snapshot(row)
    previous_match_id = row.current_match_id
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    _follow_current_match(db, previous_match_id, row.current_match_id)
    audit.record_change(db, actor, "update", row, before)
    return row


def clear_team(db: Session, team_id: int, actor: User | None) -> None:
    """비활성화한 팀이 트랙 위 팀이면 비운다."""
    row = get_row(db)
    if row.on_track_team_id != team_id:
        return
    before = audit.snapshot(row)
    row.on_track_team_id = None
    audit.record_change(db, actor, "update", row, before)


def _follow_current_match(db: Session, previous_id: int | None, current_id: int | None) -> None:
    """진행 중 매치를 고르면 그 매치를 '진행 중'으로, 앞서 진행 중이던 매치는 '예정'으로 돌린다.

    공개 대진의 '진행 중' 표시와 상태 줄의 진행 중 매치가 어긋나지 않게 한다.
    """
    if previous_id == current_id:
        return
    if previous_id is not None:
        previous = db.get(Match, previous_id)
        if previous is not None and previous.status == "live":
            previous.status = "scheduled"
            previous.bump_version()
    if current_id is not None:
        current = db.get(Match, current_id)
        if current is not None and current.status == "scheduled":
            current.status = "live"
            current.bump_version()
