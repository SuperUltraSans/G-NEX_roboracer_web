import type { TFunction } from 'i18next'
import type { LapStatus } from '../../../api/types'
import { parseLap } from '../../../lib/laptime'
import type { TagTone } from '../ui/Feedback'

export type EntryStatus = Exclude<LapStatus, 'void'>

export const ENTRY_STATUSES: readonly EntryStatus[] = ['valid', 'dnf', 'dsq']

export const STATUS_TONE: Record<LapStatus, TagTone> = {
  valid: 'default',
  dnf: 'off',
  dsq: 'danger',
  void: 'off',
}

export interface LapCheck {
  /** 보낼 lap_time_ms (없으면 null) */
  ms: number | null
  /** 입력이 잘못됐을 때 화면에 보일 문구 */
  error: string | null
}

/**
 * 랩타임 입력 검사. 정상 기록은 시간이 필요하고, DNF 는 시간을 버리며, 실격은 시간이 있어도 없어도 된다.
 */
export function checkLapInput(t: TFunction, text: string, status: EntryStatus): LapCheck {
  if (status === 'dnf') return { ms: null, error: null }
  if (!text.trim()) {
    return {
      ms: null,
      error: status === 'valid' ? t('admin.qualifying.lapRequired') : null,
    }
  }
  const parsed = parseLap(text)
  if ('ms' in parsed) return { ms: parsed.ms, error: null }
  return {
    ms: null,
    error:
      parsed.reason === 'range' ? t('admin.qualifying.lapRange') : t('admin.qualifying.lapFormat'),
  }
}

/** 입력 중에 보여줄 해석 결과 (m:ss.SSS). 해석할 수 없으면 null */
export function previewLap(text: string, status: EntryStatus): number | null {
  if (status === 'dnf' || !text.trim()) return null
  const parsed = parseLap(text)
  return 'ms' in parsed ? parsed.ms : null
}
