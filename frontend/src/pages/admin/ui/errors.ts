import type { TFunction } from 'i18next'
import { ApiError } from '../../../api/client'

/** 화면마다 더 구체적인 문구가 있는 오류 코드는 덮어쓴다. */
export type ErrorOverrides = Partial<Record<string, string>>

const KNOWN: Record<string, string> = {
  NETWORK_ERROR: 'admin.error.network',
  MOCK_READONLY: 'admin.error.mockReadonly',
  UNAUTHENTICATED: 'admin.error.unauthenticated',
  FORBIDDEN: 'admin.error.forbidden',
  NOT_FOUND: 'admin.error.notFound',
  VERSION_CONFLICT: 'admin.error.versionConflict',
  DUPLICATE: 'admin.error.duplicate',
  DOWNSTREAM_FINISHED: 'admin.error.downstreamFinished',
  MATCH_FINISHED: 'admin.error.matchFinished',
  BRACKET_STARTED: 'admin.error.bracketStarted',
  GROUP_FULL: 'admin.error.groupFull',
  MAPPING_FROZEN: 'admin.error.mappingFrozen',
  BRACKET_FROZEN: 'admin.error.bracketFrozen',
  INSPECTION_ORDER_TAKEN: 'admin.error.inspectionOrderTaken',
  MATCH_NOT_FINISHED: 'admin.error.matchNotFinished',
  BRACKET_EXISTS: 'admin.error.bracketExists',
  LAST_ADMIN: 'admin.error.lastAdmin',
  TEAM_LIMIT: 'admin.error.teamLimit',
  RATE_LIMITED: 'admin.error.rateLimited',
  INVALID_CREDENTIALS: 'admin.error.invalidCredentials',
  MONITOR_KEY_INVALID: 'admin.error.monitorKeyInvalid',
  INTERNAL_ERROR: 'admin.error.server',
}

/** API 오류를 "무엇이 잘못됐고 어떻게 고치는지" 문구로 바꾼다 (doc/Design.md 7.1). */
export function errorMessage(t: TFunction, error: unknown, overrides?: ErrorOverrides): string {
  if (!(error instanceof ApiError)) return t('admin.error.unknown')
  const override = overrides?.[error.code]
  if (override) return override
  if (error.status === 0) return t('admin.error.network')
  if (error.code === 'VALIDATION_ERROR') {
    return error.message
      ? t('admin.error.validationDetail', { detail: error.message })
      : t('admin.error.validation')
  }
  const key = KNOWN[error.code]
  if (key) return t(key)
  if (error.status >= 500) return t('admin.error.server')
  return t('admin.error.unknownCode', { code: error.code, status: error.status })
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code
}

export function isConflict(error: unknown): boolean {
  return hasCode(error, 'VERSION_CONFLICT')
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}
