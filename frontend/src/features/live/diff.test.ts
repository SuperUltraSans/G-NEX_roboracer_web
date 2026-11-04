import { describe, expect, it } from 'vitest'
import type { Leaderboard, LeaderboardRow } from '../../api/types'
import { changedTeams } from './diff'

const team = (id: number) => ({
  id,
  name_ko: `팀 ${id}`,
  name_en: '',
  affiliation_ko: null,
  affiliation_en: null,
})
const row = (id: number, best: number | null, attempts: number, rank = id): LeaderboardRow => ({
  rank: attempts === 0 ? null : rank,
  team: team(id),
  fa: best !== null,
  fa_lost: false,
  missions_passed: best === null ? 0 : 3,
  current_mission: best === null ? 'Q1' : 'Q3',
  current_streak: 0,
  q1_laps: attempts > 0 ? Math.min(attempts, 3) : null,
  q2_laps: best === null ? null : 3,
  q3_best_ms: best,
  rank_drops: 0,
  attempts,
  last_recorded_at: null,
})
const board = (rows: LeaderboardRow[]): Leaderboard => ({ scoring: 'rules', rows })

describe('changedTeams', () => {
  it('reports nothing for the first data', () => {
    expect(changedTeams(undefined, board([row(1, 42_000, 1)]))).toEqual([])
  })

  it('reports teams whose best lap or attempts changed', () => {
    const prev = board([row(1, 42_000, 1), row(2, 43_000, 1), row(3, null, 0)])
    const next = board([row(1, 42_000, 1), row(2, 41_000, 2), row(3, null, 1)])
    expect(changedTeams(prev, next)).toEqual([2, 3])
  })

  it('ignores a team that only moved because another team got faster', () => {
    const prev = board([row(1, 42_000, 4, 1), row(2, 43_000, 4, 2)])
    const next = board([row(2, 41_000, 5, 1), row(1, 42_000, 4, 2)])
    expect(changedTeams(prev, next)).toEqual([2])
  })

  it('highlights a team when a ruling changes its row', () => {
    const prev = board([row(1, 42_000, 4)])
    const next = board([{ ...row(1, 42_000, 4), fa: false, fa_lost: true }])
    expect(changedTeams(prev, next)).toEqual([1])
  })
})
