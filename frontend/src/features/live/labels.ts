import type { TFunction } from 'i18next'
import type { BracketSlot, LeaderboardRow, TeamPublic } from '../../api/types'
import { pickLocalized, type Lang } from '../../lib/localized'

export function teamName(team: TeamPublic, lang: Lang): string {
  return pickLocalized(team, 'name', lang) ?? ''
}

/**
 * 매치 안의 결과. 두 팀이 겨루면 '승'/'패'로 쓴다 (대회 순위 '1위'와 헷갈리지 않게).
 * 여러 팀이 함께 달리는 매치만 'N위'.
 */
export function matchResult(t: TFunction, rank: number, slotCount: number): string {
  if (slotCount === 2 && rank <= 2) return t(rank === 1 ? 'live.bracket.win' : 'live.bracket.loss')
  return t('live.bracket.winner', { rank })
}

/**
 * 슬롯 표시: 확정 팀 → 자리표시 문구 → 예선 N위 → Race 2 승 → 미정.
 * sourceSlotCount: 이 슬롯을 채우는 앞 매치의 칸 수 (두 칸이면 '승'/'패'로 쓴다)
 */
export function slotPlaceholder(
  slot: BracketSlot,
  lang: Lang,
  t: TFunction,
  sourceSlotCount?: number,
): string {
  const placeholder = pickLocalized(slot, 'placeholder', lang)
  if (placeholder) return placeholder
  if (slot.seed_rank) return t('live.bracket.seed', { rank: slot.seed_rank })
  if (slot.source_match_label && slot.source_rank) {
    if (sourceSlotCount === 2 && slot.source_rank <= 2) {
      const key = slot.source_rank === 1 ? 'live.bracket.sourceWin' : 'live.bracket.sourceLoss'
      return t(key, { match: slot.source_match_label })
    }
    return t('live.bracket.source', { match: slot.source_match_label, rank: slot.source_rank })
  }
  return t('live.bracket.undecided')
}

/** 팀의 예선 진행 한 줄: 'Q2 연속 2랩', 'Q1~Q3 통과', '대기' (공개 리더보드·운영 콘솔 공용) */
export function missionProgress(t: TFunction, row: LeaderboardRow): string {
  if (row.attempts === 0) return t('live.leaderboard.waiting')
  if (row.missions_passed === 3) return t('live.leaderboard.allPassed')
  return t('live.leaderboard.streak', { mission: row.current_mission, count: row.current_streak })
}

export type FaMark = 'yes' | 'no' | 'open'

/**
 * FA 칸: 이뤘으면 yes, 달성 불가 판정이 있거나 주행을 마쳤는데 세 미션을 다 통과하지 못했으면 no,
 * 아직 달리지 않았거나 트랙 위에서 달리는 중이면 open.
 */
export function faMark(row: LeaderboardRow, running: boolean): FaMark {
  if (row.fa) return 'yes'
  if (row.fa_lost) return 'no'
  if (running || row.attempts === 0) return 'open'
  return 'no'
}
