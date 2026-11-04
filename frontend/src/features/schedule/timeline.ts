import type { ScheduleItemPublic } from '../../api/types'
import { dateKey } from '../../lib/time'

export type TimelineState = 'past' | 'now' | 'next' | 'upcoming'

function endOf(item: ScheduleItemPublic): number {
  return Date.parse(item.ends_at ?? item.starts_at)
}

/** 지금 진행 중인 일정과, 지금 뒤에 처음 시작하는 일정 */
export function currentAndNext(
  items: ScheduleItemPublic[],
  now: number,
): { current: ScheduleItemPublic | null; next: ScheduleItemPublic | null } {
  const sorted = [...items].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  const current =
    sorted.find((item) => Date.parse(item.starts_at) <= now && now < endOf(item) && item.ends_at) ??
    null
  const next = sorted.find((item) => Date.parse(item.starts_at) > now) ?? null
  return { current, next }
}

/** 지금 진행 중인 일정, 없으면 다음 일정 */
export function currentOrNext(items: ScheduleItemPublic[], now: number): ScheduleItemPublic | null {
  const { current, next } = currentAndNext(items, now)
  return current ?? next
}

/** 각 일정의 상태. 진행 중이 있으면 그것만, 없으면 다음 일정 하나만 강조한다 */
export function timelineStates(
  items: ScheduleItemPublic[],
  now: number,
): Map<number, TimelineState> {
  const focus = currentOrNext(items, now)
  const states = new Map<number, TimelineState>()
  for (const item of items) {
    if (focus && item.id === focus.id) {
      states.set(item.id, Date.parse(item.starts_at) <= now ? 'now' : 'next')
    } else {
      states.set(
        item.id,
        endOf(item) <= now && Date.parse(item.starts_at) < now ? 'past' : 'upcoming',
      )
    }
  }
  return states
}

/** 대회 시간대 기준 날짜별로 묶는다. API 가 시각순으로 주지만 한 번 더 정렬한다 */
export function groupByDate(items: ScheduleItemPublic[], timeZone: string) {
  const sorted = [...items].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.sort_order - b.sort_order,
  )
  const groups: { key: string; items: ScheduleItemPublic[] }[] = []
  for (const item of sorted) {
    const key = dateKey(item.starts_at, timeZone)
    const last = groups.at(-1)
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, items: [item] })
  }
  return groups
}

/** 일정 한 줄의 id (위쪽 '지금 일정'에서 그 줄로 옮겨 간다) */
export function itemAnchor(id: number): string {
  return `schedule-item-${id}`
}
