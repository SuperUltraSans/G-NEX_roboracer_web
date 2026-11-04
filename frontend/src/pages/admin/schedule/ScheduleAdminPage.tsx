import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { ScheduleItemAdmin, ScheduleItemCreate, ScheduleItemUpdate } from '../../../api/types'
import { Button } from '../../../components/Button'
import { Checkbox, TextArea, TextField } from '../../../components/Field'
import { EmptyState, ErrorState, Loading } from '../../../components/StateView'
import { useEventTimezone, usePublicSettings } from '../../../features/content/hooks'
import { useLang } from '../../../i18n'
import type { Lang } from '../../../lib/localized'
import {
  dateKey,
  endsAtMidnight,
  formatDateTime,
  formatEndTime,
  localInputToUtc,
  utcToLocalInput,
} from '../../../lib/time'
import { AdminPage } from '../ui/AdminPage'
import { PublishBar } from '../ui/PublishBar'
import { ScheduleDocumentPanel } from './ScheduleDocumentPanel'
import styles from './Schedule.module.css'
import ui from '../ui/admin.module.css'
import { useHelp } from '../ui/help'
import { ContentRowActions } from '../ui/ContentRowActions'
import { ErrorMessage, Message, SaveButton, StaleNotice } from '../ui/Feedback'
import { isConflict } from '../ui/errors'
import { useAdminMutation } from '../ui/mutation'
import { movedIds } from '../ui/order'
import { useEditor } from '../ui/useEditor'

const BASE = '/api/admin/schedule'

function useAdminSchedule() {
  return useQuery({
    queryKey: queryKeys.scheduleAdmin,
    queryFn: () => api.get<ScheduleItemAdmin[]>(BASE),
  })
}

export function ScheduleAdminPage() {
  const { t } = useTranslation()
  const settings = usePublicSettings()
  const items = useAdminSchedule()
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const timezone = useEventTimezone()
  const help = useHelp('admin.schedule.help')

  return (
    <AdminPage
      title={t('admin.schedule.title')}
      lead={t('admin.schedule.lead', { timezone })}
      help={help}
      actions={
        items.data &&
        !creating && (
          <Button
            variant="primary"
            onClick={() => {
              setNotice(null)
              setCreating(true)
            }}
          >
            {t('admin.schedule.add')}
          </Button>
        )
      }
    >
      <PublishBar resource="schedule" previewPath="/schedule" />
      {(items.isPending || settings.isPending) && <Loading />}
      {items.isError && <ErrorState error={items.error} onRetry={() => items.refetch()} />}
      {items.data && !settings.isPending && (
        <>
          {notice && <Message tone="success">{notice}</Message>}
          {creating && (
            <ScheduleForm
              onDone={(message) => {
                setCreating(false)
                setNotice(message)
              }}
            />
          )}
          {items.data.length === 0 ? (
            <EmptyState>{t('admin.schedule.empty')}</EmptyState>
          ) : (
            <ul className={ui.list}>
              {items.data.map((item, index) => (
                <ScheduleRow key={item.id} item={item} index={index} items={items.data} />
              ))}
            </ul>
          )}
          <ScheduleDocumentPanel itemCount={items.data.length} />
        </>
      )}
    </AdminPage>
  )
}

function timeRange(item: ScheduleItemAdmin, timezone: string, lang: Lang): string {
  const start = formatDateTime(item.starts_at, timezone, lang)
  if (!item.ends_at) return start
  const end =
    dateKey(item.ends_at, timezone) === dateKey(item.starts_at, timezone) ||
    endsAtMidnight(item.starts_at, item.ends_at, timezone)
      ? formatEndTime(item.starts_at, item.ends_at, timezone)
      : formatDateTime(item.ends_at, timezone, lang)
  return `${start}–${end}`
}

function sameStart(a: ScheduleItemAdmin | undefined, b: ScheduleItemAdmin | undefined): boolean {
  return Boolean(a && b && Date.parse(a.starts_at) === Date.parse(b.starts_at))
}

function ScheduleRow({
  item,
  index,
  items,
}: {
  item: ScheduleItemAdmin
  index: number
  items: ScheduleItemAdmin[]
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const [editing, setEditing] = useState(false)
  const ids = items.map((other) => other.id)
  // 일정은 시작 시각 순서가 먼저다. 순서 바꾸기는 같은 시각에 시작하는 일정끼리만 의미가 있다.
  const canUp = sameStart(items[index - 1], item)
  const canDown = sameStart(items[index + 1], item)

  return (
    <li className={ui.row}>
      <div className={ui.itemRow}>
        <p className={`num ${styles.when}`}>{timeRange(item, timezone, lang)}</p>
        <div className={ui.itemInfo} data-off={item.is_published ? undefined : ''}>
          <span className={ui.rowTitle}>{item.title_ko}</span>
          {(item.location_ko || (item.title_en && item.title_en !== item.title_ko)) && (
            <span className={ui.meta}>
              {[item.location_ko, item.title_en !== item.title_ko ? item.title_en : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
        {!editing && (
          <ContentRowActions
            item={item}
            basePath={BASE}
            adminKey={queryKeys.scheduleAdmin}
            publicKey={queryKeys.schedule}
            onEdit={() => setEditing(true)}
            orderUp={canUp ? movedIds(ids, index, -1) : null}
            orderDown={canDown ? movedIds(ids, index, 1) : null}
            deleteTitle={t('admin.schedule.deleteTitle', { title: item.title_ko })}
            deleteBody={t('admin.schedule.deleteBody')}
          />
        )}
      </div>
      {editing && <ScheduleForm item={item} onDone={() => setEditing(false)} />}
    </li>
  )
}

interface ScheduleValues {
  startsAt: string
  endsAt: string
  titleKo: string
  titleEn: string
  locationKo: string
  locationEn: string
  descriptionKo: string
  descriptionEn: string
  isPublished: boolean
}

function ScheduleForm({
  item,
  onDone,
}: {
  item?: ScheduleItemAdmin
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<{ startsAt?: string; endsAt?: string; titleKo?: string }>({})

  const editor = useEditor<ScheduleItemAdmin, ScheduleValues>({
    item,
    queryKey: queryKeys.scheduleAdmin,
    toValues: (source) => ({
      startsAt: utcToLocalInput(source?.starts_at, timezone),
      endsAt: utcToLocalInput(source?.ends_at, timezone),
      titleKo: source?.title_ko ?? '',
      titleEn: source?.title_en ?? '',
      locationKo: source?.location_ko ?? '',
      locationEn: source?.location_en ?? '',
      descriptionKo: source?.description_ko ?? '',
      descriptionEn: source?.description_en ?? '',
      isPublished: source?.is_published ?? true,
    }),
  })
  const { values, set, base } = editor

  const save = useAdminMutation({
    // 순서는 목록의 순서 변경으로만 바꾼다
    mutationFn: (body: Omit<ScheduleItemCreate, 'sort_order'>) =>
      base
        ? api.patch<ScheduleItemAdmin>(`${BASE}/${base.id}`, {
            ...body,
            version: base.version,
          } satisfies ScheduleItemUpdate)
        : api.post<ScheduleItemAdmin>(BASE, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedule })
      if (base) editor.saved(saved)
      else onDone(t('admin.schedule.added', { title: saved.title_ko }))
    },
    onError: (error) => {
      if (isConflict(error)) void editor.handleConflict()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const startsAt = localInputToUtc(values.startsAt, timezone)
    const endsAt = values.endsAt ? localInputToUtc(values.endsAt, timezone) : null
    const next = {
      startsAt: startsAt ? undefined : t('admin.schedule.startsRequired'),
      endsAt:
        startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)
          ? t('admin.schedule.endsAfterStart')
          : undefined,
      titleKo: values.titleKo.trim() ? undefined : t('admin.common.koRequired'),
    }
    setErrors(next)
    if (!startsAt || next.endsAt || next.titleKo) return
    save.mutate({
      starts_at: startsAt,
      ends_at: endsAt,
      title_ko: values.titleKo.trim(),
      title_en: values.titleEn.trim(),
      location_ko: values.locationKo.trim() || null,
      location_en: values.locationEn.trim() || null,
      description_ko: values.descriptionKo.trim() || null,
      description_en: values.descriptionEn.trim() || null,
      is_published: values.isPublished,
    })
  }

  return (
    <form className={ui.editor} onSubmit={submit} noValidate>
      {editor.stale && !save.isPending && (
        <StaleNotice onReload={() => item && editor.load(item)} />
      )}
      {editor.conflict && <Message tone="error">{t('admin.error.versionConflict')}</Message>}
      <div className={ui.pair}>
        <TextField
          label={t('admin.schedule.startsAt')}
          type="datetime-local"
          value={values.startsAt}
          onChange={(event) => set('startsAt', event.target.value)}
          error={errors.startsAt}
          hint={t('admin.common.timezoneHint', { timezone })}
          required
        />
        <TextField
          label={t('admin.schedule.endsAt')}
          type="datetime-local"
          value={values.endsAt}
          onChange={(event) => set('endsAt', event.target.value)}
          error={errors.endsAt}
          hint={t('admin.schedule.endsHint')}
        />
      </div>
      <div className={ui.pair}>
        <TextField
          label={t('admin.schedule.titleKo')}
          value={values.titleKo}
          maxLength={200}
          onChange={(event) => set('titleKo', event.target.value)}
          error={errors.titleKo}
          required
        />
        <TextField
          label={t('admin.schedule.titleEn')}
          lang="en"
          value={values.titleEn}
          maxLength={200}
          onChange={(event) => set('titleEn', event.target.value)}
          hint={t('admin.common.enFallback')}
        />
      </div>
      <div className={ui.pair}>
        <TextField
          label={t('admin.schedule.locationKo')}
          value={values.locationKo}
          maxLength={200}
          onChange={(event) => set('locationKo', event.target.value)}
        />
        <TextField
          label={t('admin.schedule.locationEn')}
          lang="en"
          value={values.locationEn}
          maxLength={200}
          onChange={(event) => set('locationEn', event.target.value)}
        />
      </div>
      <div className={ui.pair}>
        <TextArea
          label={t('admin.schedule.descriptionKo')}
          value={values.descriptionKo}
          maxLength={5000}
          rows={3}
          onChange={(event) => set('descriptionKo', event.target.value)}
        />
        <TextArea
          label={t('admin.schedule.descriptionEn')}
          lang="en"
          value={values.descriptionEn}
          maxLength={5000}
          rows={3}
          onChange={(event) => set('descriptionEn', event.target.value)}
        />
      </div>
      <Checkbox
        label={t('admin.common.publishedLabel')}
        checked={values.isPublished}
        onChange={(event) => set('isPublished', event.target.checked)}
      />
      <ErrorMessage error={isConflict(save.error) ? null : save.error} />
      <div className={ui.actions}>
        {base ? (
          <SaveButton pending={save.isPending} saved={editor.isSaved} />
        ) : (
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t('admin.common.saving') : t('admin.schedule.add')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => onDone(null)}>
          {base ? t('admin.common.close') : t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  )
}
