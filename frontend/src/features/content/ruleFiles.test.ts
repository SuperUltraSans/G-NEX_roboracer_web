import { describe, expect, it } from 'vitest'
import { ruleFileUrl, ruleLinkUrl } from './ruleFiles'

describe('ruleFileUrl', () => {
  it('maps package paths to the rules file endpoint', () => {
    expect(ruleFileUrl('/images/qr.png')).toBe('/api/rules/files/images/qr.png')
    expect(ruleFileUrl('qr.png')).toBe('/api/rules/files/qr.png')
    expect(ruleFileUrl('./img/a b.png')).toBe('/api/rules/files/img/a b.png')
  })

  it('leaves external, protocol-relative, data and fragment URLs alone', () => {
    for (const url of [
      'https://example.com/a.png',
      '//cdn.example.com/a.png',
      'data:image/png;base64,AA',
      '#top',
      '',
    ]) {
      expect(ruleFileUrl(url)).toBe(url)
    }
  })
})

describe('ruleLinkUrl', () => {
  it('maps links to package pictures and leaves page links alone', () => {
    expect(ruleLinkUrl('/images/qr.png')).toBe('/api/rules/files/images/qr.png')
    expect(ruleLinkUrl('/schedule')).toBe('/schedule')
    expect(ruleLinkUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
  })
})
