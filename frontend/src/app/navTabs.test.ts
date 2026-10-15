import { describe, expect, it } from 'vitest'
import { navMotion } from './navTabs'

describe('navMotion', () => {
  it('메뉴 순서상 뒤 페이지로 가면 오른쪽, 앞 페이지로 가면 왼쪽', () => {
    expect(navMotion('/', '/rules')).toBe('right')
    expect(navMotion('/live', '/schedule')).toBe('left')
    expect(navMotion('/apply', '/')).toBe('left')
  })

  it('같은 메뉴 안이거나 메뉴에 없는 주소면 움직이지 않는다', () => {
    expect(navMotion('/rules', '/rules')).toBeNull()
    expect(navMotion('/nowhere', '/rules')).toBeNull()
    expect(navMotion('/rules', '/nowhere')).toBeNull()
  })

  it('비슷한 이름의 주소를 메뉴로 착각하지 않는다', () => {
    expect(navMotion('/', '/rulesx')).toBeNull()
    expect(navMotion('/', '/live/extra')).toBe('right')
  })
})
