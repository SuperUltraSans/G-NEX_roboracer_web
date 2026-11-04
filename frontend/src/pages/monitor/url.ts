// 모니터링 관리 주소. 로그인 없이 쓰는 주소는 끝에 ?pw=<비밀 값> 이 붙는다.

export const MONITOR_PATH = '/monitoring-admin'

/** 주소로 들어온 사람이 남기는 기록의 계정 이름 (백엔드 MONITOR_USERNAME) */
export const MONITOR_USERNAME = 'monitoring'

/** 백엔드 MonitorKey 와 같은 규칙: 영문·숫자·-·_ 6~64자 */
export const MONITOR_KEY_PATTERN = /^[A-Za-z0-9_-]{6,64}$/

export function monitorUrl(key: string | null): string {
  const path = `${import.meta.env.BASE_URL}${MONITOR_PATH.slice(1)}`
  const url = new URL(path, window.location.origin)
  if (key) url.searchParams.set('pw', key)
  return url.href
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** 짐작하기 어려운 비밀 값 (헷갈리는 0·O·1·l·I 는 뺀다) */
export function randomMonitorKey(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  // 256 은 ALPHABET 길이로 나누어 떨어지지 않으므로, 치우침이 생기는 큰 값은 버리고 다시 뽑는다
  const limit = 256 - (256 % ALPHABET.length)
  let out = ''
  while (out.length < length) {
    for (const byte of bytes) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length]
    }
    crypto.getRandomValues(bytes)
  }
  return out
}
