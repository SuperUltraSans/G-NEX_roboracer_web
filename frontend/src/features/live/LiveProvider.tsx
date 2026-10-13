import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, type ReactNode } from 'react'
import { queryKeys } from '../../api/queryKeys'
import type { Bracket, Leaderboard } from '../../api/types'
import { changedMatches, changedTeams } from './diff'
import { highlightMatches, highlightTeams } from './highlights'
import { LiveStatusContext } from './liveStatus'
import { cacheActions, nextSeq, reconnectActions, type CacheAction } from './messages'
import type { LiveMessage } from './types'
import { useLiveFeed } from './useLiveFeed'

/** 앱 루트에서 WebSocket 을 한 번만 연결하고, 받은 메시지로 쿼리 캐시를 갱신한다. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const lastSeq = useRef<number | null>(null)

  const apply = useCallback(
    (actions: CacheAction[]) => {
      for (const action of actions) {
        if (action.kind === 'set') queryClient.setQueryData(action.key, action.data)
        else void queryClient.invalidateQueries({ queryKey: action.key })
      }
    },
    [queryClient],
  )

  const status = useLiveFeed({
    onMessage: (message: LiveMessage) => {
      const seq = nextSeq(lastSeq.current, message)
      if (seq === null) return
      lastSeq.current = seq
      if (message.type === 'qualifying.updated') {
        const prev = queryClient.getQueryData<Leaderboard>(queryKeys.leaderboard)
        highlightTeams(changedTeams(prev, message.data))
      }
      if (message.type === 'bracket.updated') {
        const prev = queryClient.getQueryData<Bracket>(queryKeys.bracket)
        highlightMatches(changedMatches(prev, message.data))
      }
      apply(cacheActions(message))
    },
    onReconnect: () => apply(reconnectActions()),
  })

  return <LiveStatusContext.Provider value={status}>{children}</LiveStatusContext.Provider>
}
