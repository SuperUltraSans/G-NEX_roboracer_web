// fetch 래퍼. 기본 URL 은 VITE_API_BASE, 비어 있으면 같은 origin 의 배포 경로(BASE_URL)다.
// 변경 요청에는 X-Requested-With 헤더를 붙인다 (백엔드 CSRF 검사).

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const API_BASE = (import.meta.env.VITE_API_BASE || import.meta.env.BASE_URL).replace(/\/+$/, '')

/** API 경로(/api/...)의 전체 주소. 이미지처럼 fetch 를 거치지 않는 요청에 쓴다 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

export interface FieldError {
  loc: (string | number)[]
  msg: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** 422 검증 오류일 때 필드별 메시지 */
  readonly errors: FieldError[]

  constructor(status: number, code: string, detail: string, errors: FieldError[] = []) {
    super(detail)
    this.status = status
    this.code = code
    this.errors = errors
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// 모니터링 관리 주소(?pw=...)로 들어온 화면은 모든 관리 요청에 그 값을 실어 보낸다 (로그인 대신)
let monitorKey: string | null = null

export function setMonitorKey(key: string | null): void {
  monitorKey = key
}

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (USE_MOCK) {
    const { mockRequest } = await import('./mock/server')
    return mockRequest<T>(method, path, body)
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['X-Requested-With'] = 'fetch'
  if (monitorKey && path.startsWith('/api/admin')) headers['X-Monitor-Key'] = monitorKey

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: path.startsWith('/api/admin') ? 'include' : 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '')
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: unknown
      code?: unknown
      errors?: unknown
    } | null
    throw new ApiError(
      response.status,
      typeof payload?.code === 'string' ? payload.code : 'UNKNOWN',
      typeof payload?.detail === 'string' ? payload.detail : '',
      Array.isArray(payload?.errors) ? (payload.errors as FieldError[]) : [],
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
}

export function liveSocketUrl(): string {
  const base = new URL(`${API_BASE}/ws/live`, window.location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return base.toString()
}
