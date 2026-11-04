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
import { IconButton } from '../ui/Controls'
import { Icon } from '../ui/Icon'
import { ErrorMessage, Message, Tag, type TagTone } from '../ui/Feedback'
import { useAdminMutation } from '../ui/mutation'
import styles from './Bracket.module.css'
import { MatchEditForm } from './MatchEditForm'
import { ResultForm } from './ResultForm'
import { SlotForm } from './SlotForm'
import { slotDragProps, useSlotSwap } from './slotSwapState'
import {
  downstreamMatches,
  replaceMatch,
  resultLabel,
  slotSource,
  slotTitle,
  sortedSlots,
} from './utils'

type Mode = 'view' | 'result' | 'edit'

const STATUS_TONE: Record<BracketMatch['status'], TagTone> = {
  scheduled: 'default',
  live: 'live',
  finished: 'done',
}

export function MatchCard({
  match,
  bracket,
  teams,
  setup,
  frozen,
  isCurrent,
}: {
  match: BracketMatch
  bracket: Bracket
  teams: TeamPublic[]
  /** true: 대진 구성(관리자 화면), false: 결과 입력(모니터링 관리) */
  setup: boolean
  /** 본선 결과 동결: 보기만 한다 */
  frozen: boolean
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
  // 팀이 하나라도 있으면 결과를 넣을 수 있다 (빈 칸은 부전승. 아직 채워질 칸이면 서버가 막는다)
  const missingTeams = match.slots.every((slot) => !slot.team)
  const downstream = downstreamMatches(bracket, match.id)
  const blockedBy = downstream.filter((next) => next.status === 'finished')
  // 칸 자리 바꾸기 (관리자 화면). 끝난 매치의 칸은 결과를 되돌리기 전에는 옮기지 않는다
  const swap = useSlotSwap()
  const mover = setup && !finished ? swap : null

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
          const source = slotSource(t, slot, bracket)
          const title = slotTitle(t, slot, lang, bracket)
          const moving = swap?.moving?.slotId === slot.id
          const other = mover?.moving && !moving ? mover.moving.by : null
          return (
            <li
              key={slot.id}
              className={styles.slot}
              data-winner={slot.result_rank === 1 ? '' : undefined}
              data-movable={mover ? '' : undefined}
              data-moving={moving ? '' : undefined}
              data-target={other === 'drag' ? '' : undefined}
              data-over={swap?.over === slot.id ? '' : undefined}
              data-swapped={swap?.swapped.includes(slot.id) ? '' : undefined}
              {...(mover ? slotDragProps(mover, slot.id) : {})}
            >
              <span className={`num ${styles.slotRank}`}>
                {mover ? (
                  <IconButton
                    icon="move"
                    label={t('admin.bracket.swapMove', { slot: `${match.label} · ${title}` })}
                    aria-pressed={moving}
                    onClick={() => (moving ? mover.cancel() : mover.start(slot.id, 'pick'))}
                  />
                ) : slot.result_rank !== null ? (
                  resultLabel(t, slot.result_rank, match.slots.length)
                ) : (
                  ''
                )}
              </span>
              <span className={styles.slotBody}>
                <span className={slot.team ? styles.slotTeam : styles.slotEmpty}>{title}</span>
                {slot.team && source && <span className={ui.meta}>{source}</span>}
              </span>
              {other === 'pick' ? (
                <Button
                  variant="secondary"
                  className={ui.compact}
                  onClick={() => mover?.drop(slot.id)}
                >
                  {t('admin.bracket.swapHere')}
                </Button>
              ) : (
                slot.result_text && (
                  <span className={`num ${styles.slotNote}`}>{slot.result_text}</span>
                )
              )}
            </li>
          )
        })}
      </ol>

      {notice && mode === 'view' && <Message tone="success">{notice}</Message>}

      {mode === 'view' && !frozen && (
        <>
          {/* 결과 입력·되돌리기는 모니터링 관리에서만 한다 */}
          {!setup &&
            !finished &&
            (missingTeams ? (
              <p className={ui.meta}>{t('admin.bracket.teamsMissingShort')}</p>
            ) : (
              <Button variant="primary" block onClick={() => open('result')}>
                {t('admin.bracket.enterResult')}
              </Button>
            ))}
          {!setup && finished && (
            <div className={ui.actions}>
              <Button variant="danger" onClick={() => setReopening(true)}>
                {t('admin.bracket.reopen')}
              </Button>
            </div>
          )}
          {setup && (
            <div className={`${ui.rowActions} ${styles.editActions}`}>
              <Button variant="secondary" className={ui.compact} onClick={() => open('edit')}>
                <Icon name="edit" /> {t('admin.common.edit')}
              </Button>
              <IconButton
                icon="trash"
                tone="danger"
                label={t('admin.bracket.deleteMatch', { label: match.label })}
                onClick={() => setDeleting(true)}
              />
            </div>
          )}
        </>
      )}

      {mode === 'result' && (
        <ResultForm match={match} hasDownstream={downstream.length > 0} onDone={done} />
      )}
      {/* 편집: 매치 정보(라벨·시각·칸 수)와 칸 채우는 방법을 한곳에서 */}
      {mode === 'edit' && setup && (
        <div className={styles.matchEditor}>
          <MatchEditForm match={match} bracket={bracket} onDone={done} />
          {!finished && (
            <div className={ui.editor}>
              <h4 className={ui.subTitle}>{t('admin.bracket.slotsTitle')}</h4>
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
