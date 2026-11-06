import { useSyncExternalStore } from 'react'

// 방금 갱신된 리더보드 행과 대진 매치를 1.5초 동안 강조한다
const HIGHLIGHT_MS = 1500

interface Highlights {
  teams: ReadonlySet<number>
  matches: ReadonlySet<number>
  /** 화면 낭독용: 가장 최근에 기록이 바뀐 팀 */
  lastTeamId: number | null
}

let state: Highlights = { teams: new Set(), matches: new Set(), lastTeamId: null }
const listeners = new Set<() => void>()

function emit(next: Highlights) {
  state = next
  listeners.forEach((listener) => listener())
}

function mark(kind: 'teams' | 'matches', ids: number[]) {
  if (ids.length === 0) return
  const added = new Set([...state[kind], ...ids])
  emit({ ...state, [kind]: added, ...(kind === 'teams' ? { lastTeamId: ids.at(-1) ?? null } : {}) })
  window.setTimeout(() => {
    const remaining = new Set(state[kind])
    ids.forEach((id) => remaining.delete(id))
    emit({ ...state, [kind]: remaining })
  }, HIGHLIGHT_MS)
}

export const highlightTeams = (ids: number[]) => mark('teams', ids)
export const highlightMatches = (ids: number[]) => mark('matches', ids)

export function useHighlights(): Highlights {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}
