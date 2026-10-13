import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useCallback } from 'react'
import { queryKeys } from '../../../api/queryKeys'
import type { Bracket, BracketMatch, BracketRound, BracketSlot } from '../../../api/types'
import { pickLocalized, type Lang } from '../../../lib/localized'
import { teamOption } from '../ui/format'

export interface MatchRef {
  match: BracketMatch
  round: BracketRound
}

export function flatMatches(bracket: Bracket | undefined): MatchRef[] {
  return bracket?.rounds.flatMap((round) => round.matches.map((match) => ({ match, round }))) ?? []
}

/** 이 매치의 결과를 받는 슬롯이 있는 매치들 */
export function downstreamMatches(bracket: Bracket | undefined, matchId: number): BracketMatch[] {
  return flatMatches(bracket)
    .map(({ match }) => match)
    .filter((match) => match.slots.some((slot) => slot.source_match_id === matchId))
}

/** 응답으로 받은 매치 하나를 캐시의 대진에 반영한다. 라운드를 옮겼으면 그 라운드로 옮긴다. */
export function replaceMatch(bracket: Bracket, updated: BracketMatch): Bracket {
  return {
    rounds: bracket.rounds.map((round) => {
      const others = round.matches.filter((match) => match.id !== updated.id)
      if (round.id !== updated.round_id) {
        return others.length === round.matches.length ? round : { ...round, matches: others }
      }
      const matches = [...others, updated].sort(
        (a, b) => a.sort_order - b.sort_order || a.id - b.id,
      )
      return { ...round, matches }
    }),
  }
}

/** 409 를 받았을 때 대진을 다시 가져온 뒤 그 매치의 최신 값을 돌려준다. */
export function useReloadMatch() {
  const queryClient = useQueryClient()
  return useCallback(
    async (matchId: number): Promise<BracketMatch | undefined> => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
      const bracket = queryClient.getQueryData<Bracket>(queryKeys.bracket)
      return flatMatches(bracket).find(({ match }) => match.id === matchId)?.match
    },
    [queryClient],
  )
}

export function roundName(round: BracketRound, lang: Lang): string {
  return pickLocalized(round, 'name', lang) ?? ''
}

/** 슬롯이 어디서 채워지는지: "예선 3위", "M2 1위", 또는 자리표시 문구 */
export function slotSource(t: TFunction, slot: BracketSlot): string | null {
  if (slot.seed_rank) return t('admin.bracket.seedSource', { rank: slot.seed_rank })
  if (slot.source_match_label && slot.source_rank) {
    return t('admin.bracket.matchSource', {
      match: slot.source_match_label,
      rank: slot.source_rank,
    })
  }
  return null
}

/** 슬롯 표시: 확정 팀 → 자리표시 문구 → 출처 → 미정 */
export function slotTitle(t: TFunction, slot: BracketSlot, lang: Lang): string {
  if (slot.team) return teamOption(t, slot.team, lang)
  return (
    pickLocalized(slot, 'placeholder', lang) ?? slotSource(t, slot) ?? t('admin.bracket.undecided')
  )
}

export function sortedSlots(match: BracketMatch): BracketSlot[] {
  if (match.status !== 'finished')
    return [...match.slots].sort((a, b) => a.slot_index - b.slot_index)
  return [...match.slots].sort(
    (a, b) =>
      (a.result_rank ?? Infinity) - (b.result_rank ?? Infinity) || a.slot_index - b.slot_index,
  )
}

/** 다음 매치 라벨 제안: 기존 M 번호 중 가장 큰 값 + 1 */
export function nextMatchLabel(bracket: Bracket | undefined): string {
  const numbers = flatMatches(bracket)
    .map(({ match }) => /^M(\d+)$/.exec(match.label)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  return `M${Math.max(0, ...numbers) + 1}`
}
