// 랩타임은 정수 밀리초로 다룬다. 표시는 m:ss.SSS, 격차는 +s.SSS (1분 이상이면 +m:ss.SSS).

export const LAP_MIN_MS = 1_000
export const LAP_MAX_MS = 600_000

export type LapParseResult = { ok: true; ms: number } | { ok: false; reason: 'format' | 'range' }

const SECONDS_ONLY = /^(\d{1,2})\.(\d{3})$/
const MINUTES_SECONDS = /^(\d{1,2}):([0-5]\d)\.(\d{3})$/

export function parseLap(input: string): LapParseResult {
  const value = input.trim()
  let ms: number
  const short = SECONDS_ONLY.exec(value)
  const long = MINUTES_SECONDS.exec(value)
  if (short) {
    ms = Number(short[1]) * 1000 + Number(short[2])
  } else if (long) {
    ms = Number(long[1]) * 60_000 + Number(long[2]) * 1000 + Number(long[3])
  } else {
    return { ok: false, reason: 'format' }
  }
  if (ms < LAP_MIN_MS || ms > LAP_MAX_MS) return { ok: false, reason: 'range' }
  return { ok: true, ms }
}

export function formatLap(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const millis = ms % 1000
  return `${minutes}:${pad(seconds, 2)}.${pad(millis, 3)}`
}

export function formatGap(ms: number): string {
  if (ms >= 60_000) return `+${formatLap(ms)}`
  return `+${Math.floor(ms / 1000)}.${pad(ms % 1000, 3)}`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
