// 규칙 문서 ZIP(문서 + 그림) 올리기·내려받기. 공용 api 클라이언트는 본문을 JSON 으로 보내므로
// 이 두 요청만 fetch 를 직접 쓴다. 기본 주소, 쿠키, X-Requested-With 헤더는 client.ts 와 같다.
import { ApiError, USE_MOCK, apiUrl, type FieldError } from '../../../api/client'
import type { RulesImportResult, RulesLang } from '../../../api/types'

const PACKAGE = '/api/admin/rules/package'

// 서버 한도 (backend/app/services/rules_package.py 의 MAX_PACKAGE_BYTES)
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024

const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed'])

/** 파일 이름이나 형식으로 ZIP 인지 본다 (윈도는 application/x-zip-compressed). */
export function looksLikeZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || ZIP_TYPES.has(file.type)
}

/** 첫 바이트가 ZIP 서명(PK\x03\x04, 빈 ZIP 은 PK\x05\x06)인지 본다. */
export async function hasZipSignature(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)
}

async function failure(response: Response): Promise<ApiError> {
  const payload = (await response.json().catch(() => null)) as {
    detail?: unknown
    code?: unknown
    errors?: unknown
  } | null
  return new ApiError(
    response.status,
    typeof payload?.code === 'string' ? payload.code : 'UNKNOWN',
    typeof payload?.detail === 'string' ? payload.detail : '',
    Array.isArray(payload?.errors) ? (payload.errors as FieldError[]) : [],
  )
}

async function send(path: string, init: RequestInit): Promise<Response> {
  if (USE_MOCK) {
    // MOCK 은 읽기 전용이다. ZIP 은 만들 그림이 없으므로 내려받기도 같은 안내를 보인다.
    await new Promise((resolve) => setTimeout(resolve, 120))
    throw new ApiError(403, 'MOCK_READONLY', 'MOCK 모드에서는 쓸 수 없습니다')
  }
  let response: Response
  try {
    response = await fetch(apiUrl(path), { ...init, credentials: 'include' })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '')
  }
  if (!response.ok) throw await failure(response)
  return response
}

/** ZIP 바이트를 그대로 본문에 담아 올린다. */
export async function uploadRulesPackage(lang: RulesLang, zip: Blob): Promise<RulesImportResult> {
  const response = await send(`${PACKAGE}?lang=${lang}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/zip',
      'X-Requested-With': 'fetch',
    },
    body: zip,
  })
  return (await response.json()) as RulesImportResult
}

/** rules.<lang>.md 와 그림을 담은 ZIP 을 받는다. */
export async function downloadRulesPackage(
  lang: RulesLang,
): Promise<{ filename: string; blob: Blob }> {
  const response = await send(`${PACKAGE}?lang=${lang}`, {
    method: 'GET',
    headers: { Accept: 'application/zip' },
  })
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `rules.${lang}.zip`
  return { filename, blob: await response.blob() }
}
