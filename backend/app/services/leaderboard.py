"""예선 순위 (대회 규칙 4장).

팀마다 Q1 → Q2 → Q3 을 차례로 통과한다.
- Q1·Q2: 무충돌 연속 3랩이면 통과. 무효 랩이 나오면 연속 랩을 0부터 다시 센다.
- Q3: 유효 랩타임이 하나라도 있으면 통과하고, 가장 빠른 기록을 쓴다.
- FA: 세 미션을 모두 통과했고 'FA 달성 불가' 판정이 없다.

순위(4.7)는 FA 달성 → 통과한 미션 수 → 마지막 미션 기록(Q3 최고 랩, 탈락한 미션의 최대 연속 유효 랩)
→ 차량 검사를 먼저 마친 팀 순서(관리자가 직접 적은 검차 순서, 없으면 검사 시각)로 정하고,
그 뒤 '최종 순위 1단계 강등' 판정만큼 아래로 내린다(8.2).
아직 랩 기록이 없는 팀은 순위 없이 맨 아래에 예선 출전 순서(동결한 맵핑 순서)대로 둔다.
"""

from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import QualifyingEvent, QualifyingLap, Team
from app.schemas.competition import Leaderboard, LeaderboardRow, TeamPublic

PASS_LAPS = 3
_NEVER = datetime.min.replace(tzinfo=UTC)


def _max_streak(laps: Sequence[QualifyingLap]) -> int:
    best = current = 0
    for lap in laps:
        current = current + 1 if lap.status == "valid" else 0
        best = max(best, current)
    return best


def _trailing_streak(laps: Sequence[QualifyingLap]) -> int:
    count = 0
    for lap in reversed(laps):
        if lap.status != "valid":
            break
        count += 1
    return count


def _row(team: Team, laps: list[QualifyingLap], fa_lost: bool, rank_drops: int) -> LeaderboardRow:
    """laps: 입력 취소를 뺀 이 팀의 랩 (기록 순서)."""
    by_mission: dict[str, list[QualifyingLap]] = defaultdict(list)
    for lap in laps:
        by_mission[lap.mission].append(lap)

    q1_max = _max_streak(by_mission["Q1"])
    q1_passed = q1_max >= PASS_LAPS
    # 앞 미션을 통과하지 못했으면 뒤 미션의 기록은 순위에 쓰지 않는다
    q2_max = _max_streak(by_mission["Q2"]) if q1_passed else 0
    q2_passed = q1_passed and q2_max >= PASS_LAPS
    q3_times = [
        lap.lap_time_ms
        for lap in by_mission["Q3"]
        if lap.status == "valid" and lap.lap_time_ms is not None
    ]
    q3_best = min(q3_times) if q2_passed and q3_times else None
    missions_passed = int(q1_passed) + int(q2_passed) + int(q3_best is not None)
    current = "Q1" if not q1_passed else "Q2" if not q2_passed else "Q3"

    return LeaderboardRow(
        rank=None,
        team=TeamPublic.model_validate(team),
        fa=missions_passed == 3 and not fa_lost,
        fa_lost=fa_lost,
        missions_passed=missions_passed,
        current_mission=current,
        current_streak=_trailing_streak(by_mission[current]),
        q1_laps=min(q1_max, PASS_LAPS) if by_mission["Q1"] else None,
        q2_laps=min(q2_max, PASS_LAPS) if q1_passed else None,
        q3_best_ms=q3_best,
        rank_drops=rank_drops,
        attempts=len(laps),
        last_recorded_at=max((lap.recorded_at for lap in laps), default=None),
    )


def current_mission(db: Session, team: Team) -> str:
    """이 팀이 지금 기록을 쌓는 미션 (모두 통과했으면 Q3)."""
    laps = db.scalars(
        select(QualifyingLap)
        .where(QualifyingLap.team_id == team.id, QualifyingLap.status != "void")
        .order_by(QualifyingLap.attempt_no)
    ).all()
    return _row(team, list(laps), False, 0).current_mission


def _record_key(row: LeaderboardRow) -> int:
    """마지막 미션 기록: Q3 은 빠를수록, 탈락한 미션은 연속 랩이 많을수록 앞선다."""
    if row.missions_passed == 3:
        return row.q3_best_ms or 0
    if row.missions_passed == 2:
        return 0  # Q3 유효 기록이 없다: 같은 처지의 팀끼리는 검사 순서로
    if row.missions_passed == 1:
        return -(row.q2_laps or 0)
    return -(row.q1_laps or 0)


def inspection_key(team: Team) -> tuple[bool, int, bool, datetime]:
    """검차를 먼저 마친 팀이 앞. 관리자가 직접 적은 순서를 먼저 쓰고, 없으면 검사 시각 순."""
    return (
        team.inspection_order is None,
        team.inspection_order or 0,
        team.inspected_at is None,
        team.inspected_at or _NEVER,
    )


def _apply_drops(rows: list[LeaderboardRow]) -> list[LeaderboardRow]:
    """강등 판정만큼 아래로. 아래 팀부터 옮겨서 판정받은 팀이 저마다 그만큼 내려가게 한다."""
    result = list(rows)
    for row in reversed(rows):
        if row.rank_drops:
            index = next(i for i, other in enumerate(result) if other is row)
            result.pop(index)
            result.insert(min(index + row.rank_drops, len(result)), row)
    return result


def build_leaderboard(db: Session) -> Leaderboard:
    teams = db.scalars(select(Team).where(Team.is_active)).all()
    team_ids = [team.id for team in teams]
    laps_by_team: dict[int, list[QualifyingLap]] = defaultdict(list)
    laps = db.scalars(
        select(QualifyingLap)
        .where(QualifyingLap.status != "void", QualifyingLap.team_id.in_(team_ids))
        .order_by(QualifyingLap.attempt_no)
    )
    for lap in laps:
        laps_by_team[lap.team_id].append(lap)
    fa_lost: set[int] = set()
    drops: dict[int, int] = defaultdict(int)
    for event in db.scalars(select(QualifyingEvent).where(QualifyingEvent.team_id.in_(team_ids))):
        if event.kind == "fa_lost":
            fa_lost.add(event.team_id)
        elif event.kind == "rank_drop":
            drops[event.team_id] += 1

    inspected = {team.id: inspection_key(team) for team in teams}
    rows = [_row(team, laps_by_team[team.id], team.id in fa_lost, drops[team.id]) for team in teams]
    # 출전 순서는 참가 중인 팀끼리 1부터 다시 센다 (중간에 기권한 팀은 뺀다)
    ordered = sorted(
        (team for team in teams if team.qualifying_order is not None),
        key=lambda team: (team.qualifying_order, team.id),
    )
    run_order = {team.id: order for order, team in enumerate(ordered, start=1)}
    by_id = {team.id: team for team in teams}
    for row in rows:
        row.run_order = run_order.get(row.team.id)
        row.inspection_order = by_id[row.team.id].inspection_order
    started = [row for row in rows if row.attempts > 0]
    started.sort(
        key=lambda row: (
            not row.fa,
            -row.missions_passed,
            _record_key(row),
            inspected[row.team.id],
            row.team.id,
        )
    )
    ranked = _apply_drops(started)
    for rank, row in enumerate(ranked, start=1):
        row.rank = rank
    waiting = sorted(
        (row for row in rows if row.attempts == 0),
        key=lambda row: (row.run_order is None, row.run_order or 0, row.team.id),
    )
    return Leaderboard(scoring="rules", rows=ranked + waiting)


def rank_to_team_id(leaderboard: Leaderboard) -> dict[int, int]:
    return {row.rank: row.team.id for row in leaderboard.rows if row.rank is not None}
