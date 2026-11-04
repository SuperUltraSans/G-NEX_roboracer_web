import type { BracketRound } from '../../api/types'

/** 앞 경기의 패자만 받는 라운드(3·4위전, 5~8위전 등). 본 대진 아래 '순위결정전'으로 따로 보인다 */
export function isPlacementRound(round: BracketRound): boolean {
  const slots = round.matches.flatMap((match) => match.slots)
  return (
    slots.length > 0 && slots.every((slot) => slot.source_rank !== null && slot.source_rank >= 2)
  )
}

export function splitRounds(rounds: BracketRound[]): {
  main: BracketRound[]
  placement: BracketRound[]
} {
  const sorted = [...rounds].sort((a, b) => a.sort_order - b.sort_order)
  return {
    main: sorted.filter((round) => !isPlacementRound(round)),
    placement: sorted.filter(isPlacementRound),
  }
}

export interface WinnerLink {
  /** 승자를 보내는 매치 */
  from: number
  /** 승자를 받는 칸 */
  slot: number
  /** 보내는 매치가 끝나 진출이 정해졌는지 */
  done: boolean
}

/** 본 대진 안에서 앞 경기 승자가 올라가는 길 (화살표로 그린다) */
export function winnerLinks(rounds: BracketRound[]): WinnerLink[] {
  const matches = new Map(
    rounds.flatMap((round) => round.matches).map((match) => [match.id, match]),
  )
  return [...matches.values()].flatMap((match) =>
    match.slots.flatMap((slot) => {
      const source = slot.source_match_id !== null ? matches.get(slot.source_match_id) : undefined
      if (!source || slot.source_rank !== 1) return []
      return [{ from: source.id, slot: slot.id, done: source.status === 'finished' }]
    }),
  )
}
