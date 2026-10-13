import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { QualifyingLapAdmin, QualifyingLapUpdate, QualifyingLapVoid } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { TextArea, TextField } from '../../../components/Field'
import { EmptyState, ErrorState, Loading } from '../../../components/StateView'
import { useEventTimezone } from '../../../features/content/hooks'
import { useLang } from '../../../i18n'
import { formatLap } from '../../../lib/laptime'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage, Message, Tag } from '../ui/Feedback'
import { isConflict } from '../ui/errors'
import { formatClock, teamOption } from '../ui/format'
import { useAdminMutation, useReloadItem } from '../ui/mutation'
import { checkLapInput, ENTRY_STATUSES, previewLap, STATUS_TONE, type EntryStatus } from './labels'
import styles from './Qualifying.module.css'

const RECENT_LIMIT = 20

function useRecentLaps() {
  return useQuery({
    queryKey: queryKeys.laps,
    queryFn: () =>
      api.get<QualifyingLapAdmin[]>(`/api/admin/qualifying/laps?limit=${RECENT_LIMIT}`),
  })
}

export function RecentLaps() {
  const { t } = useTranslation()
  const laps = useRecentLaps()
  if (laps.isPending) return <Loading />
  if (laps.isError) return <ErrorState error={laps.error} onRetry={() => laps.refetch()} />
  if (laps.data.length === 0) return <EmptyState>{t('admin.qualifying.recentEmpty')}</EmptyState>
  return (
    <ul className={ui.list}>
      {laps.data.map((lap) => (
        <LapRow key={lap.id} lap={lap} />
      ))}
    </ul>
  )
}

function LapRow({ lap }: { lap: QualifyingLapAdmin }) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const [editing, setEditing] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const isVoid = lap.status === 'void'

  return (
    <li className={`${ui.row} ${isVoid ? styles.void : ''}`}>
      <div className={styles.lapHead}>
        <span className={`num ${styles.lapTime}`}>
          {lap.lap_time_ms !== null ? formatLap(lap.lap_time_ms) : t('admin.common.dash')}
        </span>
        <span className={styles.lapTeam}>{teamOption(t, lap.team, lang)}</span>
        <Tag tone={STATUS_TONE[lap.status]}>{t(`admin.lapStatus.${lap.status}`)}</Tag>
      </div>
      <p className={styles.lapMeta}>
        <span>{t('admin.qualifying.attempt', { n: lap.attempt_no })}</span>
        <span className="num">{formatClock(lap.recorded_at, timezone)}</span>
        {lap.recorded_by_username && (
          <span>{t('admin.qualifying.recordedBy', { name: lap.recorded_by_username })}</span>
        )}
      </p>
      {isVoid && lap.void_reason && (
        <p className={ui.meta}>{t('admin.qualifying.voidReason', { reason: lap.void_reason })}</p>
      )}
      {notice && !editing && <Message tone="success">{notice}</Message>}
      {editing ? (
        <LapEditForm
          lap={lap}
          onDone={(message) => {
            setEditing(false)
            setNotice(message)
          }}
        />
      ) : (
        !isVoid && (
          <div className={ui.actions}>
            <Button
              variant="secondary"
              className={ui.compact}
              onClick={() => {
                setNotice(null)
                setEditing(true)
              }}
            >
              {t('admin.common.edit')}
            </Button>
            <Button
              variant="danger"
              className={ui.compact}
              onClick={() => {
                setNotice(null)
                setVoiding(true)
              }}
            >
              {t('admin.qualifying.void')}
            </Button>
          </div>
        )
      )}
      {voiding && <VoidDialog lap={lap} onClose={() => setVoiding(false)} />}
    </li>
  )
}

function lapText(lap: QualifyingLapAdmin): string {
  return lap.lap_time_ms !== null ? formatLap(lap.lap_time_ms) : ''
}

function editableStatus(lap: QualifyingLapAdmin): EntryStatus {
  return lap.status === 'void' ? 'valid' : lap.status
}

/** 기록 수정. 열었을 때의 version 으로 저장하고, 409 를 받으면 최신 값으로 다시 채운다. */
function LapEditForm({
  lap,
  onDone,
}: {
  lap: QualifyingLapAdmin
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const reloadLap = useReloadItem<QualifyingLapAdmin>(queryKeys.laps)
  const [base, setBase] = useState(lap)
  const [text, setText] = useState(() => lapText(lap))
  const [status, setStatus] = useState<EntryStatus>(() => editableStatus(lap))
  const [error, setError] = useState<string | undefined>()
  const [conflict, setConflict] = useState(false)
  const [confirming, setConfirming] = useState<QualifyingLapUpdate | null>(null)

  const save = useAdminMutation({
    mutationFn: (body: QualifyingLapUpdate) =>
      api.patch<QualifyingLapAdmin>(`/api/admin/qualifying/laps/${base.id}`, body),
    onSuccess: () => {
      setConfirming(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.laps })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      onDone(t('admin.common.saved'))
    },
    onError: async (err) => {
      setConfirming(null)
      if (!isConflict(err)) return
      const latest = await reloadLap(base.id)
      if (latest) {
        setBase(latest)
        setText(lapText(latest))
        setStatus(editableStatus(latest))
      }
      setConflict(true)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = checkLapInput(t, text, status)
    if (result.error) {
      setError(result.error)
      return
    }
    setConfirming({ version: base.version, lap_time_ms: result.ms, status })
  }

  const preview = previewLap(text, status)

  return (
    <>
      <form className={ui.editor} onSubmit={submit} noValidate>
        {conflict ? (
          <Message tone="error">{t('admin.error.versionConflict')}</Message>
        ) : (
          <ErrorMessage error={save.error} />
        )}
        <TextField
          label={t('admin.qualifying.lapTime')}
          inputMode="decimal"
          autoComplete="off"
          className={styles.lapInput}
          value={status === 'dnf' ? '' : text}
          disabled={status === 'dnf'}
          onChange={(event) => {
            setText(event.target.value)
            setError(undefined)
            setConflict(false)
          }}
          hint={
            status === 'dnf'
              ? t('admin.qualifying.dnfHint')
              : preview !== null
                ? t('admin.qualifying.lapPreview', { time: formatLap(preview) })
                : t('admin.qualifying.lapHint')
          }
          error={error}
        />
        <Choices
          legend={t('admin.qualifying.status')}
          value={status}
          onChange={(next) => {
            setStatus(next)
            setError(undefined)
            setConflict(false)
          }}
          options={ENTRY_STATUSES.map((value) => ({
            value,
            label: t(`admin.lapStatus.${value}`),
          }))}
        />
        <div className={ui.actions}>
          <Button type="submit" variant="primary">
            {t('admin.common.save')}
          </Button>
          <Button variant="secondary" onClick={() => onDone(null)}>
            {t('admin.common.cancel')}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming !== null}
        title={t('admin.qualifying.confirmEditTitle')}
        confirmLabel={save.isPending ? t('admin.common.saving') : t('admin.common.save')}
        cancelLabel={t('admin.common.cancel')}
        busy={save.isPending}
        onConfirm={() => confirming && save.mutate(confirming)}
        onCancel={() => setConfirming(null)}
      >
        {confirming && (
          <dl className={ui.facts}>
            <dt>{t('admin.qualifying.team')}</dt>
            <dd>{teamOption(t, base.team, lang)}</dd>
            <dt>{t('admin.qualifying.before')}</dt>
            <dd className="num">
              {lapText(base) || t('admin.common.dash')} {t(`admin.lapStatus.${base.status}`)}
            </dd>
            <dt>{t('admin.qualifying.after')}</dt>
            <dd className="num">
              {confirming.lap_time_ms != null
                ? formatLap(confirming.lap_time_ms)
                : t('admin.common.dash')}{' '}
              {confirming.status && t(`admin.lapStatus.${confirming.status}`)}
            </dd>
          </dl>
        )}
      </ConfirmDialog>
    </>
  )
}

/** 무효 처리. 사유를 반드시 받는다. 기록은 지우지 않고 남는다. */
function VoidDialog({ lap, onClose }: { lap: QualifyingLapAdmin; onClose: () => void }) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const reloadLap = useReloadItem<QualifyingLapAdmin>(queryKeys.laps)
  const [reason, setReason] = useState('')
  const [version, setVersion] = useState(lap.version)

  const voidLap = useAdminMutation({
    mutationFn: (body: QualifyingLapVoid) =>
      api.post<QualifyingLapAdmin>(`/api/admin/qualifying/laps/${lap.id}/void`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.laps })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      onClose()
    },
    onError: async (err) => {
      if (!isConflict(err)) return
      const latest = await reloadLap(lap.id)
      if (latest) setVersion(latest.version)
    },
  })

  return (
    <ConfirmDialog
      open
      danger
      title={t('admin.qualifying.voidTitle')}
      confirmLabel={voidLap.isPending ? t('admin.common.saving') : t('admin.qualifying.void')}
      cancelLabel={t('admin.common.cancel')}
      busy={voidLap.isPending}
      confirmDisabled={!reason.trim()}
      onConfirm={() => voidLap.mutate({ reason: reason.trim(), version })}
      onCancel={onClose}
    >
      <p>
        {t('admin.qualifying.voidBody', {
          team: teamOption(t, lap.team, lang),
          time: lapText(lap) || t(`admin.lapStatus.${lap.status}`),
          attempt: lap.attempt_no,
        })}
      </p>
      <TextArea
        label={t('admin.qualifying.voidReasonLabel')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        rows={3}
        required
        hint={t('admin.qualifying.voidReasonHint')}
      />
      <ErrorMessage
        error={voidLap.error}
        overrides={{ VERSION_CONFLICT: t('admin.qualifying.voidConflict') }}
      />
    </ConfirmDialog>
  )
}
