import type { Lang } from './localized'

// API 시각은 모두 UTC ISO 문자열이다. 화면 표시와 관리자 입력은 대회 시간대(EVENT_TIMEZONE) 기준이다.

const locales: Record<Lang, string> = { ko: 'ko-KR', en: 'en-US' }

function parts(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(formatted.find((part) => part.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** 해당 순간에 시간대가 UTC보다 몇 ms 앞서는지 */
function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** 날짜별 묶기용 키 (YYYY-MM-DD, 대회 시간대 기준) */
export function dateKey(iso: string, timeZone: string): string {
  const p = parts(new Date(iso), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function formatDate(iso: string, timeZone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locales[lang], {
    timeZone,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(iso))
}

export function formatTime(iso: string, timeZone: string): string {
  const p = parts(new Date(iso), timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

export function formatDateTime(iso: string, timeZone: string, lang: Lang): string {
  return `${formatDate(iso, timeZone, lang)} ${formatTime(iso, timeZone)}`
}

/** `<input type="datetime-local">` 값(대회 시간대의 벽시계 시각)을 UTC ISO 문자열로 바꾼다. */
export function localInputToUtc(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  // 첫 추정 후 그 순간의 오프셋으로 한 번 더 보정한다 (서머타임 경계 대비).
  let utc = wall - offsetMs(new Date(wall), timeZone)
  utc = wall - offsetMs(new Date(utc), timeZone)
  return new Date(utc).toISOString()
}

/** UTC ISO 문자열을 대회 시간대의 `datetime-local` 입력값으로 바꾼다. */
export function utcToLocalInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  const p = parts(new Date(iso), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
