import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { cacheActions, nextSeq, reconnectActions } from './messages'
import type { LiveMessage } from './types'

const ts = '2026-11-01T05:12:33.120Z'
const leaderboard = { scoring: 'best_lap' as const, rows: [] }
const bracket = { rounds: [] }
const liveState = {
  phase: 'idle' as const,
  on_track_team: null,
  current_match: null,
  message_ko: null,
  message_en: null,
  updated_at: ts,
}

const snapshot = (seq: number): LiveMessage => ({
  type: 'snapshot',
  seq,
  ts,
  data: { live_state: liveState, leaderboard, bracket },
})
const lap = (seq: number): LiveMessage => ({
  type: 'qualifying.updated',
  seq,
  ts,
  data: leaderboard,
})

describe('nextSeq', () => {
  it('accepts increasing seq and drops stale or duplicate messages', () => {
    let last = nextSeq(null, snapshot(10))
    expect(last).toBe(10)
    last = nextSeq(last, lap(11))
    expect(last).toBe(11)
    expect(nextSeq(last, lap(11))).toBeNull()
    expect(nextSeq(last, lap(7))).toBeNull()
  })

  it('always applies a snapshot and resets the baseline after a server restart', () => {
    const last = 42
    expect(nextSeq(last, snapshot(0))).toBe(0)
    expect(nextSeq(0, lap(1))).toBe(1)
  })

  it('does not move the baseline on pong', () => {
    expect(nextSeq(5, { type: 'pong', seq: 3, ts, data: {} })).toBe(5)
  })
})

describe('cacheActions', () => {
  it('writes snapshot data straight into the cache', () => {
    expect(cacheActions(snapshot(1))).toEqual([
      { kind: 'set', key: queryKeys.liveState, data: liveState },
      { kind: 'set', key: queryKeys.leaderboard, data: leaderboard },
      { kind: 'set', key: queryKeys.bracket, data: bracket },
    ])
  })

  it('invalidates content queries on content.updated', () => {
    expect(
      cacheActions({ type: 'content.updated', seq: 2, ts, data: { resource: 'schedule' } }),
    ).toEqual([{ kind: 'invalidate', key: ['schedule'] }])
    expect(
      cacheActions({ type: 'content.updated', seq: 3, ts, data: { resource: 'settings' } }),
    ).toEqual([{ kind: 'invalidate', key: ['settings'] }])
  })

  it('refreshes every content query after reconnecting', () => {
    const keys = reconnectActions().map((action) => action.key)
    expect(keys).toEqual([['schedule'], ['rules'], ['settings'], ['teams']])
  })
})
