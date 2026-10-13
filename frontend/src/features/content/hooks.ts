import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type {
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

export function useSchedule() {
  return useQuery({
    queryKey: queryKeys.schedule,
    queryFn: () => api.get<ScheduleItemPublic[]>('/api/schedule'),
  })
}

export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => api.get<RuleSectionPublic[]>('/api/rules'),
  })
}

export function useTeams() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => api.get<TeamPublic[]>('/api/teams'),
  })
}
