// 예선 출전 순서: 끌어 놓거나 ↑↓ 로 바꾸고 저장한다. 맵핑 순서(맵핑 탭)는 그대로 둔다.
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { Leaderboard, LeaderboardRow, QualifyingOrderUpdate } from '../../api/types'
import { Button } from '../../components/Button'
import { ErrorState, Loading } from '../../components/StateView'
import { useLeaderboard, useLiveState } from '../../features/live/hooks'
import { useLang } from '../../i18n'
import { byRunOrder } from '../admin/qualifying/labels'
import { Section } from '../admin/ui/AdminPage'
import ui from '../admin/ui/admin.module.css'
import { ErrorMessage, Message, SaveButton, Tag } from '../admin/ui/Feedback'
import { teamName } from '../admin/ui/format'
import { Icon } from '../admin/ui/Icon'
import { useAdminMutation } from '../admin/ui/mutation'
import styles from './Monitor.module.css'

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const runOrderIds = (rows: readonly LeaderboardRow[]) =>
  byRunOrder(
    rows.map((row) => row.team),
    rows,
  ).map((team) => team.id)

export function QualifyingOrderPanel() {
  const { t } = useTranslation()
  const leaderboard = useLeaderboard()
  const live = useLiveState()
  return (
    <Section id="qualifying-order" title={t('monitor.qualifyingOrder.title')}>
      <p className={ui.lead}>{t('monitor.qualifyingOrder.lead')}</p>
      {leaderboard.isPending && <Loading />}
      {leaderboard.isError && (
        <ErrorState error={leaderboard.error} onRetry={() => leaderboard.refetch()} />
      )}
      {leaderboard.data && (
        <OrderEditor
          rows={leaderboard.data.rows}
          onTrackId={live.data?.on_track_team?.id ?? null}
        />
      )}
    </Section>
  )
}

function OrderEditor({ rows, onTrackId }: { rows: LeaderboardRow[]; onTrackId: number | null }) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const byId = new Map(rows.map((row) => [row.team.id, row]))
  const savedIds = runOrderIds(rows)

  // base: 고치기 시작한 저장본. order: 고치는 중인 순서
  const [base, setBase] = useState<number[]>(savedIds)
  const [order, setOrder] = useState<number[]>(savedIds)
  const [dragging, setDragging] = useState<number | null>(null)
  // 그사이 기권한 팀은 양쪽에서 함께 뺀다
  const visible = order.filter((id) => byId.has(id))
  const edited = !same(
    visible,
    base.filter((id) => byId.has(id)),
  )
  const stale = !same(savedIds, base)
  // 다른 곳에서 순서가 바뀌었거나 팀이 늘고 줄었을 때: 고친 것이 없으면 새 저장본을 바로 따른다
  if (stale && !edited) {
    setBase(savedIds)
    setOrder(savedIds)
  }

  const save = useAdminMutation({
    mutationFn: (body: QualifyingOrderUpdate) =>
      api.put<Leaderboard>('/api/admin/qualifying/order', body),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.leaderboard, next)
      const ids = runOrderIds(next.rows)
      setBase(ids)
      setOrder(ids)
    },
  })

  const change = (next: number[]) => {
    setOrder(next)
    save.reset()
  }
  const moveTo = (id: number, position: number) => {
    const rest = visible.filter((item) => item !== id)
    rest.splice(position, 0, id)
    if (!same(rest, visible)) change(rest)
  }
  const reload = () => {
    setBase(savedIds)
    change(savedIds)
  }

  return (
    <>
      {stale && edited && (
        <Message
          action={
            <Button variant="secondary" onClick={reload}>
              {t('admin.common.loadLatest')}
            </Button>
          }
        >
          {t('monitor.qualifyingOrder.stale')}
        </Message>
      )}
      <ol className={styles.orderList}>
        {visible.map((id, index) => {
          const row = byId.get(id)
          if (!row) return null
          const name = teamName(row.team, lang)
          return (
            <li
              key={id}
              className={styles.orderRow}
              draggable
              data-dragging={dragging === id ? '' : undefined}
              onDragStart={(event) => {
                setDragging(id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', String(id))
              }}
              // 끄는 팀이 다른 줄 위에 오면 그 자리로 바로 옮긴다 (놓기 전에 결과가 보인다)
              onDragOver={(event) => {
                if (dragging === null) return
                event.preventDefault()
                if (dragging !== id) moveTo(dragging, index)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(null)
              }}
              onDragEnd={() => setDragging(null)}
            >
              <span className={styles.orderHandle} title={t('monitor.qualifyingOrder.drag')}>
                <Icon name="move" />
              </span>
              <span className={`num ${styles.orderNum}`}>{index + 1}</span>
              <span className={styles.rankTeam}>
                <span className={styles.rankId}>#{id}</span> {name}{' '}
                {id === onTrackId && <Tag tone="live">{t('monitor.qualifyingOrder.onTrack')}</Tag>}
                {row.attempts > 0 && <Tag tone="done">{t('monitor.qualifyingOrder.ran')}</Tag>}
              </span>
              <span className={styles.rankActions}>
                <Button
                  variant="secondary"
                  className={ui.compact}
                  disabled={index === 0}
                  aria-label={t('monitor.qualifyingOrder.up', { team: name })}
                  onClick={() => moveTo(id, index - 1)}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  className={ui.compact}
                  disabled={index === visible.length - 1}
                  aria-label={t('monitor.qualifyingOrder.down', { team: name })}
                  onClick={() => moveTo(id, index + 1)}
                >
                  ↓
                </Button>
              </span>
            </li>
          )
        })}
      </ol>
      <ErrorMessage error={save.error} />
      <form
        className={ui.actions}
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate({ team_ids: visible })
        }}
      >
        <SaveButton
          pending={save.isPending}
          saved={!edited && save.isSuccess}
          disabled={!edited}
          label={t('monitor.qualifyingOrder.save')}
        />
        {edited && (
          <>
            <Button variant="secondary" onClick={reload}>
              {t('monitor.qualifyingOrder.revert')}
            </Button>
            <span className={ui.meta}>{t('monitor.qualifyingOrder.unsaved')}</span>
          </>
        )}
      </form>
    </>
  )
}
