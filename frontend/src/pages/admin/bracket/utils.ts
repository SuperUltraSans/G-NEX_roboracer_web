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

/**
 * 매치 안의 결과. 두 팀이 겨루면 '승'/'패' (대회 순위 '1위'와 헷갈리지 않게), 여러 팀이면 'N위'.
 */
export function resultLabel(t: TFunction, rank: number, slotCount: number): string {
  if (slotCount === 2 && rank <= 2)
    return t(rank === 1 ? 'admin.bracket.win' : 'admin.bracket.loss')
  return t('admin.bracket.rankN', { rank })
}

/**
 * 슬롯이 어디서 채워지는지: "예선 3위", "Race 2 승"(두 팀 매치), "M2 1위", 또는 자리표시 문구.
 * bracket 을 주면 앞 매치의 칸 수를 보고 '승'/'패'로 쓴다.
 */
export function slotSource(t: TFunction, slot: BracketSlot, bracket?: Bracket): string | null {
  if (slot.seed_rank) return t('admin.bracket.seedSource', { rank: slot.seed_rank })
  if (slot.source_match_label && slot.source_rank) {
    const source = flatMatches(bracket).find(({ match }) => match.id === slot.source_match_id)
    if (source?.match.slots.length === 2 && slot.source_rank <= 2) {
      const key =
        slot.source_rank === 1 ? 'admin.bracket.matchSourceWin' : 'admin.bracket.matchSourceLoss'
      return t(key, { match: slot.source_match_label })
    }
    return t('admin.bracket.matchSource', {
      match: slot.source_match_label,
      rank: slot.source_rank,
    })
  }
  return null
}

/** 슬롯 표시: 확정 팀 → 자리표시 문구 → 출처 → 미정 */
export function slotTitle(t: TFunction, slot: BracketSlot, lang: Lang, bracket?: Bracket): string {
  if (slot.team) return teamOption(t, slot.team, lang)
  return (
    pickLocalized(slot, 'placeholder', lang) ??
    slotSource(t, slot, bracket) ??
    t('admin.bracket.undecided')
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

export function findSlot(
  bracket: Bracket | undefined,
  slotId: number,
): { match: BracketMatch; slot: BracketSlot } | undefined {
  for (const { match } of flatMatches(bracket)) {
    const slot = match.slots.find((candidate) => candidate.id === slotId)
    if (slot) return { match, slot }
  }
  return undefined
}

/** 칸 자리를 바꿀 때 함께 옮기는 값 (서버 swap_slots 와 같다. 출처 라벨은 표시용) */
function slotContents(slot: BracketSlot) {
  return {
    team: slot.team,
    seed_rank: slot.seed_rank,
    source_match_id: slot.source_match_id,
    source_match_label: slot.source_match_label,
    source_rank: slot.source_rank,
    placeholder_ko: slot.placeholder_ko,
    placeholder_en: slot.placeholder_en,
  }
}

export interface SwapChange {
  match: BracketMatch
  /** 지금 칸들 (칸 순서대로) */
  before: BracketSlot[]
  /** 바꾼 뒤 칸들 */
  after: BracketSlot[]
  /** 이 매치에서 바뀌는 칸 */
  changed: number[]
}

/** 두 칸의 자리를 바꾸면 영향받는 매치(같은 매치면 하나)와 바뀐 뒤 모습. 확인 창에 보여 준다 */
export function swapPreview(
  bracket: Bracket | undefined,
  slotId: number,
  targetId: number,
): SwapChange[] {
  const from = findSlot(bracket, slotId)
  const to = findSlot(bracket, targetId)
  if (!from || !to || slotId === targetId) return []
  const replaced = new Map([
    [from.slot.id, { ...from.slot, ...slotContents(to.slot) }],
    [to.slot.id, { ...to.slot, ...slotContents(from.slot) }],
  ])
  const matches = from.match.id === to.match.id ? [from.match] : [from.match, to.match]
  return matches.map((match) => {
    const before = [...match.slots].sort((a, b) => a.slot_index - b.slot_index)
    return {
      match,
      before,
      after: before.map((slot) => replaced.get(slot.id) ?? slot),
      changed: before.filter((slot) => replaced.has(slot.id)).map((slot) => slot.id),
    }
  })
}

/** 다음 매치 라벨 제안: 기존 M 번호 중 가장 큰 값 + 1 */
export function nextMatchLabel(bracket: Bracket | undefined): string {
  const numbers = flatMatches(bracket)
    .map(({ match }) => /^M(\d+)$/.exec(match.label)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  return `M${Math.max(0, ...numbers) + 1}`
}
