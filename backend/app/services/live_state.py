from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import LiveState, Match, Team, User
from app.schemas import competition as s
from app.services import audit


def get_row(db: Session) -> LiveState:
    row = db.get(LiveState, 1)
    if row is None:  # 마이그레이션이 만들어 두지만, 지워졌을 때를 대비한다
        row = LiveState(id=1, phase="idle")
        db.add(row)
        db.flush()
    return row


def build_live_state(db: Session) -> s.LiveState:
    return s.LiveState.model_validate(get_row(db))


def update_live_state(db: Session, body: s.LiveStateUpdate, actor: User) -> LiveState:
    if body.on_track_team_id is not None:
        team = db.get(Team, body.on_track_team_id)
        if team is None or not team.is_active:
            raise invalid("활성 상태의 팀이 아닙니다.")
    if body.current_match_id is not None and db.get(Match, body.current_match_id) is None:
        raise invalid("매치가 없습니다.")
    row = get_row(db)
    before = audit.snapshot(row)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    audit.record_change(db, actor, "update", row, before)
    return row
