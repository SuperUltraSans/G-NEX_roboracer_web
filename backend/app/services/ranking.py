"""랭킹: 운영진이 직접 정한 순위(팀 ID → 순위). 본선 시드는 이 순위로 채운다."""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.errors import invalid
from app.models import Team, TeamRanking, User
from app.schemas import competition as s
from app.services import audit


def build_ranking(db: Session) -> s.Ranking:
    rows = db.scalars(
        select(TeamRanking)
        .join(TeamRanking.team)
        .where(Team.is_active)
        .options(selectinload(TeamRanking.team))
        .order_by(TeamRanking.rank)
    ).all()
    return s.Ranking(
        entries=[
            s.RankingEntry(rank=row.rank, team=s.TeamPublic.model_validate(row.team))
            for row in rows
        ],
        updated_at=max((row.updated_at for row in rows), default=None),
    )


def rank_to_team_id(db: Session) -> dict[int, int]:
    """순위 → 팀 ID. 그사이 비활성화된 팀은 빼서 그 순위 슬롯이 비게 한다."""
    rows = db.execute(
        select(TeamRanking.rank, TeamRanking.team_id).join(TeamRanking.team).where(Team.is_active)
    ).all()
    return {rank: team_id for rank, team_id in rows}


def write_ranking(db: Session, team_ids: list[int], actor: User | None) -> s.Ranking:
    """1위부터 차례로 받은 팀 ID 로 랭킹을 통째로 바꾼다. 목록에 없는 팀은 순위 없음."""
    if len(set(team_ids)) != len(team_ids):
        raise invalid("같은 팀이 두 번 들어 있습니다.")
    teams = {team.id: team for team in db.scalars(select(Team).where(Team.id.in_(team_ids)))}
    unknown = [team_id for team_id in team_ids if team_id not in teams]
    if unknown:
        raise invalid(f"없는 팀이 있습니다: {', '.join(map(str, unknown))}")
    inactive = [teams[team_id].name_ko for team_id in team_ids if not teams[team_id].is_active]
    if inactive:
        raise invalid(f"비활성화된 팀은 순위에 넣을 수 없습니다: {', '.join(inactive)}")
    _replace(db, team_ids, actor)
    return build_ranking(db)


def drop_team(db: Session, team_id: int, actor: User | None) -> None:
    """비활성화(기권)한 팀을 랭킹에서 빼고 아래 순위를 한 칸씩 당긴다."""
    current = list(db.scalars(select(TeamRanking.team_id).order_by(TeamRanking.rank)))
    if team_id in current:
        _replace(db, [other for other in current if other != team_id], actor)


def _replace(db: Session, team_ids: list[int], actor: User | None) -> None:
    before = list(db.scalars(select(TeamRanking.team_id).order_by(TeamRanking.rank)))
    db.execute(delete(TeamRanking))
    db.flush()
    for rank, team_id in enumerate(team_ids, start=1):
        db.add(TeamRanking(team_id=team_id, rank=rank))
    db.flush()
    audit.record(
        db, actor, "update", "team_rankings", "*", {"team_ids": before}, {"team_ids": team_ids}
    )
