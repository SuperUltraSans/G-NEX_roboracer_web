import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { api, ApiError } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { Role, UserOut } from '../../api/types'

/** 로그인한 사용자. 세션이 없으면(401) null. */
export function useMe() {
  return useQuery({
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

export interface AdminSection {
  path: string
  key: string
  end?: boolean
  roles: readonly Role[]
}

const STAFF: readonly Role[] = ['admin', 'referee']
const ADMIN: readonly Role[] = ['admin']

/** 관리자 화면 메뉴. 권한 표는 doc/Instruction.md 5.4. */
export const SECTIONS: readonly AdminSection[] = [
  { path: '/admin', key: 'dashboard', end: true, roles: STAFF },
  { path: '/admin/live', key: 'live', roles: STAFF },
  { path: '/admin/qualifying', key: 'qualifying', roles: STAFF },
  { path: '/admin/bracket', key: 'bracket', roles: STAFF },
  { path: '/admin/teams', key: 'teams', roles: ADMIN },
  { path: '/admin/schedule', key: 'schedule', roles: ADMIN },
  { path: '/admin/rules', key: 'rules', roles: ADMIN },
  { path: '/admin/settings', key: 'settings', roles: ADMIN },
  { path: '/admin/users', key: 'users', roles: ADMIN },
  { path: '/admin/audit', key: 'audit', roles: ADMIN },
]

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
  queryKeys.users,
  queryKeys.audit,
] as const
