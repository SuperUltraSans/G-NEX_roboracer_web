/** 헤더 메뉴 순서. 페이지를 옮길 때 이 순서로 왼쪽/오른쪽 방향을 정한다 */
export const NAV_TABS = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/schedule', key: 'nav.schedule' },
  { to: '/rules', key: 'nav.rules' },
  { to: '/apply', key: 'nav.apply' },
  { to: '/live', key: 'nav.live' },
  { to: '/results', key: 'nav.results' },
] as const

export type NavMotion = 'left' | 'right'

function navPosition(pathname: string): number {
  return NAV_TABS.findIndex(
    (tab) => pathname === tab.to || (!('end' in tab) && pathname.startsWith(`${tab.to}/`)),
  )
}

/** 메뉴에 있는 두 페이지 사이를 옮길 때만 방향을 준다 (없는 주소, 같은 페이지는 null) */
export function navMotion(from: string, to: string): NavMotion | null {
  const before = navPosition(from)
  const after = navPosition(to)
  if (before === -1 || after === -1 || before === after) return null
  return after > before ? 'right' : 'left'
}
