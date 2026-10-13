import type { Bracket, Leaderboard } from '../../api/types'

/** 직전 리더보드와 비교해 기록이 바뀐 팀 id */
export function changedTeams(prev: Leaderboard | undefined, next: Leaderboard): number[] {
  if (!prev) return []
  const before = new Map(prev.rows.map((row) => [row.team.id, row]))
  return next.rows
    .filter((row) => {
      const old = before.get(row.team.id)
      return (
        !old ||
        old.best_lap_ms !== row.best_lap_ms ||
        old.attempts !== row.attempts ||
        old.last_recorded_at !== row.last_recorded_at
      )
    })
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
