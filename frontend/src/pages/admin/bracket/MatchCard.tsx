import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { Bracket, BracketMatch, MatchReopen, TeamPublic } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useEventTimezone } from '../../../features/content/hooks'
import { useLang } from '../../../i18n'
import { formatDateTime } from '../../../lib/time'
import ui from '../ui/admin.module.css'
import { ErrorMessage, Message, Tag, type TagTone } from '../ui/Feedback'
import { useAdminMutation } from '../ui/mutation'
import styles from './Bracket.module.css'
import { MatchEditForm } from './MatchEditForm'
import { ResultForm } from './ResultForm'
import { SlotForm } from './SlotForm'
import { downstreamMatches, replaceMatch, slotSource, slotTitle, sortedSlots } from './utils'

type Mode = 'view' | 'result' | 'edit' | 'slots'

const STATUS_TONE: Record<BracketMatch['status'], TagTone> = {
  scheduled: 'default',
  live: 'live',
  finished: 'done',
}

export function MatchCard({
  match,
  bracket,
  teams,
  isAdmin,
  isCurrent,
}: {
  match: BracketMatch
  bracket: Bracket
  teams: TeamPublic[]
  isAdmin: boolean
  isCurrent: boolean
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('view')
  const [notice, setNotice] = useState<string | null>(null)
  const [reopening, setReopening] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const finished = match.status === 'finished'
  const missingTeams = match.slots.some((slot) => !slot.team)
  const downstream = downstreamMatches(bracket, match.id)
  const blockedBy = downstream.filter((next) => next.status === 'finished')

  const done = (message: string | null) => {
    setMode('view')
    setNotice(message)
  }

  const open = (next: Mode) => {
    setNotice(null)
    setMode(next)
  }

  const reopen = useAdminMutation({
    mutationFn: (body: MatchReopen) =>
      api.post<BracketMatch>(`/api/admin/matches/${match.id}/reopen`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<Bracket>(queryKeys.bracket, (old) =>
        old ? replaceMatch(old, updated) : old,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
      setReopening(false)
      setNotice(t('admin.bracket.reopenedNotice', { label: updated.label }))
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
    },
  })

  const remove = useAdminMutation({
    mutationFn: () => api.delete(`/api/admin/bracket/matches/${match.id}`),
    onSuccess: () => {
      setDeleting(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveState })
    },
  })

  const blockedLabels = blockedBy.map((next) => next.label).join(', ')

  return (
    <article
      id={`match-${match.id}`}
      className={styles.match}
      data-current={isCurrent ? '' : undefined}
      data-editing={mode !== 'view' ? '' : undefined}
      aria-labelledby={`match-${match.id}-title`}
    >
      <header className={styles.matchHead}>
        <h3 id={`match-${match.id}-title`} className={styles.matchLabel}>
          {match.label}
        </h3>
        <Tag tone={STATUS_TONE[match.status]}>{t(`admin.matchStatus.${match.status}`)}</Tag>
        {isCurrent && <Tag>{t('admin.bracket.currentMatch')}</Tag>}
        {match.scheduled_at && (
          <span className={ui.meta}>{formatDateTime(match.scheduled_at, timezone, lang)}</span>
        )}
      </header>

      <ol className={styles.slots}>
        {sortedSlots(match).map((slot) => {
          const source = slotSource(t, slot)
          return (
            <li
              key={slot.id}
              className={styles.slot}
              data-winner={slot.result_rank === 1 ? '' : undefined}
            >
              <span className={`num ${styles.slotRank}`}>
                {slot.result_rank !== null
                  ? t('admin.bracket.rankN', { rank: slot.result_rank })
                  : ''}
              </span>
              <span className={styles.slotBody}>
                <span className={slot.team ? styles.slotTeam : styles.slotEmpty}>
                  {slotTitle(t, slot, lang)}
                </span>
                {slot.team && source && <span className={ui.meta}>{source}</span>}
              </span>
              {slot.result_text && (
                <span className={`num ${styles.slotNote}`}>{slot.result_text}</span>
              )}
            </li>
          )
        })}
      </ol>

      {notice && mode === 'view' && <Message tone="success">{notice}</Message>}

      {mode === 'view' && (
        <>
          {/* 결과 입력·되돌리기는 심판도 쓰는 주 동작이라 따로 한 줄에 둔다 */}
          {!finished &&
            (missingTeams ? (
              <p className={ui.meta}>{t('admin.bracket.teamsMissingShort')}</p>
            ) : (
              <Button variant="primary" block onClick={() => open('result')}>
                {t('admin.bracket.enterResult')}
              </Button>
            ))}
          {finished && (
            <div className={ui.actions}>
              <Button variant="danger" onClick={() => setReopening(true)}>
                {t('admin.bracket.reopen')}
              </Button>
            </div>
          )}
          {isAdmin && (
            <div className={`${ui.actions} ${styles.editActions}`}>
              <Button variant="secondary" className={ui.compact} onClick={() => open('edit')}>
                {t('admin.bracket.editMatch')}
              </Button>
              {!finished && (
                <Button variant="secondary" className={ui.compact} onClick={() => open('slots')}>
                  {t('admin.bracket.editSlots')}
                </Button>
              )}
              <Button variant="danger" className={ui.compact} onClick={() => setDeleting(true)}>
                {t('admin.common.delete')}
              </Button>
            </div>
          )}
        </>
      )}

      {mode === 'result' && (
        <ResultForm match={match} hasDownstream={downstream.length > 0} onDone={done} />
      )}
      {mode === 'edit' && isAdmin && (
        <MatchEditForm match={match} bracket={bracket} onDone={done} />
      )}
      {mode === 'slots' && isAdmin && (
        <div className={ui.editor}>
          {match.slots.map((slot, index) => (
            <SlotForm
              key={slot.id}
              slot={slot}
              index={index}
              match={match}
              bracket={bracket}
              teams={teams}
            />
          ))}
          <div className={ui.actions}>
            <Button variant="secondary" onClick={() => done(null)}>
              {t('admin.common.close')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={reopening}
        danger
        title={t('admin.bracket.reopenTitle', { label: match.label })}
        confirmLabel={reopen.isPending ? t('admin.common.saving') : t('admin.bracket.reopen')}
        cancelLabel={t('admin.common.cancel')}
        busy={reopen.isPending}
        confirmDisabled={blockedBy.length > 0}
        onConfirm={() => reopen.mutate({ version: match.version })}
        onCancel={() => {
          setReopening(false)
          reopen.reset()
        }}
      >
        <p>{t('admin.bracket.reopenBody')}</p>
        {downstream.length > 0 && (
          <p>
            {t('admin.bracket.reopenAffects', {
              labels: downstream.map((next) => next.label).join(', '),
            })}
          </p>
        )}
        {blockedBy.length > 0 && (
          <Message tone="error">
            {t('admin.bracket.downstreamFinished', { labels: blockedLabels })}
          </Message>
        )}
        <ErrorMessage
          error={reopen.error}
          overrides={{
            DOWNSTREAM_FINISHED: t('admin.bracket.downstreamFinished', {
              labels: blockedLabels || t('admin.bracket.nextMatch'),
            }),
            MATCH_NOT_FINISHED: t('admin.error.matchNotFinished'),
          }}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting}
        danger
        title={t('admin.bracket.deleteMatchTitle', { label: match.label })}
        confirmLabel={remove.isPending ? t('admin.common.deleting') : t('admin.common.delete')}
        cancelLabel={t('admin.common.cancel')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setDeleting(false)
          remove.reset()
        }}
      >
        <p>{t('admin.bracket.deleteMatchBody')}</p>
        {downstream.length > 0 && (
          <p>
            {t('admin.bracket.deleteMatchAffects', {
              labels: downstream.map((next) => next.label).join(', '),
            })}
          </p>
        )}
        <ErrorMessage error={remove.error} />
      </ConfirmDialog>
    </article>
  )
}
