import { describe, expect, it } from 'vitest'
import type { Leaderboard, LeaderboardRow } from '../../api/types'
import { changedTeams } from './diff'

const team = (id: number) => ({
  id,
  car_number: id,
  name_ko: `팀 ${id}`,
  name_en: '',
  affiliation_ko: null,
  affiliation_en: null,
})
const row = (id: number, best: number | null, attempts: number): LeaderboardRow => ({
  rank: best === null ? null : id,
  team: team(id),
  best_lap_ms: best,
  gap_ms: null,
  attempts,
  last_recorded_at: null,
})
const board = (rows: LeaderboardRow[]): Leaderboard => ({ scoring: 'best_lap', rows })

describe('changedTeams', () => {
  it('reports nothing for the first data', () => {
    expect(changedTeams(undefined, board([row(1, 42_000, 1)]))).toEqual([])
  })

  it('reports teams whose best lap or attempts changed', () => {
    const prev = board([row(1, 42_000, 1), row(2, 43_000, 1), row(3, null, 0)])
    const next = board([row(1, 42_000, 1), row(2, 41_000, 2), row(3, null, 1)])
    expect(changedTeams(prev, next)).toEqual([2, 3])
  })
})
