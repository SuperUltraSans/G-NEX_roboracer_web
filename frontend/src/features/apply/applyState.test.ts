import { describe, expect, it } from 'vitest'
import { applyState } from './applyState'

const base = {
  apply_form_url: 'https://forms.example/apply',
  apply_open_at: '2026-11-01T00:00:00Z',
  apply_close_at: '2026-11-10T00:00:00Z',
  event_timezone: 'Asia/Seoul',
}

describe('applyState', () => {
  it('is not ready without a form URL', () => {
    expect(applyState({ ...base, apply_form_url: null }, Date.parse('2026-11-05T00:00:00Z'))).toBe(
      'notReady',
    )
  })

  it('follows the registration period', () => {
    expect(applyState(base, Date.parse('2026-10-31T23:59:59Z'))).toBe('upcoming')
    expect(applyState(base, Date.parse('2026-11-05T00:00:00Z'))).toBe('open')
    expect(applyState(base, Date.parse('2026-11-10T00:00:01Z'))).toBe('closed')
  })

  it('is open when the period is not set', () => {
    expect(applyState({ ...base, apply_open_at: null, apply_close_at: null }, Date.now())).toBe(
      'open',
    )
  })
})
