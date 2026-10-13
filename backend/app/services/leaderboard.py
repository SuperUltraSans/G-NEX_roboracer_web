"""예선 리더보드.

산정 방식은 미정이라 팀별 기록 목록 → 점수 함수 하나로 분리했다.
"N랩 합산" 같은 방식으로 바꿀 때는 ScoringFn 을 하나 더 만들어 SCORING 에 등록하면 된다.
"""

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import QualifyingLap, Team
from app.schemas.competition import Leaderboard, LeaderboardRow, TeamPublic


@dataclass(frozen=True)
class TeamScore:
    value_ms: int
    # 동률일 때 먼저 낸 팀이 앞선다: (achieved_at, lap_id) 순으로 비교
    achieved_at: datetime
    lap_id: int


ScoringFn = Callable[[Sequence[QualifyingLap]], TeamScore | None]


def best_lap(laps: Sequence[QualifyingLap]) -> TeamScore | None:
    valid = [lap for lap in laps if lap.status == "valid" and lap.lap_time_ms is not None]
    if not valid:
        return None
    best = min(valid, key=lambda lap: (lap.lap_time_ms, lap.recorded_at, lap.id))
    assert best.lap_time_ms is not None
    return TeamScore(best.lap_time_ms, best.recorded_at, best.id)


SCORING: dict[str, ScoringFn] = {"best_lap": best_lap}
DEFAULT_SCORING = "best_lap"


def build_leaderboard(db: Session, scoring: str = DEFAULT_SCORING) -> Leaderboard:
    score_fn = SCORING[scoring]
    teams = db.scalars(select(Team).where(Team.is_active)).all()
    laps_by_team: dict[int, list[QualifyingLap]] = defaultdict(list)
    laps = db.scalars(
        select(QualifyingLap).where(
            QualifyingLap.status != "void", QualifyingLap.team_id.in_([t.id for t in teams])
        )
    )
    for lap in laps:
        laps_by_team[lap.team_id].append(lap)

    scored: list[tuple[TeamScore, Team]] = []
    unscored: list[Team] = []
    for team in teams:
        score = score_fn(laps_by_team[team.id])
        if score is None:
            unscored.append(team)
        else:
            scored.append((score, team))
    scored.sort(key=lambda item: (item[0].value_ms, item[0].achieved_at, item[0].lap_id))
    unscored.sort(key=lambda team: (team.car_number, team.id))

    def row(team: Team, rank: int | None, score: TeamScore | None) -> LeaderboardRow:
        team_laps = laps_by_team[team.id]
        return LeaderboardRow(
            rank=rank,
            team=TeamPublic.model_validate(team),
            best_lap_ms=score.value_ms if score else None,
            gap_ms=score.value_ms - scored[0][0].value_ms if score else None,
            attempts=len(team_laps),
            last_recorded_at=max((lap.recorded_at for lap in team_laps), default=None),
        )

    rows = [row(team, rank, score) for rank, (score, team) in enumerate(scored, start=1)]
    rows += [row(team, None, None) for team in unscored]
    return Leaderboard(scoring=scoring, rows=rows)


def rank_to_team_id(leaderboard: Leaderboard) -> dict[int, int]:
    return {row.rank: row.team.id for row in leaderboard.rows if row.rank is not None}
