import { describe, expect, it } from 'vitest'
import {
  dateKey,
  endsAtMidnight,
  formatEndTime,
  formatTime,
  localInputToUtc,
  utcToLocalInput,
} from './time'

const SEOUL = 'Asia/Seoul'

describe('event timezone conversion', () => {
  it('converts local wall time to UTC', () => {
    expect(localInputToUtc('2026-11-14T09:30', SEOUL)).toBe('2026-11-14T00:30:00.000Z')
    expect(localInputToUtc('2026-11-14T03:00', SEOUL)).toBe('2026-11-13T18:00:00.000Z')
  })

  it('handles zones with daylight saving time', () => {
    expect(localInputToUtc('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z')
    expect(localInputToUtc('2026-12-01T12:00', 'America/New_York')).toBe('2026-12-01T17:00:00.000Z')
  })

  it('round-trips through the input format', () => {
    const iso = '2026-11-13T18:05:00.000Z'
    expect(utcToLocalInput(iso, SEOUL)).toBe('2026-11-14T03:05')
    expect(localInputToUtc(utcToLocalInput(iso, SEOUL), SEOUL)).toBe(iso)
  })

  it('rejects malformed input', () => {
    expect(localInputToUtc('2026-11-14', SEOUL)).toBeNull()
  })

  it('groups and formats by the event timezone', () => {
    expect(dateKey('2026-11-13T18:00:00Z', SEOUL)).toBe('2026-11-14')
    expect(formatTime('2026-11-13T18:00:00Z', SEOUL)).toBe('03:00')
  })
})

describe('formatEndTime', () => {
  it('다음 날 00:00 에 끝나면 24:00 으로 적는다', () => {
    // 서울 11월 1일 22:00 ~ 11월 2일 00:00
    expect(formatEndTime('2026-11-01T13:00:00Z', '2026-11-01T15:00:00Z', 'Asia/Seoul')).toBe(
      '24:00',
    )
    expect(formatEndTime('2026-11-01T13:00:00Z', '2026-11-01T14:30:00Z', 'Asia/Seoul')).toBe(
      '23:30',
    )
    // 이틀 뒤 00:00 은 24:00 이 아니다
    expect(endsAtMidnight('2026-11-01T13:00:00Z', '2026-11-02T15:00:00Z', 'Asia/Seoul')).toBe(false)
  })
})
