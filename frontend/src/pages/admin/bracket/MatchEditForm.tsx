import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { Bracket, BracketMatch, BracketMatchUpdate } from '../../../api/types'
import { Button } from '../../../components/Button'
import { SelectField, TextField } from '../../../components/Field'
import { useEventTimezone } from '../../../features/content/hooks'
import { useLang } from '../../../i18n'
import { localInputToUtc, utcToLocalInput } from '../../../lib/time'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage, Message, StaleNotice } from '../ui/Feedback'
import { isConflict } from '../ui/errors'
import { useAdminMutation } from '../ui/mutation'
import { replaceMatch, roundName, useReloadMatch } from './utils'

interface MatchForm {
  label: string
  roundId: string
  scheduledAt: string
  status: 'scheduled' | 'live'
  slotCount: string
}

function toForm(match: BracketMatch, timezone: string): MatchForm {
  return {
    label: match.label,
    roundId: String(match.round_id),
    scheduledAt: utcToLocalInput(match.scheduled_at, timezone),
    status: match.status === 'live' ? 'live' : 'scheduled',
    slotCount: String(match.slots.length),
  }
}

/** 매치 편집 (관리자): 라벨, 라운드, 예정 시각, 진행 여부, 슬롯 수 */
export function MatchEditForm({
  match,
  bracket,
  onDone,
}: {
  match: BracketMatch
  bracket: Bracket
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  const reloadMatch = useReloadMatch()
  const [base, setBase] = useState(match)
  const [values, setValues] = useState(() => toForm(match, timezone))
  const [errors, setErrors] = useState<{ label?: string; slotCount?: string }>({})
  const [conflict, setConflict] = useState(false)
  const finished = base.status === 'finished'

  const set = <K extends keyof MatchForm>(key: K, value: MatchForm[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setConflict(false)
  }

  const save = useAdminMutation({
    mutationFn: (body: BracketMatchUpdate) =>
      api.patch<BracketMatch>(`/api/admin/bracket/matches/${base.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<Bracket>(queryKeys.bracket, (old) =>
        old ? replaceMatch(old, updated) : old,
      )
      onDone(t('admin.common.saved'))
    },
    onError: async (error) => {
      if (!isConflict(error)) return
      const latest = await reloadMatch(base.id)
      if (latest) {
        setBase(latest)
        setValues(toForm(latest, timezone))
      }
      setConflict(true)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const label = values.label.trim()
    const slotCount = Number(values.slotCount)
    const next = {
      label: label ? undefined : t('admin.bracket.labelRequired'),
      slotCount:
        Number.isInteger(slotCount) && slotCount >= 1 && slotCount <= 16
          ? undefined
          : t('admin.bracket.slotCountRange'),
    }
    setErrors(next)
    if (next.label || next.slotCount) return

    const original = toForm(base, timezone)
    const body: BracketMatchUpdate = { version: base.version }
    if (label !== base.label) body.label = label
    if (values.roundId !== original.roundId) body.round_id = Number(values.roundId)
    if (values.scheduledAt !== original.scheduledAt) {
      body.scheduled_at = values.scheduledAt ? localInputToUtc(values.scheduledAt, timezone) : null
    }
    if (!finished && values.status !== original.status) body.status = values.status
    if (!finished && slotCount !== base.slots.length) body.slot_count = slotCount
    save.mutate(body)
  }

  return (
    <form className={ui.editor} onSubmit={submit} noValidate>
      {match.version > base.version && !save.isPending && !conflict && (
        <StaleNotice
          onReload={() => {
            setBase(match)
            setValues(toForm(match, timezone))
          }}
        />
      )}
      {conflict && <Message tone="error">{t('admin.error.versionConflict')}</Message>}
      <div className={ui.fields}>
        <TextField
          label={t('admin.bracket.label')}
          value={values.label}
          maxLength={20}
          onChange={(event) => set('label', event.target.value)}
          error={errors.label}
          hint={t('admin.bracket.labelHint')}
        />
        <SelectField
          label={t('admin.bracket.round')}
          value={values.roundId}
          onChange={(event) => set('roundId', event.target.value)}
        >
          {bracket.rounds.map((round) => (
            <option key={round.id} value={round.id}>
              {roundName(round, lang)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('admin.bracket.scheduledAt')}
          type="datetime-local"
          value={values.scheduledAt}
          onChange={(event) => set('scheduledAt', event.target.value)}
          hint={t('admin.common.timezoneHint', { timezone })}
        />
        <TextField
          label={t('admin.bracket.slotCount')}
          type="number"
          inputMode="numeric"
          min={1}
          max={16}
          value={values.slotCount}
          disabled={finished}
          onChange={(event) => set('slotCount', event.target.value)}
          error={errors.slotCount}
          hint={finished ? t('admin.bracket.finishedLocked') : t('admin.bracket.slotCountHint')}
        />
      </div>
      <Choices
        legend={t('admin.bracket.statusLegend')}
        value={finished ? 'scheduled' : values.status}
        onChange={(status) => set('status', status)}
        options={[
          { value: 'scheduled', label: t('admin.matchStatus.scheduled'), disabled: finished },
          { value: 'live', label: t('admin.matchStatus.live'), disabled: finished },
        ]}
        hint={finished ? t('admin.bracket.finishedLocked') : t('admin.bracket.statusHint')}
      />
      <ErrorMessage
        error={isConflict(save.error) ? null : save.error}
        overrides={{ DUPLICATE: t('admin.bracket.labelDuplicate') }}
      />
      <div className={ui.actions}>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t('admin.common.saving') : t('admin.common.save')}
        </Button>
        <Button variant="secondary" onClick={() => onDone(null)}>
          {t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  )
}
