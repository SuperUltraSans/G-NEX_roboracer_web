import { describe, expect, it } from 'vitest'
import { pickLocalized } from './localized'

describe('pickLocalized', () => {
  const item = { title_ko: '예선', title_en: 'Qualifying', location_ko: '체육관', location_en: '' }

  it('returns the value for the requested language', () => {
    expect(pickLocalized(item, 'title', 'ko')).toBe('예선')
    expect(pickLocalized(item, 'title', 'en')).toBe('Qualifying')
  })

  it('falls back to Korean when English is empty or missing', () => {
    expect(pickLocalized(item, 'location', 'en')).toBe('체육관')
    expect(pickLocalized({ name_ko: '팀', name_en: null }, 'name', 'en')).toBe('팀')
    expect(pickLocalized({ name_ko: '팀', name_en: '   ' }, 'name', 'en')).toBe('팀')
  })

  it('returns null when both are empty', () => {
    expect(
      pickLocalized({ description_ko: null, description_en: null }, 'description', 'en'),
    ).toBeNull()
    expect(pickLocalized(null, 'title', 'ko')).toBeNull()
  })
})
