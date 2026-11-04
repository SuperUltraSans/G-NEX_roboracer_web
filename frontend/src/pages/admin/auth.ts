import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { api, ApiError } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { Role, UserOut } from '../../api/types'

/** 로그인한 사용자. 세션이 없으면(401) null. */
export function useMe(enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.me,
    queryFn: async (): Promise<UserOut | null> => {
      try {
        return await api.get<UserOut>('/api/admin/auth/me')
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: 60_000,
  })
}

export const CurrentUserContext = createContext<UserOut | null>(null)

/** 인증 가드 안에서만 쓴다. */
export function useCurrentUser(): UserOut {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error('useCurrentUser must be used inside RequireAuth')
  return user
}

export function useIsAdmin(): boolean {
  return useCurrentUser().role === 'admin'
}

export type SectionGroup = 'home' | 'event' | 'site' | 'manage'

export interface AdminSection {
  path: string
  key: string
  end?: boolean
  roles: readonly Role[]
  /** 옆 메뉴에서 묶는 갈래 */
  group: SectionGroup
}

const STAFF: readonly Role[] = ['admin', 'referee']
const ADMIN: readonly Role[] = ['admin']

/**
 * 관리자 화면 메뉴. 대회 당일 쓰는 진행 상태·예선 기록·랭킹·본선 결과는 관리자 화면이 아니라
 * 모니터링 관리(/monitoring-admin)에서 한다.
 */
export const SECTIONS: readonly AdminSection[] = [
  { path: '/admin', key: 'dashboard', end: true, roles: STAFF, group: 'home' },
  { path: '/admin/teams', key: 'teams', roles: ADMIN, group: 'event' },
  { path: '/admin/bracket', key: 'bracket', roles: ADMIN, group: 'event' },
  { path: '/admin/schedule', key: 'schedule', roles: ADMIN, group: 'site' },
  { path: '/admin/rules', key: 'rules', roles: ADMIN, group: 'site' },
  { path: '/admin/settings', key: 'settings', roles: ADMIN, group: 'site' },
  { path: '/admin/users', key: 'users', roles: ADMIN, group: 'manage' },
  { path: '/admin/audit', key: 'audit', roles: ADMIN, group: 'manage' },
]

export const SECTION_GROUPS: readonly SectionGroup[] = ['home', 'event', 'site', 'manage']

export function sectionsFor(role: Role): AdminSection[] {
  return SECTIONS.filter((section) => section.roles.includes(role))
}

/** 로그아웃할 때 다음 사용자에게 남지 않게 지울 관리자 전용 캐시 */
export const ADMIN_ONLY_KEYS = [
  queryKeys.settingsAdmin,
  queryKeys.scheduleAdmin,
  queryKeys.rulesAdmin,
  queryKeys.teamsAdmin,
  queryKeys.laps,
  queryKeys.bracketRounds,
  queryKeys.ranking,
  queryKeys.monitorAccess,
  queryKeys.users,
  queryKeys.audit,
] as const
