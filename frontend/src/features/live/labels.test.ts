import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import type { BracketSlot, LeaderboardRow } from '../../api/types'
import { faMark, matchResult, missionProgress, slotPlaceholder } from './labels'

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction

const slot = (sourceRank: number): BracketSlot => ({
  id: 1,
  slot_index: 0,
  team: null,
  seed_rank: null,
  source_match_id: 7,
  source_match_label: 'Race 7',
  source_rank: sourceRank,
  placeholder_ko: null,
  placeholder_en: null,
  result_rank: null,
  result_text: null,
})

describe('matchResult', () => {
  it('uses win and loss for a two-team match', () => {
    expect(matchResult(t, 1, 2)).toBe('live.bracket.win')
    expect(matchResult(t, 2, 2)).toBe('live.bracket.loss')
  })

  it('keeps places when more teams race together', () => {
    expect(matchResult(t, 2, 4)).toBe('live.bracket.winner {"rank":2}')
  })
})

describe('slotPlaceholder', () => {
  it('names the winner or loser of a two-team match', () => {
    expect(slotPlaceholder(slot(1), 'ko', t, 2)).toBe('live.bracket.sourceWin {"match":"Race 7"}')
    expect(slotPlaceholder(slot(2), 'ko', t, 2)).toBe('live.bracket.sourceLoss {"match":"Race 7"}')
  })

  it('falls back to the place when the source match is unknown or larger', () => {
    expect(slotPlaceholder(slot(2), 'ko', t)).toBe(
      'live.bracket.source {"match":"Race 7","rank":2}',
    )
    expect(slotPlaceholder(slot(3), 'ko', t, 4)).toBe(
      'live.bracket.source {"match":"Race 7","rank":3}',
    )
  })
})

const progress = (overrides: Partial<LeaderboardRow>): LeaderboardRow => ({
  rank: 1,
  team: { id: 1, name_ko: '팀', name_en: '', affiliation_ko: null, affiliation_en: null },
  fa: false,
  fa_lost: false,
  missions_passed: 1,
  current_mission: 'Q2',
  current_streak: 2,
  q1_laps: 3,
  q2_laps: 2,
  q3_best_ms: null,
  rank_drops: 0,
  attempts: 6,
  last_recorded_at: null,
  ...overrides,
})

describe('missionProgress', () => {
  it('shows the streak in the current mission, waiting, or all passed', () => {
    expect(missionProgress(t, progress({}))).toBe(
      'live.leaderboard.streak {"mission":"Q2","count":2}',
    )
    expect(missionProgress(t, progress({ attempts: 0 }))).toBe('live.leaderboard.waiting')
    expect(missionProgress(t, progress({ missions_passed: 3 }))).toBe('live.leaderboard.allPassed')
  })
})

describe('faMark', () => {
  it('is open while the team is waiting or on track, and no once it has run without FA', () => {
    expect(faMark(progress({ fa: true }), false)).toBe('yes')
    expect(faMark(progress({ fa_lost: true }), true)).toBe('no')
    expect(faMark(progress({}), true)).toBe('open')
    expect(faMark(progress({ attempts: 0 }), false)).toBe('open')
    expect(faMark(progress({}), false)).toBe('no')
  })
})
