import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { Bracket, Leaderboard, LiveState } from '../../api/types'

// 실시간 데이터는 WebSocket 메시지가 캐시를 직접 갱신한다. REST 는 첫 화면과 재연결 보완용이다.
const live = { staleTime: Infinity } as const

export function useLiveState() {
  return useQuery({
    queryKey: queryKeys.liveState,
    queryFn: () => api.get<LiveState>('/api/live/state'),
    ...live,
  })
}

export function useLeaderboard() {
  return useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: () => api.get<Leaderboard>('/api/qualifying/leaderboard'),
    ...live,
  })
}

export function useBracket() {
  return useQuery({
    queryKey: queryKeys.bracket,
    queryFn: () => api.get<Bracket>('/api/bracket'),
    ...live,
  })
}
