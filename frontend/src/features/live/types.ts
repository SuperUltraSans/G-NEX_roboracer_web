// /ws/live 메시지 형식. 백엔드 backend/app/schemas/live.py 와 같은 구조로 유지한다.
// (WebSocket 메시지는 OpenAPI 에 들어가지 않으므로 두 파일을 함께 고친다.)
import type { Bracket, Leaderboard, LiveState } from '../../api/types'

export type ContentResource = 'schedule' | 'rules' | 'settings' | 'teams' | 'ranking'

interface Envelope<T extends string, D> {
  type: T
  seq: number
  ts: string
  data: D
}

export type SnapshotMessage = Envelope<
  'snapshot',
  { live_state: LiveState; leaderboard: Leaderboard; bracket: Bracket }
>
export type LiveStateUpdatedMessage = Envelope<'live_state.updated', LiveState>
export type QualifyingUpdatedMessage = Envelope<'qualifying.updated', Leaderboard>
export type BracketUpdatedMessage = Envelope<'bracket.updated', Bracket>
export type ContentUpdatedMessage = Envelope<'content.updated', { resource: ContentResource }>
export type PongMessage = Envelope<'pong', Record<string, never>>

export type LiveMessage =
  | SnapshotMessage
  | LiveStateUpdatedMessage
  | QualifyingUpdatedMessage
  | BracketUpdatedMessage
  | ContentUpdatedMessage
  | PongMessage

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'off'
