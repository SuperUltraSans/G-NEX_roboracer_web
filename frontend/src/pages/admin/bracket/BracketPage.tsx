import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { Bracket, BracketRound, TeamPublic } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { EmptyState, ErrorState, Loading } from '../../../components/StateView'
import { useTeams } from '../../../features/content/hooks'
import { useBracket, useLiveState } from '../../../features/live/hooks'
import { useLang } from '../../../i18n'
import { useIsAdmin } from '../auth'
import { AdminPage } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { ErrorMessage, Message } from '../ui/Feedback'
import { useAdminMutation } from '../ui/mutation'
import styles from './Bracket.module.css'
import { MatchCard } from './MatchCard'
import { GenerateForm, MatchCreateForm, RoundForm } from './RoundForms'
import { nextMatchLabel, roundName } from './utils'

export function BracketPage() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const bracket = useBracket()
  const teams = useTeams()
  const live = useLiveState()
  const [addingRound, setAddingRound] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const currentId = live.data?.current_match?.id ?? null

  const roundAdded = (message: string | null) => {
    setAddingRound(false)
    setNotice(message)
  }

  return (
    <AdminPage
      title={t('admin.bracket.title')}
      lead={isAdmin ? t('admin.bracket.leadAdmin') : t('admin.bracket.leadReferee')}
    >
      {bracket.isPending && <Loading />}
      {bracket.isError && <ErrorState error={bracket.error} onRetry={() => bracket.refetch()} />}
      {bracket.data && (
        <>
          {live.data?.current_match && (
            <p className={styles.current}>
              {t('admin.bracket.currentIs', { label: live.data.current_match.label })}{' '}
              <a href={`#match-${live.data.current_match.id}`}>
                {t('admin.bracket.jumpToCurrent')}
              </a>
            </p>
          )}
          {isAdmin && bracket.data.rounds.length > 0 && (
            <div className={styles.tools}>
              <div className={ui.actions}>
                <SeedButton onSeeded={setNotice} />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotice(null)
                    setAddingRound(true)
                  }}
                  disabled={addingRound}
                >
                  {t('admin.bracket.addRound')}
                </Button>
              </div>
              {notice && <Message tone="success">{notice}</Message>}
              {addingRound && <RoundForm onDone={roundAdded} />}
            </div>
          )}
          {bracket.data.rounds.length === 0 &&
            (isAdmin ? (
              <>
                <GenerateForm />
                <section className={ui.section} aria-labelledby="manual-title">
                  <h2 id="manual-title" className={ui.sectionTitle}>
                    {t('admin.bracket.manualTitle')}
                  </h2>
                  <p className={ui.lead}>{t('admin.bracket.manualBody')}</p>
                  {addingRound ? (
                    <RoundForm onDone={roundAdded} />
                  ) : (
                    <div>
                      <Button variant="secondary" onClick={() => setAddingRound(true)}>
                        {t('admin.bracket.addRound')}
                      </Button>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <EmptyState>{t('admin.bracket.emptyReferee')}</EmptyState>
            ))}
          {bracket.data.rounds.map((round, index) => (
            <RoundBlock
              key={round.id}
              round={round}
              index={index}
              bracket={bracket.data}
              teams={teams.data ?? []}
              isAdmin={isAdmin}
              currentId={currentId}
            />
          ))}
        </>
      )}
    </AdminPage>
  )
}

/** 예선 리더보드 순위로 seed_rank 슬롯을 채운다. 종료된 매치는 건드리지 않는다. */
function SeedButton({ onSeeded }: { onSeeded: (message: string) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const seed = useAdminMutation({
    mutationFn: () => api.post<Bracket>('/api/admin/bracket/seed-from-qualifying'),
    onSuccess: (bracket) => {
      queryClient.setQueryData(queryKeys.bracket, bracket)
      setOpen(false)
      onSeeded(t('admin.bracket.seeded'))
    },
  })
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('admin.bracket.seed')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t('admin.bracket.seedTitle')}
        confirmLabel={seed.isPending ? t('admin.common.saving') : t('admin.bracket.seed')}
        cancelLabel={t('admin.common.cancel')}
        busy={seed.isPending}
        onConfirm={() => seed.mutate()}
        onCancel={() => {
          setOpen(false)
          seed.reset()
        }}
      >
        <p>{t('admin.bracket.seedBody')}</p>
        <ErrorMessage error={seed.error} />
      </ConfirmDialog>
    </>
  )
}

type RoundMode = 'view' | 'rename' | 'addMatch'

function RoundBlock({
  round,
  index,
  bracket,
  teams,
  isAdmin,
  currentId,
}: {
  round: BracketRound
  index: number
  bracket: Bracket
  teams: TeamPublic[]
  isAdmin: boolean
  currentId: number | null
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<RoundMode>('view')
  const [notice, setNotice] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const titleId = `round-${round.id}-title`
  const otherName = lang === 'ko' ? round.name_en : null

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })

  // 순서 바꾸기: 새 순서대로 sort_order 를 1부터 다시 매긴다 (라운드에는 version 이 없다)
  const move = useAdminMutation({
    mutationFn: async (direction: -1 | 1) => {
      const ids = bracket.rounds.map((r) => r.id)
      const target = index + direction
      ;[ids[index], ids[target]] = [ids[target], ids[index]]
      for (const [position, id] of ids.entries()) {
        const current = bracket.rounds.find((r) => r.id === id)
        if (current && current.sort_order !== position + 1) {
          await api.patch(`/api/admin/bracket/rounds/${id}`, { sort_order: position + 1 })
        }
      }
    },
    onSettled: invalidate,
  })

  const remove = useAdminMutation({
    mutationFn: () => api.delete(`/api/admin/bracket/rounds/${round.id}`),
    onSuccess: async () => {
      setDeleting(false)
      await invalidate()
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveState })
    },
  })

  const done = (message: string | null) => {
    setMode('view')
    setNotice(message)
  }

  return (
    <section className={styles.round} aria-labelledby={titleId}>
      <div className={styles.roundHead}>
        <h2 id={titleId} className={ui.sectionTitle}>
          {roundName(round, lang)}
          {otherName && otherName !== round.name_ko && (
            <span className={`${ui.meta} ${styles.roundAlt}`} lang="en">
              {otherName}
            </span>
          )}
        </h2>
        {isAdmin && mode === 'view' && (
          <div className={ui.actions}>
            <Button
              variant="secondary"
              className={ui.compact}
              onClick={() => {
                setNotice(null)
                setMode('addMatch')
              }}
            >
              {t('admin.bracket.addMatch')}
            </Button>
            <Button
              variant="secondary"
              className={ui.compact}
              onClick={() => {
                setNotice(null)
                setMode('rename')
              }}
            >
              {t('admin.bracket.renameRound')}
            </Button>
            <Button
              variant="secondary"
              className={ui.compact}
              disabled={index === 0 || move.isPending}
              onClick={() => move.mutate(-1)}
            >
              {t('admin.common.moveUp')}
            </Button>
            <Button
              variant="secondary"
              className={ui.compact}
              disabled={index === bracket.rounds.length - 1 || move.isPending}
              onClick={() => move.mutate(1)}
            >
              {t('admin.common.moveDown')}
            </Button>
            <Button variant="danger" className={ui.compact} onClick={() => setDeleting(true)}>
              {t('admin.bracket.deleteRound')}
            </Button>
          </div>
        )}
      </div>
      <ErrorMessage error={move.error} />
      {notice && <Message tone="success">{notice}</Message>}
      {mode === 'rename' && <RoundForm round={round} onDone={done} />}
      {mode === 'addMatch' && (
        <MatchCreateForm round={round} suggestedLabel={nextMatchLabel(bracket)} onDone={done} />
      )}
      {round.matches.length === 0 ? (
        <EmptyState>
          {isAdmin ? t('admin.bracket.roundEmptyAdmin') : t('admin.bracket.roundEmpty')}
        </EmptyState>
      ) : (
        <div className={styles.matches}>
          {round.matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              bracket={bracket}
              teams={teams}
              isAdmin={isAdmin}
              isCurrent={match.id === currentId}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleting}
        danger
        title={t('admin.bracket.deleteRoundTitle', { name: roundName(round, lang) })}
        confirmLabel={remove.isPending ? t('admin.common.deleting') : t('admin.common.delete')}
        cancelLabel={t('admin.common.cancel')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setDeleting(false)
          remove.reset()
        }}
      >
        <p>{t('admin.bracket.deleteRoundBody', { count: round.matches.length })}</p>
        <ErrorMessage error={remove.error} />
      </ConfirmDialog>
    </section>
  )
}
