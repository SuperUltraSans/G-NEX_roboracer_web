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

const PUBLISHABLE = new Set(['schedule', 'rules', 'settings'])

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
        // 다른 심판이 넣은 기록·판정·검사 순서도 운영 콘솔에 보이도록 다시 가져온다
        { kind: 'invalidate', key: queryKeys.laps },
        { kind: 'invalidate', key: queryKeys.qualifyingEvents },
        { kind: 'invalidate', key: queryKeys.inspection },
      ]
    case 'bracket.updated':
      return [{ kind: 'set', key: queryKeys.bracket, data: message.data }]
    case 'content.updated': {
      // 이 화면이 모르는 자료(배포 직후 예전 화면 등)면 아무것도 하지 않는다.
      // key 가 없으면 모든 쿼리를 다시 가져오게 되기 때문이다
      const keys: Partial<Record<string, readonly unknown[]>> = contentKeys
      const key = keys[message.data.resource]
      if (!key) return []
      // 일정·규칙·설정이 바뀌면 게시하지 않은 변경이 생겼는지도 다시 본다
      return PUBLISHABLE.has(message.data.resource)
        ? [
            { kind: 'invalidate', key },
            { kind: 'invalidate', key: queryKeys.publish },
          ]
        : [{ kind: 'invalidate', key }]
    }
    case 'pong':
      return []
  }
}

/** 재연결에 성공하면 끊긴 동안 놓친 콘텐츠 변경을 다시 가져온다 */
export function reconnectActions(): CacheAction[] {
  return Object.values(contentKeys).map((key) => ({ kind: 'invalidate', key }))
}
