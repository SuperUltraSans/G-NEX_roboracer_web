import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { AdminSettings, AdminSettingsUpdate } from '../../api/types'
import { TextField } from '../../components/Field'
import { ErrorState, Loading } from '../../components/StateView'
import { useEventTimezone, usePublicSettings } from '../../features/content/hooks'
import { localInputToUtc, utcToLocalInput } from '../../lib/time'
import { AdminPage, Section } from './ui/AdminPage'
import ui from './ui/admin.module.css'
import { ErrorMessage, SaveButton } from './ui/Feedback'
import { useAdminMutation } from './ui/mutation'
import { useForm } from './ui/useForm'

interface SettingsValues {
  url: string
  openAt: string
  closeAt: string
}

function toValues(settings: AdminSettings, timezone: string): SettingsValues {
  return {
    url: settings.apply_form_url ?? '',
    openAt: utcToLocalInput(settings.apply_open_at, timezone),
    closeAt: utcToLocalInput(settings.apply_close_at, timezone),
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

  return (
    <AdminPage title={t('admin.settings.title')} lead={t('admin.settings.lead')}>
      {(settings.isPending || publicSettings.isPending) && <Loading />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && !publicSettings.isPending && <SettingsForm initial={settings.data} />}
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
    const closeAt = values.closeAt ? localInputToUtc(values.closeAt, timezone) : null
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
    })
  }

  return (
    <form className={`${ui.form} ${ui.narrow}`} onSubmit={submit} noValidate>
      <Section id="apply" title={t('admin.settings.applyTitle')}>
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
          <TextField
            label={t('admin.settings.closeAt')}
            type="datetime-local"
            value={values.closeAt}
            onChange={(event) => update('closeAt', event.target.value)}
            error={errors.closeAt}
            hint={t('admin.common.timezoneHint', { timezone })}
          />
        </div>
        <p className={ui.meta}>{t('admin.settings.periodHint')}</p>
      </Section>

      <ErrorMessage error={save.error} />
      <div className={ui.actions}>
        <SaveButton pending={save.isPending} saved={saved} />
      </div>
    </form>
  )
}
