import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { AuditLogOut, AuditLogPage } from '../../api/types'
import { Button } from '../../components/Button'
import { SelectField } from '../../components/Field'
import { EmptyState, ErrorState, Loading } from '../../components/StateView'
import { useEventTimezone } from '../../features/content/hooks'
import { useLang } from '../../i18n'
import { formatDate } from '../../lib/time'
import styles from './AuditPage.module.css'
import { AdminPage } from './ui/AdminPage'
import ui from './ui/admin.module.css'
import { formatClock } from './ui/format'

const PAGE_SIZE = 50

const ENTITIES = [
  'users',
  'teams',
  'qualifying_laps',
  'bracket_rounds',
  'matches',
  'match_slots',
  'live_state',
  'schedule_items',
  'rule_sections',
  'site_settings',
] as const

const KNOWN_ACTIONS = new Set([
  'create',
  'update',
  'delete',
  'void',
  'finish',
  'reopen',
  'login',
  'logout',
  'password_reset',
  'reorder',
  'seed',
  'generate',
  'import',
])

export function AuditPage() {
  const { t } = useTranslation()
  const [offset, setOffset] = useState(0)
  const [entity, setEntity] = useState('')
  const audit = useQuery({
    queryKey: [...queryKeys.audit, { offset, entity }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (entity) params.set('entity', entity)
      return api.get<AuditLogPage>(`/api/admin/audit?${params}`)
    },
    placeholderData: keepPreviousData,
  })
  const page = audit.data

  return (
    <AdminPage title={t('admin.audit.title')} lead={t('admin.audit.lead')}>
      <div className={styles.filters}>
        <SelectField
          label={t('admin.audit.entityFilter')}
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value)
            setOffset(0)
          }}
        >
          <option value="">{t('admin.audit.allEntities')}</option>
          {ENTITIES.map((name) => (
            <option key={name} value={name}>
              {t(`admin.audit.entity.${name}`)}
            </option>
          ))}
        </SelectField>
      </div>
      {audit.isPending && <Loading />}
      {audit.isError && <ErrorState error={audit.error} onRetry={() => audit.refetch()} />}
      {page &&
        (page.items.length === 0 ? (
          <EmptyState>{t('admin.audit.empty')}</EmptyState>
        ) : (
          <>
            <ol className={ui.list} aria-busy={audit.isFetching}>
              {page.items.map((log) => (
                <AuditRow key={log.id} log={log} />
              ))}
            </ol>
            <Pager
              offset={page.offset}
              count={page.items.length}
              total={page.total}
              busy={audit.isFetching}
              onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          </>
        ))}
    </AdminPage>
  )
}

function Pager({
  offset,
  count,
  total,
  busy,
  onPrev,
  onNext,
}: {
  offset: number
  count: number
  total: number
  busy: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const { t } = useTranslation()
  return (
    <nav className={styles.pager} aria-label={t('admin.audit.pages')}>
      <Button variant="secondary" disabled={offset === 0 || busy} onClick={onPrev}>
        {t('admin.audit.newer')}
      </Button>
      <p className="num" aria-live="polite">
        {t('admin.audit.range', { from: offset + 1, to: offset + count, total })}
      </p>
      <Button variant="secondary" disabled={offset + count >= total || busy} onClick={onNext}>
        {t('admin.audit.older')}
      </Button>
    </nav>
  )
}

type Json = Record<string, unknown>

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** 바뀐 항목만 추린다. 만들기는 이후 값, 지우기는 이전 값만 있다. */
function changes(before: Json | null, after: Json | null): [string, unknown, unknown][] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  return keys
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .map((key) => [key, before?.[key], after?.[key]])
}

function AuditRow({ log }: { log: AuditLogOut }) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const rows = changes(log.before, log.after)
  const entityKey = (ENTITIES as readonly string[]).includes(log.entity)
    ? t(`admin.audit.entity.${log.entity}`)
    : log.entity

  return (
    <li className={ui.row}>
      <div className={ui.rowHead}>
        <span className="num">
          {formatDate(log.created_at, timezone, lang)} {formatClock(log.created_at, timezone)}
        </span>
        <span className={ui.rowTitle}>
          {KNOWN_ACTIONS.has(log.action) ? t(`admin.audit.action.${log.action}`) : log.action}
        </span>
        <span>
          {entityKey}
          {log.entity_id !== '*' && <span className="num"> #{log.entity_id}</span>}
        </span>
      </div>
      <p className={ui.meta}>
        {log.username ? t('admin.audit.by', { name: log.username }) : t('admin.audit.bySystem')}
      </p>
      {rows.length > 0 && (
        <details className={styles.details}>
          <summary>{t('admin.audit.showChanges', { count: rows.length })}</summary>
          <div className={ui.scroll}>
            <table className={styles.changes}>
              <thead>
                <tr>
                  <th scope="col">{t('admin.audit.field')}</th>
                  <th scope="col">{t('admin.audit.before')}</th>
                  <th scope="col">{t('admin.audit.after')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, before, after]) => (
                  <tr key={key}>
                    <th scope="row">{key}</th>
                    <td>{show(before)}</td>
                    <td>{show(after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </li>
  )
}
