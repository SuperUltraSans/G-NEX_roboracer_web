import type { TFunction } from 'i18next'
import type { LapStatus, LeaderboardRow, Mission, TeamPublic } from '../../../api/types'
import { parseLap } from '../../../lib/laptime'
import type { TagTone } from '../ui/Feedback'

export type EntryStatus = Exclude<LapStatus, 'void'>

export const ENTRY_STATUSES: readonly EntryStatus[] = ['valid', 'invalid']

export const MISSIONS: readonly Mission[] = ['Q1', 'Q2', 'Q3']

export const STATUS_TONE: Record<LapStatus, TagTone> = {
  valid: 'default',
  invalid: 'danger',
  void: 'off',
}

export interface LapCheck {
  /** 보낼 lap_time_ms (없으면 null) */
  ms: number | null
  /** 입력이 잘못됐을 때 화면에 보일 문구 */
  error: string | null
}

/** 랩타임 입력 검사. Q3 의 유효 랩은 시간이 꼭 필요하고, 그 밖에는 비워 둬도 된다. */
export function checkLapInput(
  t: TFunction,
  text: string,
  mission: Mission,
  status: EntryStatus,
): LapCheck {
  if (!text.trim()) {
    return {
      ms: null,
      error: mission === 'Q3' && status === 'valid' ? t('admin.qualifying.lapRequired') : null,
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

/** 입력 중에 보여줄 해석 결과 (m:ss.SS). 해석할 수 없으면 null */
export function previewLap(text: string): number | null {
  if (!text.trim()) return null
  const parsed = parseLap(text)
  return 'ms' in parsed ? parsed.ms : null
}

/** 예선 출전 순서(동결한 맵핑 순서)대로. 순서가 없는 팀은 맨 뒤에 팀 번호 순으로 둔다 */
export function byRunOrder<T extends TeamPublic>(
  teams: readonly T[],
  rows: readonly LeaderboardRow[] | undefined,
): T[] {
  const order = new Map((rows ?? []).map((row) => [row.team.id, row.run_order ?? Infinity]))
  const key = (team: T) => order.get(team.id) ?? Infinity
  return [...teams].sort((a, b) => key(a) - key(b) || a.id - b.id)
}

export interface InspectionOrderCheck {
  /** 팀 id → 적은 검차 순서 (빈 칸은 빠진다) */
  orders: Map<number, number>
  /** 1 ~ max 의 정수가 아닌 칸 */
  bad: Set<number>
  /** 다른 팀과 같은 번호를 적은 칸 */
  taken: Set<number>
  takenNumbers: number[]
}

/** 검차 순서 칸들을 읽는다. 빈 칸은 지우기, 같은 번호는 두 팀에 줄 수 없다 */
export function parseInspectionOrders(
  cells: readonly (readonly [number, string])[],
  max: number,
): InspectionOrderCheck {
  const orders = new Map<number, number>()
  const bad = new Set<number>()
  for (const [teamId, raw] of cells) {
    const text = raw.trim()
    if (!text) continue
    const n = Number(text)
    if (Number.isInteger(n) && n >= 1 && n <= max) orders.set(teamId, n)
    else bad.add(teamId)
  }
  const counts = new Map<number, number>()
  for (const n of orders.values()) counts.set(n, (counts.get(n) ?? 0) + 1)
  const takenNumbers = [...counts].filter(([, count]) => count > 1).map(([n]) => n)
  takenNumbers.sort((a, b) => a - b)
  const taken = new Set([...orders].filter(([, n]) => takenNumbers.includes(n)).map(([id]) => id))
  return { orders, bad, taken, takenNumbers }
}
