import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { Bracket, Leaderboard, LiveState } from '../../api/types'

export function useLiveState() {
  return useQuery({
    queryKey: queryKeys.liveState,
    queryFn: () => api.get<LiveState>('/api/live/state'),
  })
}

export function useLeaderboard() {
  return useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: () => api.get<Leaderboard>('/api/qualifying/leaderboard'),
  })
}

export function useBracket() {
  return useQuery({
    queryKey: queryKeys.bracket,
    queryFn: () => api.get<Bracket>('/api/bracket'),
  })
}
