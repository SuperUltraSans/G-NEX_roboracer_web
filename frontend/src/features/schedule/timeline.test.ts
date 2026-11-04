import { describe, expect, it } from 'vitest'
import type { ScheduleItemPublic } from '../../api/types'
import { currentAndNext } from './timeline'

const item = (id: number, start: string, end: string | null): ScheduleItemPublic => ({
  id,
  starts_at: start,
  ends_at: end,
  title_ko: `임시 ${id}`,
  title_en: '',
  location_ko: null,
  location_en: null,
  description_ko: null,
  description_en: null,
  sort_order: id,
  updated_at: start,
})

const items = [
  item(1, '2026-11-01T09:30:00Z', '2026-11-01T10:00:00Z'),
  item(2, '2026-11-01T10:00:00Z', '2026-11-01T10:30:00Z'),
  item(3, '2026-11-01T12:00:00Z', null),
]
const at = (iso: string) => Date.parse(iso)

describe('currentAndNext', () => {
  it('진행 중인 일정과 그 뒤 처음 시작하는 일정', () => {
    const { current, next } = currentAndNext(items, at('2026-11-01T09:45:00Z'))
    expect([current?.id, next?.id]).toEqual([1, 2])
  })

  it('일정 사이에는 진행 중이 없고 다음만 있다', () => {
    const { current, next } = currentAndNext(items, at('2026-11-01T11:00:00Z'))
    expect([current, next?.id]).toEqual([null, 3])
  })

  it('끝 시각이 없는 일정은 진행 중으로 보지 않고, 다 끝나면 둘 다 없다', () => {
    expect(currentAndNext(items, at('2026-11-01T12:30:00Z'))).toEqual({ current: null, next: null })
  })
})
