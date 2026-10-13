import { describe, expect, it } from 'vitest'
import { dateKey, formatTime, localInputToUtc, utcToLocalInput } from './time'

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
