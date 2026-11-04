import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type {
  LeaderboardRow,
  QualifyingEventAdmin,
  QualifyingEventCreate,
  QualifyingEventKind,
  TeamPublic,
} from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { TextField } from '../../../components/Field'
import { useEventTimezone } from '../../../features/content/hooks'
import { useLang } from '../../../i18n'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage } from '../ui/Feedback'
import { actorName, formatClock, teamOption } from '../ui/format'
import { useAdminMutation } from '../ui/mutation'
import styles from './Qualifying.module.css'

// 자주 쓰는 사유 (규칙 4.5, 8.2). 그 밖에는 직접 적는다
const REASONS: Record<QualifyingEventKind, readonly string[]> = {
  fa_lost: ['intervention', 'stopped'],
  rank_drop: ['route', 'control', 'track'],
}
const OTHER = 'other'

/** 판정: FA 달성 불가(한 번), 최종 예선 순위 1단계 강등(여러 번). 잘못 넣었으면 취소한다. */
export function Judgements({ team, row }: { team: TeamPublic; row: LeaderboardRow | undefined }) {
  const { t } = useTranslation()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState<QualifyingEventKind | null>(null)
  const events = useQuery({
    queryKey: [...queryKeys.qualifyingEvents, team.id],
    queryFn: () =>
      api.get<QualifyingEventAdmin[]>(`/api/admin/qualifying/events?team_id=${team.id}`),
  })

  const remove = useAdminMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/qualifying/events/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.qualifyingEvents })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
    },
  })

  const faLost = events.data?.find((event) => event.kind === 'fa_lost')
  const drops = events.data?.filter((event) => event.kind === 'rank_drop') ?? []
  const meta = (event: QualifyingEventAdmin) =>
    `${formatClock(event.recorded_at, timezone)} · ${actorName(t, event.recorded_by_username)}`

  return (
    <section className={styles.judgements} aria-labelledby="judgements-title">
      <h3 id="judgements-title" className={ui.subTitle}>
        {t('admin.qualifying.judgement.title')}
      </h3>
      <div className={styles.judgement}>
        {faLost ? (
          <p className={styles.judgementItem}>
            <span>
              <strong>{t('admin.qualifying.judgement.faLostItem')}</strong> {faLost.reason}{' '}
              <span className={ui.meta}>{meta(faLost)}</span>
            </span>
            <Button
              variant="secondary"
              className={ui.compact}
              disabled={remove.isPending}
              onClick={() => remove.mutate(faLost.id)}
            >
              {t('admin.qualifying.judgement.cancel')}
            </Button>
          </p>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setAdding('fa_lost')}>
              {t('admin.qualifying.judgement.faLost')}
            </Button>
            <p className={ui.meta}>
              {row?.fa
                ? t('admin.qualifying.judgement.faAchieved')
                : t('admin.qualifying.judgement.faLostHint')}
            </p>
          </>
        )}
      </div>
      <div className={styles.judgement}>
        {drops.map((event, index) => (
          <p key={event.id} className={styles.judgementItem}>
            <span>
              <strong>{t('admin.qualifying.judgement.dropItem', { n: index + 1 })}</strong>{' '}
              {event.reason} <span className={ui.meta}>{meta(event)}</span>
            </span>
            <Button
              variant="secondary"
              className={ui.compact}
              disabled={remove.isPending}
              onClick={() => remove.mutate(event.id)}
            >
              {t('admin.qualifying.judgement.cancel')}
            </Button>
          </p>
        ))}
        <Button variant="secondary" onClick={() => setAdding('rank_drop')}>
          {t('admin.qualifying.judgement.rankDrop')}
        </Button>
        <p className={ui.meta}>{t('admin.qualifying.judgement.rankDropHint')}</p>
      </div>
      <ErrorMessage error={remove.error} />
      {adding && <JudgementDialog kind={adding} team={team} onClose={() => setAdding(null)} />}
    </section>
  )
}

function JudgementDialog({
  kind,
  team,
  onClose,
}: {
  kind: QualifyingEventKind
  team: TeamPublic
  onClose: () => void
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<string>(REASONS[kind][0])
  const [other, setOther] = useState('')
  const reason =
    choice === OTHER ? other.trim() : t(`admin.qualifying.judgement.reasons.${kind}.${choice}`)

  const create = useAdminMutation({
    mutationFn: (body: QualifyingEventCreate) =>
      api.post<QualifyingEventAdmin>('/api/admin/qualifying/events', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.qualifyingEvents })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      onClose()
    },
  })

  return (
    <ConfirmDialog
      open
      danger
      title={t(`admin.qualifying.judgement.dialogTitle.${kind}`, {
        team: teamOption(t, team, lang),
      })}
      confirmLabel={create.isPending ? t('admin.common.saving') : t('admin.common.save')}
      cancelLabel={t('admin.common.cancel')}
      busy={create.isPending}
      confirmDisabled={!reason}
      onConfirm={() => create.mutate({ team_id: team.id, kind, reason })}
      onCancel={onClose}
    >
      <p>{t(`admin.qualifying.judgement.dialogBody.${kind}`)}</p>
      <Choices
        legend={t('admin.qualifying.judgement.reason')}
        value={choice}
        onChange={setChoice}
        options={[
          ...REASONS[kind].map((value) => ({
            value,
            label: t(`admin.qualifying.judgement.reasons.${kind}.${value}`),
          })),
          { value: OTHER, label: t('admin.qualifying.judgement.reasonOther') },
        ]}
      />
      {choice === OTHER && (
        <TextField
          label={t('admin.qualifying.judgement.reasonText')}
          value={other}
          maxLength={200}
          onChange={(event) => setOther(event.target.value)}
        />
      )}
      <ErrorMessage error={create.error} />
    </ConfirmDialog>
  )
}
