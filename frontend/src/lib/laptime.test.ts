import { describe, expect, it } from 'vitest'
import { formatGap, formatLap, parseLap } from './laptime'

describe('parseLap', () => {
  it('accepts ss.SSS', () => {
    expect(parseLap('42.137')).toEqual({ ok: true, ms: 42_137 })
    expect(parseLap(' 5.000 ')).toEqual({ ok: true, ms: 5_000 })
  })

  it('accepts m:ss.SSS', () => {
    expect(parseLap('0:42.137')).toEqual({ ok: true, ms: 42_137 })
    expect(parseLap('1:02.500')).toEqual({ ok: true, ms: 62_500 })
    expect(parseLap('10:00.000')).toEqual({ ok: true, ms: 600_000 })
  })

  it('rejects other formats', () => {
    for (const input of [
      '',
      '42',
      '42.1',
      '42.1370',
      '1:2.000',
      '1:60.000',
      'abc',
      '-1.000',
      '1.2.3',
    ]) {
      expect(parseLap(input)).toEqual({ ok: false, reason: 'format' })
    }
  })

  it('rejects values outside 1,000..600,000 ms', () => {
    expect(parseLap('0.999')).toEqual({ ok: false, reason: 'range' })
    expect(parseLap('1.000')).toEqual({ ok: true, ms: 1_000 })
    expect(parseLap('10:00.001')).toEqual({ ok: false, reason: 'range' })
  })
})

describe('formatLap', () => {
  it('formats as m:ss.SSS', () => {
    expect(formatLap(42_137)).toBe('0:42.137')
    expect(formatLap(62_005)).toBe('1:02.005')
    expect(formatLap(600_000)).toBe('10:00.000')
  })

  it('round-trips with parseLap', () => {
    for (const ms of [1_000, 42_137, 59_999, 60_000, 599_999]) {
      expect(parseLap(formatLap(ms))).toEqual({ ok: true, ms })
    }
  })
})

describe('formatGap', () => {
  it('formats with a plus sign', () => {
    expect(formatGap(512)).toBe('+0.512')
    expect(formatGap(0)).toBe('+0.000')
    expect(formatGap(12_345)).toBe('+12.345')
    expect(formatGap(61_234)).toBe('+1:01.234')
  })
})
