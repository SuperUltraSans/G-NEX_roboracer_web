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
import { AdminPage } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { useHelp } from '../ui/help'
import { IconButton } from '../ui/Controls'
import { Icon } from '../ui/Icon'
import { ErrorMessage, Message } from '../ui/Feedback'
import { useAdminMutation } from '../ui/mutation'
import styles from './Bracket.module.css'
import { MatchCard } from './MatchCard'
import { GenerateForm, MatchCreateForm, RoundForm } from './RoundForms'
import { SlotSwapProvider } from './SlotSwap'
import { nextMatchLabel, roundName } from './utils'

/** 관리자 화면: 대진 구성(라운드·매치·슬롯 편집). 결과 입력과 시드 채우기는 모니터링 관리에서 한다 */
export function BracketPage() {
  const { t } = useTranslation()
  const help = useHelp('admin.bracket.help')
  return (
    <AdminPage title={t('admin.bracket.title')} lead={t('admin.bracket.leadSetup')} help={help}>
      <BracketBoard mode="setup" />
    </AdminPage>
  )
}

/**
 * 대진 보드. setup: 대진 구성(관리자 화면), results: 결과 입력·되돌리기(모니터링 관리).
 * 본선 결과를 동결했으면 두 곳 모두 보기만 한다.
 */
export function BracketBoard({ mode }: { mode: 'setup' | 'results' }) {
  const { t } = useTranslation()
  const bracket = useBracket()
  const teams = useTeams()
  const live = useLiveState()
  const frozen = live.data?.bracket_frozen ?? false
  const setup = mode === 'setup' && !frozen
  const [addingRound, setAddingRound] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const currentId = live.data?.current_match?.id ?? null
  const rounds = bracket.data?.rounds.map((round, index) => (
    <RoundBlock
      key={round.id}
      round={round}
      index={index}
      bracket={bracket.data}
      teams={teams.data ?? []}
      setup={setup}
      frozen={frozen}
      currentId={currentId}
    />
  ))

  const roundAdded = (message: string | null) => {
    setAddingRound(false)
    setNotice(message)
  }

  return (
    <>
      {bracket.isPending && <Loading />}
      {bracket.isError && <ErrorState error={bracket.error} onRetry={() => bracket.refetch()} />}
      {bracket.data && (
        <>
          {frozen && <Message>{t('admin.bracket.frozen')}</Message>}
          {live.data?.current_match && (
            <p className={styles.current}>
              {t('admin.bracket.currentIs', { label: live.data.current_match.label })}{' '}
              <a href={`#match-${live.data.current_match.id}`}>
                {t('admin.bracket.jumpToCurrent')}
              </a>
            </p>
          )}
          {setup && bracket.data.rounds.length > 0 && (
            <div className={styles.tools}>
              <div className={ui.actions}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotice(null)
                    setAddingRound(true)
                  }}
                  disabled={addingRound}
                >
                  <Icon name="plus" /> {t('admin.bracket.addRound')}
                </Button>
              </div>
              {notice && <Message tone="success">{notice}</Message>}
              {addingRound && <RoundForm onDone={roundAdded} />}
            </div>
          )}
          {bracket.data.rounds.length === 0 &&
            (setup ? (
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
                        <Icon name="plus" /> {t('admin.bracket.addRound')}
                      </Button>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <EmptyState>{t('admin.bracket.emptyReferee')}</EmptyState>
            ))}
          {setup && bracket.data.rounds.length > 0 ? (
            <SlotSwapProvider bracket={bracket.data}>{rounds}</SlotSwapProvider>
          ) : (
            rounds
          )}
        </>
      )}
    </>
  )
}

/** 랭킹 순위로 '예선 N위' 슬롯을 채운다. 종료된 매치는 건드리지 않는다 (모니터링 관리). */
export function SeedButton({ onSeeded }: { onSeeded: (message: string) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const seed = useAdminMutation({
    mutationFn: () => api.post<Bracket>('/api/admin/bracket/seed-from-ranking'),
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
  setup,
  frozen,
  currentId,
}: {
  round: BracketRound
  index: number
  bracket: Bracket
  teams: TeamPublic[]
  setup: boolean
  frozen: boolean
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
        {setup && mode === 'view' && (
          <div className={ui.actions}>
            <Button
              variant="secondary"
              className={ui.compact}
              onClick={() => {
                setNotice(null)
                setMode('addMatch')
              }}
            >
              <Icon name="plus" /> {t('admin.bracket.addMatch')}
            </Button>
            <IconButton
              icon="edit"
              label={t('admin.bracket.renameRound')}
              onClick={() => {
                setNotice(null)
                setMode('rename')
              }}
            />
            <span className={ui.iconGroup}>
              <IconButton
                icon="up"
                label={t('admin.common.moveUp')}
                disabled={index === 0 || move.isPending}
                onClick={() => move.mutate(-1)}
              />
              <IconButton
                icon="down"
                label={t('admin.common.moveDown')}
                disabled={index === bracket.rounds.length - 1 || move.isPending}
                onClick={() => move.mutate(1)}
              />
            </span>
            <IconButton
              icon="trash"
              tone="danger"
              label={t('admin.bracket.deleteRound')}
              onClick={() => setDeleting(true)}
            />
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
          {setup ? t('admin.bracket.roundEmptyAdmin') : t('admin.bracket.roundEmpty')}
        </EmptyState>
      ) : (
        <div className={styles.matches}>
          {round.matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              bracket={bracket}
              teams={teams}
              setup={setup}
              frozen={frozen}
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
