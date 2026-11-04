import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type {
  AdminSettings,
  AdminSettingsUpdate,
  MonitorKeyUpdate,
  PageKey,
  PageState,
  PageStates,
} from '../../api/types'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Checkbox, TextField } from '../../components/Field'
import { ErrorState, Loading } from '../../components/StateView'
import { useEventTimezone, usePublicSettings } from '../../features/content/hooks'
import { localInputToUtc, utcToLocalInput } from '../../lib/time'
import { MONITOR_KEY_PATTERN, monitorUrl, randomMonitorKey } from '../monitor/url'
import styles from './SettingsPage.module.css'
import { AdminPage, Card } from './ui/AdminPage'
import { PublishBar } from './ui/PublishBar'
import { Choices } from './ui/Choices'
import ui from './ui/admin.module.css'
import { useHelp } from './ui/help'
import { CopyButton } from './ui/CopyButton'
import { ErrorMessage, SaveButton, Tag } from './ui/Feedback'
import { useAdminMutation } from './ui/mutation'
import { useForm } from './ui/useForm'

interface SettingsValues {
  url: string
  openAt: string
  /** 날짜만이면 YYYY-MM-DD, 아니면 YYYY-MM-DDTHH:MM */
  closeAt: string
  closeDateOnly: boolean
}

// 마감 시각이 미정이면 그날 끝(23:59)까지 받는다
const END_OF_DAY = 'T23:59'

function toValues(settings: AdminSettings, timezone: string): SettingsValues {
  const closeAt = utcToLocalInput(settings.apply_close_at, timezone)
  return {
    url: settings.apply_form_url ?? '',
    openAt: utcToLocalInput(settings.apply_open_at, timezone),
    closeAt: settings.apply_close_date_only ? closeAt.slice(0, 10) : closeAt,
    closeDateOnly: settings.apply_close_date_only,
  }
}

function isHttpsUrl(value: string): boolean {
  if (/\s/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function SettingsPage() {
  const { t } = useTranslation()
  const publicSettings = usePublicSettings()
  const settings = useQuery({
    queryKey: queryKeys.settingsAdmin,
    queryFn: () => api.get<AdminSettings>('/api/admin/settings'),
  })

  const help = useHelp('admin.settings.help')
  return (
    <AdminPage title={t('admin.settings.title')} lead={t('admin.settings.lead')} help={help}>
      <PublishBar resource="settings" previewPath="/apply" />
      {(settings.isPending || publicSettings.isPending) && <Loading />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && !publicSettings.isPending && (
        <div className={styles.stack}>
          <SettingsForm initial={settings.data} />
          <PagesForm initial={settings.data.pages} />
          <MonitorKeyForm current={settings.data.monitor_key ?? null} />
        </div>
      )}
    </AdminPage>
  )
}

function SettingsForm({ initial }: { initial: AdminSettings }) {
  const { t } = useTranslation()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  const { values, set, reset, saved, setSaved } = useForm(() => toValues(initial, timezone))
  const [errors, setErrors] = useState<{ url?: string; openAt?: string; closeAt?: string }>({})

  const save = useAdminMutation({
    mutationFn: (body: AdminSettingsUpdate) => api.put<AdminSettings>('/api/admin/settings', body),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.settingsAdmin, next)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settingsPublic })
      reset(toValues(next, timezone))
      setSaved(true)
    },
  })

  const update = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    set(key, value)
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = values.url.trim()
    const openAt = values.openAt ? localInputToUtc(values.openAt, timezone) : null
    const closeInput =
      values.closeAt && values.closeDateOnly
        ? values.closeAt.slice(0, 10) + END_OF_DAY
        : values.closeAt
    const closeAt = closeInput ? localInputToUtc(closeInput, timezone) : null
    const next = {
      url: url && !isHttpsUrl(url) ? t('admin.settings.urlHttps') : undefined,
      openAt: values.openAt && !openAt ? t('admin.settings.dateInvalid') : undefined,
      closeAt:
        values.closeAt && !closeAt
          ? t('admin.settings.dateInvalid')
          : openAt && closeAt && Date.parse(closeAt) <= Date.parse(openAt)
            ? t('admin.settings.closeAfterOpen')
            : undefined,
    }
    setErrors(next)
    if (next.url || next.openAt || next.closeAt) return
    // PUT 은 모든 값을 바꾸므로 빈 값도 함께 보낸다
    save.mutate({
      apply_form_url: url || null,
      apply_open_at: openAt,
      apply_close_at: closeAt,
      apply_close_date_only: values.closeDateOnly && closeAt !== null,
    })
  }

  return (
    <Card id="apply" title={t('admin.settings.applyTitle')}>
      <form className={ui.form} onSubmit={submit} noValidate>
        <TextField
          label={t('admin.settings.url')}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://"
          value={values.url}
          onChange={(event) => update('url', event.target.value)}
          error={errors.url}
          hint={t('admin.settings.urlHint')}
        />
        <div className={ui.pair}>
          <TextField
            label={t('admin.settings.openAt')}
            type="datetime-local"
            value={values.openAt}
            onChange={(event) => update('openAt', event.target.value)}
            error={errors.openAt}
            hint={t('admin.common.timezoneHint', { timezone })}
          />
          <div className={ui.form}>
            <TextField
              label={t('admin.settings.closeAt')}
              type={values.closeDateOnly ? 'date' : 'datetime-local'}
              value={values.closeAt}
              onChange={(event) => update('closeAt', event.target.value)}
              error={errors.closeAt}
              hint={
                values.closeDateOnly
                  ? t('admin.settings.closeDateOnlyHint')
                  : t('admin.common.timezoneHint', { timezone })
              }
            />
            <Checkbox
              label={t('admin.settings.closeDateOnly')}
              checked={values.closeDateOnly}
              onChange={(event) => {
                const dateOnly = event.target.checked
                const date = values.closeAt.slice(0, 10)
                update('closeDateOnly', dateOnly)
                update('closeAt', dateOnly ? date : date ? date + END_OF_DAY : '')
              }}
            />
          </div>
        </div>
        <p className={ui.meta}>{t('admin.settings.periodHint')}</p>
        <ErrorMessage error={save.error} />
        <div className={ui.actions}>
          <SaveButton pending={save.isPending} saved={saved} />
        </div>
      </form>
    </Card>
  )
}

const PAGES: readonly PageKey[] = ['schedule', 'rules', 'live']
const PAGE_PATHS: Record<PageKey, string> = {
  schedule: '/schedule',
  rules: '/rules',
  live: '/live',
}

/** 일정, 규칙, 모니터링 페이지 열고 닫기. 신청 설정과 따로 저장한다 (서로의 값을 덮어쓰지 않게) */
function PagesForm({ initial }: { initial: PageStates }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { values, set, reset, saved, setSaved } = useForm<PageStates>(() => initial)

  const save = useAdminMutation({
    mutationFn: (body: PageStates) => api.put<AdminSettings>('/api/admin/settings/pages', body),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.settingsAdmin, next)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settingsPublic })
      reset(next.pages)
      setSaved(true)
    },
  })

  const update = (page: PageKey, patch: Partial<PageState>) =>
    set(page, { ...values[page], ...patch })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(values)
  }

  return (
    <Card
      id="pages"
      title={t('admin.settings.pagesTitle')}
      description={t('admin.settings.pagesLead')}
    >
      <form className={ui.form} onSubmit={submit} noValidate>
        {PAGES.map((page) => (
          <div key={page} className={styles.page} data-closed={values[page].open ? undefined : ''}>
            <Choices
              name={`page-${page}`}
              legend={t(`admin.settings.page.${page}`)}
              value={values[page].open ? 'open' : 'closed'}
              options={[
                { value: 'open', label: t('admin.settings.pageOpen') },
                { value: 'closed', label: t('admin.settings.pageClosed') },
              ]}
              onChange={(value) => update(page, { open: value === 'open' })}
            />
            {/* 저장한 뒤 게시 전에 그 페이지를 공개 화면 모습으로 확인한다 (닫힌 페이지는 실제 화면도 볼 수 있다) */}
            <p className={ui.meta}>
              <Link to={`${PAGE_PATHS[page]}?preview=1`} target="_blank" rel="noreferrer">
                {t('admin.settings.previewPage', { page: t(`admin.settings.page.${page}`) })} ↗
                <span className="visually-hidden"> ({t('common.opensInNewTab')})</span>
              </Link>
            </p>
            <div className={ui.pair}>
              <TextField
                label={t('admin.settings.noteKo')}
                maxLength={200}
                placeholder={t('admin.settings.notePlaceholder')}
                value={values[page].note_ko ?? ''}
                onChange={(event) => update(page, { note_ko: event.target.value })}
                hint={t('admin.settings.noteHint', { text: t(`closed.${page}`, { lng: 'ko' }) })}
              />
              <TextField
                label={t('admin.settings.noteEn')}
                lang="en"
                maxLength={200}
                value={values[page].note_en ?? ''}
                onChange={(event) => update(page, { note_en: event.target.value })}
                hint={t('admin.common.enFallback')}
              />
            </div>
          </div>
        ))}
        <ErrorMessage error={save.error} />
        <div className={ui.actions}>
          <SaveButton pending={save.isPending} saved={saved} />
        </div>
      </form>
    </Card>
  )
}

/**
 * 모니터링 관리 주소: 로그인 없이 /monitoring-admin?pw=<비밀 값> 으로 들어오게 한다.
 * 값을 바꾸면 예전 주소는 바로 막힌다.
 */
function MonitorKeyForm({ current }: { current: string | null }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { values, set, reset, saved, setSaved } = useForm(() => ({ key: current ?? '' }))
  const [error, setError] = useState<string>()
  const [confirmOff, setConfirmOff] = useState(false)
  const key = values.key.trim()
  const valid = MONITOR_KEY_PATTERN.test(key)
  const dirty = key !== (current ?? '')

  const save = useAdminMutation({
    mutationFn: (body: MonitorKeyUpdate) =>
      api.put<AdminSettings>('/api/admin/settings/monitor', body),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.settingsAdmin, next)
      reset({ key: next.monitor_key ?? '' })
      setSaved(true)
      setConfirmOff(false)
    },
  })

  const update = (value: string) => {
    set('key', value)
    setError(undefined)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!key) return setError(t('admin.settings.monitor.keyRequired'))
    if (!valid) return setError(t('admin.settings.monitor.keyInvalid'))
    save.mutate({ key })
  }

  return (
    <Card
      id="monitor-key"
      title={t('admin.settings.monitor.title')}
      description={`${t('admin.settings.monitor.description')} ${t('admin.settings.monitor.immediate')}`}
    >
      <div className={styles.keyStatus} data-on={current ? '' : undefined}>
        <p className={styles.keyStatusLine}>
          <Tag tone={current ? 'on' : 'off'}>
            {current ? t('admin.settings.monitor.on') : t('admin.settings.monitor.off')}
          </Tag>
          <span className={ui.meta}>
            {current ? t('admin.settings.monitor.onHint') : t('admin.settings.monitor.offHint')}
          </span>
        </p>
        {current && (
          <div className={styles.keyUrlRow}>
            <code className={styles.keyUrl}>{monitorUrl(current)}</code>
            <div className={ui.actions}>
              <CopyButton text={monitorUrl(current)} />
              <a href={monitorUrl(current)} target="_blank" rel="noreferrer">
                {t('admin.settings.monitor.open')}
                <span className="visually-hidden"> ({t('common.opensInNewTab')})</span>
              </a>
            </div>
          </div>
        )}
      </div>

      <form className={ui.form} onSubmit={submit} noValidate>
        <div className={styles.keyField}>
          <TextField
            label={t('admin.settings.monitor.key')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            className={styles.keyInput}
            value={values.key}
            onChange={(event) => update(event.target.value)}
            error={error}
            hint={t('admin.settings.monitor.keyHint')}
          />
          <Button variant="secondary" onClick={() => update(randomMonitorKey())}>
            {t('admin.settings.monitor.generate')}
          </Button>
        </div>
        {dirty && valid && (
          <div className={styles.keyPreview}>
            <p className={ui.meta}>{t('admin.settings.monitor.preview')}</p>
            <code className={styles.keyUrl}>{monitorUrl(key)}</code>
            {current && <p className={ui.meta}>{t('admin.settings.monitor.replaceWarning')}</p>}
          </div>
        )}
        <ErrorMessage error={save.error} />
        <div className={ui.actions}>
          <SaveButton pending={save.isPending && !confirmOff} saved={saved} />
          {current && (
            <Button variant="danger" onClick={() => setConfirmOff(true)}>
              {t('admin.settings.monitor.disable')}
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmOff}
        danger
        busy={save.isPending}
        title={t('admin.settings.monitor.disableTitle')}
        confirmLabel={t('admin.settings.monitor.disableConfirm')}
        cancelLabel={t('admin.common.cancel')}
        onConfirm={() => save.mutate({ key: null })}
        onCancel={() => setConfirmOff(false)}
      >
        <p>{t('admin.settings.monitor.disableBody')}</p>
        <ErrorMessage error={confirmOff ? save.error : null} />
      </ConfirmDialog>
    </Card>
  )
}
