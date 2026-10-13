import { contentKeys, queryKeys } from '../../api/queryKeys'
import type { LiveMessage } from './types'

export type CacheAction =
  | { kind: 'set'; key: readonly unknown[]; data: unknown }
  | { kind: 'invalidate'; key: readonly unknown[] }

/**
 * seq 규칙: 마지막으로 처리한 seq 이하인 메시지는 버린다.
 * snapshot 은 항상 적용하고 그 seq 로 기준을 새로 잡는다 (서버가 재시작하면 seq 가 처음부터 다시 시작한다).
 * 반환값이 null 이면 메시지를 버린다.
 */
export function nextSeq(lastSeq: number | null, message: LiveMessage): number | null {
  if (message.type === 'snapshot') return message.seq
  if (message.type === 'pong') return lastSeq ?? message.seq
  if (lastSeq !== null && message.seq <= lastSeq) return null
  return message.seq
}

/** 메시지 하나가 쿼리 캐시에 할 일 */
export function cacheActions(message: LiveMessage): CacheAction[] {
  switch (message.type) {
    case 'snapshot':
      return [
        { kind: 'set', key: queryKeys.liveState, data: message.data.live_state },
        { kind: 'set', key: queryKeys.leaderboard, data: message.data.leaderboard },
        { kind: 'set', key: queryKeys.bracket, data: message.data.bracket },
      ]
    case 'live_state.updated':
      return [{ kind: 'set', key: queryKeys.liveState, data: message.data }]
    case 'qualifying.updated':
      return [
        { kind: 'set', key: queryKeys.leaderboard, data: message.data },
        // 다른 심판이 넣은 기록도 관리자 최근 기록 목록에 보이도록 다시 가져온다
        { kind: 'invalidate', key: queryKeys.laps },
      ]
    case 'bracket.updated':
      return [{ kind: 'set', key: queryKeys.bracket, data: message.data }]
    case 'content.updated':
      return [{ kind: 'invalidate', key: contentKeys[message.data.resource] }]
    case 'pong':
      return []
  }
}

/** 재연결에 성공하면 끊긴 동안 놓친 콘텐츠 변경을 다시 가져온다 */
export function reconnectActions(): CacheAction[] {
  return Object.values(contentKeys).map((key) => ({ kind: 'invalidate', key }))
}
