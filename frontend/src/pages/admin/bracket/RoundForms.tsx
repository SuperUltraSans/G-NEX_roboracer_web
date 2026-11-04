import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type {
  Bracket,
  BracketGenerate,
  BracketMatch,
  BracketMatchCreate,
  BracketRound,
  BracketRoundAdmin,
  BracketRoundCreate,
} from '../../../api/types'
import { Button } from '../../../components/Button'
import { Checkbox, TextField } from '../../../components/Field'
import { useEventTimezone } from '../../../features/content/hooks'
import { localInputToUtc } from '../../../lib/time'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage, Message } from '../ui/Feedback'
import { useAdminMutation } from '../ui/mutation'

function useInvalidateBracket() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
}

/** 라운드 추가와 이름 바꾸기 */
export function RoundForm({
  round,
  onDone,
}: {
  round?: BracketRound
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const invalidate = useInvalidateBracket()
  const [nameKo, setNameKo] = useState(round?.name_ko ?? '')
  const [nameEn, setNameEn] = useState(round?.name_en ?? '')
  const [missing, setMissing] = useState(false)

  const save = useAdminMutation({
    mutationFn: (body: BracketRoundCreate) =>
      round
        ? api.patch<BracketRoundAdmin>(`/api/admin/bracket/rounds/${round.id}`, body)
        : api.post<BracketRoundAdmin>('/api/admin/bracket/rounds', body),
    onSuccess: async () => {
      await invalidate()
      onDone(round ? t('admin.common.saved') : t('admin.bracket.roundAdded'))
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!nameKo.trim()) {
      setMissing(true)
      return
    }
    save.mutate({ name_ko: nameKo.trim(), name_en: nameEn.trim() })
  }

  return (
    <form className={ui.editor} onSubmit={submit} noValidate>
      <div className={ui.pair}>
        <TextField
          label={t('admin.bracket.roundNameKo')}
          value={nameKo}
          maxLength={200}
          placeholder={t('admin.bracket.roundNamePlaceholderKo')}
          onChange={(event) => {
            setNameKo(event.target.value)
            setMissing(false)
          }}
          error={missing ? t('admin.common.koRequired') : undefined}
        />
        <TextField
          label={t('admin.bracket.roundNameEn')}
          lang="en"
          value={nameEn}
          maxLength={200}
          placeholder={t('admin.bracket.roundNamePlaceholderEn')}
          onChange={(event) => setNameEn(event.target.value)}
          hint={t('admin.common.enFallback')}
        />
      </div>
      <ErrorMessage error={save.error} />
      <div className={ui.actions}>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending
            ? t('admin.common.saving')
            : round
              ? t('admin.common.save')
              : t('admin.bracket.addRound')}
        </Button>
        <Button variant="secondary" onClick={() => onDone(null)}>
          {t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  )
}

/** 라운드에 매치 추가 */
export function MatchCreateForm({
  round,
  suggestedLabel,
  onDone,
}: {
  round: BracketRound
  suggestedLabel: string
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const timezone = useEventTimezone()
  const invalidate = useInvalidateBracket()
  const [label, setLabel] = useState(suggestedLabel)
  const [slotCount, setSlotCount] = useState('2')
  const [scheduledAt, setScheduledAt] = useState('')
  const [errors, setErrors] = useState<{ label?: string; slotCount?: string }>({})

  const save = useAdminMutation({
    mutationFn: (body: BracketMatchCreate) =>
      api.post<BracketMatch>('/api/admin/bracket/matches', body),
    onSuccess: async (match) => {
      await invalidate()
      onDone(t('admin.bracket.matchAdded', { label: match.label }))
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const count = Number(slotCount)
    const next = {
      label: label.trim() ? undefined : t('admin.bracket.labelRequired'),
      slotCount:
        Number.isInteger(count) && count >= 1 && count <= 16
          ? undefined
          : t('admin.bracket.slotCountRange'),
    }
    setErrors(next)
    if (next.label || next.slotCount) return
    save.mutate({
      round_id: round.id,
      label: label.trim(),
      slot_count: count,
      scheduled_at: scheduledAt ? localInputToUtc(scheduledAt, timezone) : null,
    })
  }

  return (
    <form className={ui.editor} onSubmit={submit} noValidate>
      <div className={ui.fields}>
        <TextField
          label={t('admin.bracket.label')}
          value={label}
          maxLength={20}
          onChange={(event) => setLabel(event.target.value)}
          error={errors.label}
          hint={t('admin.bracket.labelHint')}
        />
        <TextField
          label={t('admin.bracket.slotCount')}
          type="number"
          inputMode="numeric"
          min={1}
          max={16}
          value={slotCount}
          onChange={(event) => setSlotCount(event.target.value)}
          error={errors.slotCount}
          hint={t('admin.bracket.slotCountHint')}
        />
        <TextField
          label={t('admin.bracket.scheduledAt')}
          type="datetime-local"
          value={scheduledAt}
          onChange={(event) => setScheduledAt(event.target.value)}
          hint={t('admin.common.timezoneHint', { timezone })}
        />
      </div>
      <ErrorMessage
        error={save.error}
        overrides={{ DUPLICATE: t('admin.bracket.labelDuplicate') }}
      />
      <div className={ui.actions}>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t('admin.common.saving') : t('admin.bracket.addMatch')}
        </Button>
        <Button variant="secondary" onClick={() => onDone(null)}>
          {t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  )
}

// 참가 팀이 최대 15팀이라 16강까지
const SIZES = ['2', '4', '8', '16'] as const

/** 대진이 비어 있을 때: 싱글 엘리미네이션 자동 생성 */
export function GenerateForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [size, setSize] = useState<(typeof SIZES)[number]>('8')
  const [thirdPlace, setThirdPlace] = useState(false)

  const generate = useAdminMutation({
    mutationFn: (body: BracketGenerate) => api.post<Bracket>('/api/admin/bracket/generate', body),
    onSuccess: (bracket) => {
      queryClient.setQueryData(queryKeys.bracket, bracket)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    generate.mutate({
      format: 'single_elimination',
      size: Number(size) as BracketGenerate['size'],
      third_place: thirdPlace,
    })
  }

  return (
    <form className={`${ui.form} ${ui.narrow}`} onSubmit={submit} noValidate>
      <Message>{t('admin.bracket.emptyAdmin')}</Message>
      <Choices<(typeof SIZES)[number]>
        legend={t('admin.bracket.generateSize')}
        value={size}
        onChange={(next) => setSize(next)}
        options={SIZES.map((value) => ({
          value,
          label: t('admin.bracket.teamsN', { count: Number(value) }),
        }))}
        hint={t('admin.bracket.generateHint')}
      />
      <Checkbox
        label={t('admin.bracket.thirdPlace')}
        checked={thirdPlace}
        disabled={size === '2'}
        onChange={(event) => setThirdPlace(event.target.checked)}
      />
      <ErrorMessage error={generate.error} />
      <div className={ui.actions}>
        <Button type="submit" variant="primary" disabled={generate.isPending}>
          {generate.isPending ? t('admin.common.saving') : t('admin.bracket.generate')}
        </Button>
      </div>
    </form>
  )
}
