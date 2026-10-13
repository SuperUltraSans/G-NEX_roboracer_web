import type { TFunction } from 'i18next'
import type { BracketSlot, TeamPublic } from '../../api/types'
import { pickLocalized, type Lang } from '../../lib/localized'

export function teamName(team: TeamPublic, lang: Lang): string {
  return pickLocalized(team, 'name', lang) ?? ''
}

/** 슬롯 표시: 확정 팀 → 자리표시 문구 → 예선 N위 → M2 1위 → 미정 */
export function slotPlaceholder(slot: BracketSlot, lang: Lang, t: TFunction): string {
  const placeholder = pickLocalized(slot, 'placeholder', lang)
  if (placeholder) return placeholder
  if (slot.seed_rank) return t('live.bracket.seed', { rank: slot.seed_rank })
  if (slot.source_match_label && slot.source_rank) {
    return t('live.bracket.source', { match: slot.source_match_label, rank: slot.source_rank })
  }
  return t('live.bracket.undecided')
}
