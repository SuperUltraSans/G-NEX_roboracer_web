import type { PublicSettings } from '../../api/types'

export type ApplyState = 'notReady' | 'upcoming' | 'open' | 'closed'

/** 신청 버튼 상태 (doc/Instruction.md 5.3 대회 신청 표) */
export function applyState(settings: PublicSettings, now: number): ApplyState {
  if (!settings.apply_form_url) return 'notReady'
  if (settings.apply_open_at && now < Date.parse(settings.apply_open_at)) return 'upcoming'
  if (settings.apply_close_at && now > Date.parse(settings.apply_close_at)) return 'closed'
  return 'open'
}
