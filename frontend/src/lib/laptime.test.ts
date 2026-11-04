import { describe, expect, it } from 'vitest'
import { formatGap, formatLap, parseLap } from './laptime'

describe('parseLap', () => {
  it('accepts ss.SS', () => {
    expect(parseLap('42.14')).toEqual({ ok: true, ms: 42_140 })
    expect(parseLap(' 5.00 ')).toEqual({ ok: true, ms: 5_000 })
    expect(parseLap('9.05')).toEqual({ ok: true, ms: 9_050 })
  })

  it('accepts m:ss.SS', () => {
    expect(parseLap('0:42.14')).toEqual({ ok: true, ms: 42_140 })
    expect(parseLap('1:02.50')).toEqual({ ok: true, ms: 62_500 })
    expect(parseLap('10:00.00')).toEqual({ ok: true, ms: 600_000 })
  })

  it('rejects other formats', () => {
    for (const input of [
      '',
      '42',
      '42.1',
      '42.137',
      '1:2.00',
      '1:60.00',
      '1:02.345',
      'abc',
      '-1.00',
      '1.2.3',
    ]) {
      expect(parseLap(input)).toEqual({ ok: false, reason: 'format' })
    }
  })

  it('rejects values outside 1,000..600,000 ms', () => {
    expect(parseLap('0.99')).toEqual({ ok: false, reason: 'range' })
    expect(parseLap('1.00')).toEqual({ ok: true, ms: 1_000 })
    expect(parseLap('10:00.01')).toEqual({ ok: false, reason: 'range' })
  })
})

describe('formatLap', () => {
  it('formats as m:ss.SS', () => {
    expect(formatLap(42_140)).toBe('0:42.14')
    expect(formatLap(62_050)).toBe('1:02.05')
    expect(formatLap(600_000)).toBe('10:00.00')
  })

  it('rounds values that are not on the 0.01 s step', () => {
    expect(formatLap(42_137)).toBe('0:42.14')
    expect(formatLap(42_134)).toBe('0:42.13')
    expect(formatLap(59_995)).toBe('1:00.00')
  })

  it('round-trips with parseLap', () => {
    for (const ms of [1_000, 42_140, 59_990, 60_000, 599_990]) {
      expect(parseLap(formatLap(ms))).toEqual({ ok: true, ms })
    }
  })
})

describe('formatGap', () => {
  it('formats with a plus sign', () => {
    expect(formatGap(510)).toBe('+0.51')
    expect(formatGap(0)).toBe('+0.00')
    expect(formatGap(12_340)).toBe('+12.34')
    expect(formatGap(61_230)).toBe('+1:01.23')
  })
})
