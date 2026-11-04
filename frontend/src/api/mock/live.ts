// mock 모드의 가짜 실시간 발생기: 3초마다 예선 랩을 하나 추가하고, 가끔 매치를 진행·종료시킨다.
import type { LiveMessage } from '../../features/live/types'
import {
  addLap,
  bracket,
  finishMatch,
  laps,
  leaderboard,
  live,
  liveState,
  matches,
  resetBracket,
  seedFromRanking,
  teams,
} from './state'

const TICK_MS = 3_000

export function startMockFeed(onMessage: (message: LiveMessage) => void): () => void {
  let seq = 0
  const ts = () => new Date().toISOString()
  const send = (type: Exclude<LiveMessage['type'], 'snapshot' | 'pong'>, data: unknown) => {
    seq += 1
    onMessage({ type, seq, ts: ts(), data } as LiveMessage)
  }

  onMessage({
    type: 'snapshot',
    seq,
    ts: ts(),
    data: { live_state: liveState(), leaderboard: leaderboard(), bracket: bracket() },
  })

  let tick = 0
  const timer = window.setInterval(() => {
    tick += 1

    // 매 틱: 트랙 위 팀이 랩을 하나 기록하고 다음 팀이 트랙에 오른다
    const team = teams[(tick + 2) % teams.length]
    const attempts = laps.filter((lap) => lap.team_id === team.id).length
    const mission = leaderboard().rows.find((row) => row.team.id === team.id)?.current_mission
    const invalid = (tick * 31 + team.id) % 5 === 0
    const time = 39_000 + ((team.id * 7919 + attempts * 104_729 + tick * 13) % 700) * 10
    addLap(
      team.id,
      mission ?? 'Q1',
      invalid ? 'invalid' : 'valid',
      mission === 'Q3' && !invalid ? time : null,
      Date.now(),
    )
    send('qualifying.updated', leaderboard())

    // 4틱마다 본선을 한 단계 진행한다: 시작 → 종료
    if (tick % 4 === 0) {
      const running = matches.find((item) => item.status === 'live')
      if (running) {
        const winnerFirst = (running.id + tick) % 2 === 0
        finishMatch(running, winnerFirst ? [1, 2] : [2, 1])
        live.matchId = null
      } else {
        const next = matches.find(
          (item) =>
            item.status === 'scheduled' && item.slots.every((slot) => slot.team_id !== null),
        )
        if (next) {
          next.status = 'live'
          next.version += 1
          live.matchId = next.id
        } else {
          resetBracket()
        }
      }
      seedFromRanking()
      send('bracket.updated', bracket())
    }

    live.onTrack = teams[(tick + 3) % teams.length].id
    live.phase = live.matchId ? 'bracket' : 'qualifying'
    live.updated = ts()
    send('live_state.updated', liveState())
  }, TICK_MS)

  return () => window.clearInterval(timer)
}
