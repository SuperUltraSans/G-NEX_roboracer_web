import { describe, expect, it } from 'vitest'
import type { LiveState, TeamPublic } from '../../api/types'
import { mappingRows } from './mapping'

const team = (id: number): TeamPublic => ({
  id,
  name_ko: `팀${id}`,
  name_en: `Team ${id}`,
  affiliation_ko: null,
  affiliation_en: null,
})

const state = (phase: LiveState['phase'], onTrack: number | null, done: number[]): LiveState => ({
  phase,
  on_track_team: onTrack ? team(onTrack) : null,
  current_match: null,
  message_ko: null,
  message_en: null,
  updated_at: '2026-11-01T10:30:00Z',
  mapping: [3, 1, 2, 4].map((id, index) => ({
    order: index + 1,
    team: team(id),
    mapped_at: done.includes(id) ? '2026-11-01T10:35:00Z' : null,
  })),
})

const statuses = (s: LiveState) => mappingRows(s).map((row) => `${row.team.id}:${row.status}`)

describe('mappingRows', () => {
  it('맵핑 중인 팀과 다음 차례를 표시한다', () => {
    expect(statuses(state('mapping', 1, [3]))).toEqual([
      '3:done',
      '1:onTrack',
      '2:next',
      '4:waiting',
    ])
  })

  it('맵핑 단계가 아니면 트랙 위 팀이 있어도 맵핑 중으로 보지 않는다', () => {
    expect(statuses(state('practice', 1, [3]))).toEqual([
      '3:done',
      '1:next',
      '2:waiting',
      '4:waiting',
    ])
  })

  it('마친 팀은 트랙 위에 남아 있어도 완료', () => {
    expect(statuses(state('mapping', 3, [3]))).toEqual([
      '3:done',
      '1:next',
      '2:waiting',
      '4:waiting',
    ])
  })

  it('순서를 섞기 전이면 빈 목록', () => {
    expect(mappingRows(undefined)).toEqual([])
    expect(mappingRows({ ...state('idle', null, []), mapping: [] })).toEqual([])
  })
})
