import type { Bracket, Leaderboard, LeaderboardRow } from '../../api/types'

/** 순위만 바뀐 것(다른 팀 기록 때문에 밀림)은 강조하지 않는다: 그 팀의 기록과 판정만 본다 */
function rowSignature(row: LeaderboardRow): string {
  return JSON.stringify([
    row.attempts,
    row.last_recorded_at,
    row.current_streak,
    row.q1_laps,
    row.q2_laps,
    row.q3_best_ms,
    row.fa_lost,
    row.rank_drops,
  ])
}

/** 직전 리더보드와 비교해 기록이 바뀐 팀 id */
export function changedTeams(prev: Leaderboard | undefined, next: Leaderboard): number[] {
  if (!prev) return []
  const before = new Map(prev.rows.map((row) => [row.team.id, rowSignature(row)]))
  return next.rows
    .filter((row) => before.get(row.team.id) !== rowSignature(row))
    .map((row) => row.team.id)
}

function matchSignature(match: Bracket['rounds'][number]['matches'][number]): string {
  return JSON.stringify([
    match.status,
    match.slots.map((slot) => [slot.team?.id ?? null, slot.result_rank, slot.result_text]),
  ])
}

/** 직전 대진과 비교해 상태나 슬롯이 바뀐 매치 id */
export function changedMatches(prev: Bracket | undefined, next: Bracket): number[] {
  if (!prev) return []
  const before = new Map(
    prev.rounds.flatMap((round) => round.matches).map((match) => [match.id, matchSignature(match)]),
  )
  return next.rounds
    .flatMap((round) => round.matches)
    .filter((match) => before.get(match.id) !== matchSignature(match))
    .map((match) => match.id)
}
