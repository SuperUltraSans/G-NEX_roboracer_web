import type { LiveState, MappingEntry } from '../../api/types'

/** done: 맵핑을 마침, onTrack: 지금 트랙 위에서 맵핑 중, next: 다음 차례, waiting: 기다리는 중 */
export type MappingStatus = 'done' | 'onTrack' | 'next' | 'waiting'

export interface MappingRow extends MappingEntry {
  status: MappingStatus
}

/** 맵핑 순서의 팀마다 지금 상태. 다음 차례는 아직 하지 않은 팀 중 가장 앞(트랙 위 팀은 빼고) */
export function mappingRows(state: LiveState | undefined): MappingRow[] {
  const entries = state?.mapping ?? []
  const onTrackId = state?.phase === 'mapping' ? state.on_track_team?.id : undefined
  let nextGiven = false
  return entries.map((entry) => {
    if (entry.mapped_at) return { ...entry, status: 'done' }
    if (entry.team.id === onTrackId) return { ...entry, status: 'onTrack' }
    if (!nextGiven) {
      nextGiven = true
      return { ...entry, status: 'next' }
    }
    return { ...entry, status: 'waiting' }
  })
}
