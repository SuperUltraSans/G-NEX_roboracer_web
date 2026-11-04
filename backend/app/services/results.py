"""대회 결과: 운영진이 정한 시상. 공개 '결과' 페이지가 보여 준다.

본선 대진에서 계산하지 않고 대회에서 정한 그대로 적는다. 순위는 두지 않고 상만 보인다.
"""

from typing import get_args

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.errors import invalid
from app.models import Award, Team, User
from app.schemas import competition as s
from app.services import audit

# 대상 → 최우수상 → 우수상
AWARD_ORDER: tuple[s.AwardKind, ...] = get_args(s.AwardKind)


def _rows(db: Session) -> list[Award]:
    return list(
        db.scalars(
            select(Award)
            .options(selectinload(Award.team))
            .order_by(Award.sort_order, Award.team_id)
            .execution_options(populate_existing=True)
        )
    )


def build_results(db: Session) -> s.Results:
    rows = _rows(db)
    entries = []
    for award in AWARD_ORDER:
        teams = [s.TeamPublic.model_validate(row.team) for row in rows if row.award == award]
        if teams:
            entries.append(s.ResultEntry(award=award, teams=teams))
    return s.Results(entries=entries)


def _snapshot(db: Session) -> list[dict[str, object]]:
    return [{"team_id": row.team_id, "award": row.award} for row in _rows(db)]


def write_awards(db: Session, items: list[s.AwardItem], actor: User | None) -> s.Results:
    """시상을 통째로 바꾼다. 같은 상 안에서는 받은 순서대로 보인다."""
    team_ids = [item.team_id for item in items]
    if len(set(team_ids)) != len(team_ids):
        raise invalid("같은 팀이 두 번 들어 있습니다.")
    known = set(db.scalars(select(Team.id).where(Team.id.in_(team_ids))))
    unknown = [team_id for team_id in team_ids if team_id not in known]
    if unknown:
        raise invalid(f"없는 팀이 있습니다: {', '.join(map(str, unknown))}")

    before = _snapshot(db)
    db.execute(delete(Award))
    db.add_all(
        Award(team_id=item.team_id, award=item.award, sort_order=index)
        for index, item in enumerate(items)
    )
    db.flush()
    audit.record(db, actor, "update", "awards", "*", {"awards": before}, {"awards": _snapshot(db)})
    return build_results(db)
