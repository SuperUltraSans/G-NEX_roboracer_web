// 랩타임은 정수 밀리초로 다루되 0.01초 단위만 쓴다 (계시원 두 명의 평균을 소수 셋째 자리에서 반올림한 값).
// 표시는 m:ss.SS, 격차는 +s.SS (1분 이상이면 +m:ss.SS).

export const LAP_MIN_MS = 1_000
export const LAP_MAX_MS = 600_000
export const LAP_STEP_MS = 10

export type LapParseResult = { ok: true; ms: number } | { ok: false; reason: 'format' | 'range' }

const SECONDS_ONLY = /^(\d{1,2})\.(\d{2})$/
const MINUTES_SECONDS = /^(\d{1,2}):([0-5]\d)\.(\d{2})$/

export function parseLap(input: string): LapParseResult {
  const value = input.trim()
  let ms: number
  const short = SECONDS_ONLY.exec(value)
  const long = MINUTES_SECONDS.exec(value)
  if (short) {
    ms = Number(short[1]) * 1000 + Number(short[2]) * LAP_STEP_MS
  } else if (long) {
    ms = Number(long[1]) * 60_000 + Number(long[2]) * 1000 + Number(long[3]) * LAP_STEP_MS
  } else {
    return { ok: false, reason: 'format' }
  }
  if (ms < LAP_MIN_MS || ms > LAP_MAX_MS) return { ok: false, reason: 'range' }
  return { ok: true, ms }
}

export function formatLap(ms: number): string {
  // 0.01초 단위가 아닌 예전 기록은 반올림해서 보인다
  const centis = Math.round(ms / LAP_STEP_MS)
  const minutes = Math.floor(centis / 6_000)
  const seconds = Math.floor((centis % 6_000) / 100)
  return `${minutes}:${pad(seconds, 2)}.${pad(centis % 100, 2)}`
}

export function formatGap(ms: number): string {
  if (ms >= 60_000) return `+${formatLap(ms)}`
  const centis = Math.round(ms / LAP_STEP_MS)
  return `+${Math.floor(centis / 100)}.${pad(centis % 100, 2)}`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
