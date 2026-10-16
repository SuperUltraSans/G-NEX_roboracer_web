import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import type {
  PageKey,
  PublicSettings,
  RuleSectionPublic,
  ScheduleItemPublic,
  TeamPublic,
} from '../../api/types'

export const DEFAULT_TIMEZONE = 'Asia/Seoul'

export function usePublicSettings() {
  return useQuery({
    queryKey: queryKeys.settingsPublic,
    queryFn: () => api.get<PublicSettings>('/api/settings/public'),
  })
}

/** 화면 표시 기준 시간대. 설정을 받기 전에는 기본값을 쓴다. */
export function useEventTimezone(): string {
  return usePublicSettings().data?.event_timezone ?? DEFAULT_TIMEZONE
}

export type PageStatus = 'pending' | 'open' | 'closed'

/**
 * 관리자가 이 공개 페이지를 닫았는지와, 닫혔을 때 보일 문구(관리자가 쓴 것. 없으면 null).
 * 설정을 받기 전에는 pending 이고, 설정을 못 받으면 열린 것으로 본다.
 */
export function usePageState(page: PageKey): { status: PageStatus; note: string | null } {
  const settings = usePublicSettings()
  const lang = useLang()
  if (settings.isPending) return { status: 'pending', note: null }
  const state = settings.data?.pages[page]
  if (!state || state.open) return { status: 'open', note: null }
  return { status: 'closed', note: pickLocalized(state, 'note', lang) }
}

/** 페이지가 닫혀 있으면 받지 않는다 (서버도 닫힌 페이지의 내용은 내주지 않는다) */
export function useSchedule(enabled = true) {
  return useQuery({
    queryKey: queryKeys.schedule,
    queryFn: () => api.get<ScheduleItemPublic[]>('/api/schedule'),
    enabled,
  })
}

export function useRules(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => api.get<RuleSectionPublic[]>('/api/rules'),
    enabled,
  })
}

export function useTeams() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => api.get<TeamPublic[]>('/api/teams'),
  })
}
