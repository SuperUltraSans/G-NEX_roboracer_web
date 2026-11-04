// 랭킹: 운영진이 팀 순위를 직접 정한다. 저장한 랭킹으로 본선 '예선 N위' 슬롯(시드)을 채운다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type {
  InspectionEntry,
  Leaderboard,
  Ranking,
  RankingUpdate,
  TeamPublic,
} from '../../api/types'
import { Button } from '../../components/Button'
import { ErrorState, Loading } from '../../components/StateView'
import { useEventTimezone, useTeams } from '../../features/content/hooks'
import { useLeaderboard } from '../../features/live/hooks'
import { useLang } from '../../i18n'
import { formatDateTime } from '../../lib/time'
import { SeedButton } from '../admin/bracket/BracketPage'
import { InspectionOrder } from '../admin/qualifying/InspectionOrder'
import { Card, Section } from '../admin/ui/AdminPage'
import ui from '../admin/ui/admin.module.css'
import { ErrorMessage, Message, SaveButton } from '../admin/ui/Feedback'
import { teamName } from '../admin/ui/format'
import { useAdminMutation } from '../admin/ui/mutation'
import styles from './Monitor.module.css'

export function RankingPanel() {
  const ranking = useQuery({
    queryKey: queryKeys.ranking,
    queryFn: () => api.get<Ranking>('/api/admin/ranking'),
  })
  const teams = useTeams()
  const leaderboard = useLeaderboard()
  const inspection = useQuery({
    queryKey: queryKeys.inspection,
    queryFn: () => api.get<InspectionEntry[]>('/api/admin/qualifying/inspection'),
  })

  if (ranking.isError) return <ErrorState error={ranking.error} onRetry={() => ranking.refetch()} />
  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => teams.refetch()} />
  if (!ranking.data || !teams.data) return <Loading />
  return (
    <RankingEditor
      saved={ranking.data}
      teams={teams.data}
      leaderboard={leaderboard.data}
      inspection={inspection.data}
    />
  )
}

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

function RankingEditor({
  saved,
  teams,
  leaderboard,
  inspection,
}: {
  saved: Ranking
  teams: TeamPublic[]
  leaderboard: Leaderboard | undefined
  inspection: InspectionEntry[] | undefined
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  // 공개 팀 목록(활성 팀)에 있는 팀만 다룬다
  const byId = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams])
  const idsOf = (ranking: Ranking) =>
    ranking.entries.map((entry) => entry.team.id).filter((id) => byId.has(id))
  const savedIds = idsOf(saved)
  // 저장된 순위가 1위부터 이어지지 않으면(저장 뒤 빠진 팀이 있으면) 다시 저장해야 시드가 화면과 맞는다
  const gapped =
    savedIds.length !== saved.entries.length ||
    saved.entries.some((entry, index) => entry.rank !== index + 1)

  // base: 지금 고치고 있는 목록이 출발한 저장본. order: 고치는 중인 목록
  const [base, setBase] = useState<number[]>(savedIds)
  const [order, setOrder] = useState<number[]>(savedIds)
  const [notice, setNotice] = useState<string | null>(null)
  // 그사이 비활성화된 팀은 양쪽에서 함께 뺀다 (팀 목록이 랭킹보다 먼저 바뀌어도 고친 것으로 보지 않게)
  const visible = order.filter((id) => byId.has(id))
  const baseVisible = base.filter((id) => byId.has(id))
  const edited = !same(visible, baseVisible)
  const stale = !same(savedIds, baseVisible)
  // 다른 운영진이 저장했거나 팀이 비활성화됐을 때: 고친 것이 없으면 새 저장본을 바로 따른다
  if (stale && !edited) {
    setBase(savedIds)
    setOrder(savedIds)
  }
  const dirty = edited || gapped

  const ranked = visible.map((id) => byId.get(id)).filter((team): team is TeamPublic => !!team)
  const unranked = teams.filter((team) => !visible.includes(team.id))

  const save = useAdminMutation({
    mutationFn: (body: RankingUpdate) => api.put<Ranking>('/api/admin/ranking', body),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.ranking, next)
      setBase(idsOf(next))
      setOrder(idsOf(next))
    },
  })

  const change = (next: number[]) => {
    setOrder(next)
    setNotice(null)
    save.reset()
  }
  const moveTo = (id: number, position: number) => {
    const rest = visible.filter((item) => item !== id)
    rest.splice(position, 0, id)
    change(rest)
  }
  const reload = () => {
    setBase(savedIds)
    change(savedIds)
  }
  const fromQualifying = () => {
    const rows = (leaderboard?.rows ?? []).filter((row) => byId.has(row.team.id))
    // 랩 기록이 없는 팀도 규칙 4.7 로는 Q1 0랩이다. 빠뜨리면 그 시드 칸이 비어 상대가 부전승으로
    // 올라가므로 맨 아래에 차량 검사 순서대로 넣는다 (나오지 않은 팀이면 운영진이 뺀다)
    const order = new Map((inspection ?? []).map((entry) => [entry.team.id, entry.order]))
    const waiting = rows
      .filter((row) => row.rank === null)
      .map((row) => row.team)
      .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.id - b.id)
    change([
      ...rows.filter((row) => row.rank !== null).map((row) => row.team.id),
      ...waiting.map((team) => team.id),
    ])
    if (waiting.length > 0) {
      setNotice(
        t('monitor.ranking.waitingAdded', {
          count: waiting.length,
          teams: waiting.map((team) => `#${team.id} ${teamName(team, lang)}`).join(', '),
        }),
      )
    }
  }

  return (
    <div className={styles.rankingLayout}>
      <Section
        id="ranking"
        title={t('monitor.ranking.title')}
        actions={
          saved.updated_at && (
            <span className={ui.meta}>
              {t('monitor.ranking.savedAt', {
                time: formatDateTime(saved.updated_at, timezone, lang),
              })}
            </span>
          )
        }
      >
        <p className={ui.lead}>{t('monitor.ranking.lead')}</p>
        {notice && <Message tone="success">{notice}</Message>}
        {stale && edited && (
          <Message
            action={
              <Button variant="secondary" onClick={reload}>
                {t('admin.common.loadLatest')}
              </Button>
            }
          >
            {t('monitor.ranking.stale')}
          </Message>
        )}
        <div className={styles.rankingColumns}>
          <div className={styles.rankingBox}>
            <h3 className={styles.boxTitle}>
              {t('monitor.ranking.ranked', { count: ranked.length })}
            </h3>
            {ranked.length === 0 ? (
              <p className={ui.meta}>{t('monitor.ranking.emptyRanked')}</p>
            ) : (
              <ol className={styles.rankList}>
                {ranked.map((team, index) => (
                  <li key={team.id} className={styles.rankRow}>
                    <label className={styles.rankPick}>
                      <span className="visually-hidden">
                        {t('monitor.ranking.positionOf', { team: teamName(team, lang) })}
                      </span>
                      <select
                        value={index}
                        onChange={(event) => moveTo(team.id, Number(event.target.value))}
                      >
                        {ranked.map((_, position) => (
                          <option key={position} value={position}>
                            {t('monitor.ranking.rankN', { rank: position + 1 })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className={styles.rankTeam}>
                      <span className={styles.rankId}>#{team.id}</span> {teamName(team, lang)}
                    </span>
                    <span className={styles.rankActions}>
                      <Button
                        variant="secondary"
                        className={ui.compact}
                        disabled={index === 0}
                        aria-label={t('monitor.ranking.up', { team: teamName(team, lang) })}
                        onClick={() => moveTo(team.id, index - 1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        className={ui.compact}
                        disabled={index === ranked.length - 1}
                        aria-label={t('monitor.ranking.down', { team: teamName(team, lang) })}
                        onClick={() => moveTo(team.id, index + 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        variant="secondary"
                        className={ui.compact}
                        onClick={() => change(visible.filter((id) => id !== team.id))}
                      >
                        {t('monitor.ranking.remove')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className={styles.rankingBox}>
            <h3 className={styles.boxTitle}>
              {t('monitor.ranking.unranked', { count: unranked.length })}
            </h3>
            {unranked.length === 0 ? (
              <p className={ui.meta}>{t('monitor.ranking.allRanked')}</p>
            ) : (
              <ul className={styles.rankList}>
                {unranked.map((team) => (
                  <li key={team.id} className={styles.rankRow}>
                    <span className={styles.rankTeam}>
                      <span className={styles.rankId}>#{team.id}</span> {teamName(team, lang)}
                    </span>
                    <span className={styles.rankActions}>
                      <Button
                        variant="secondary"
                        className={ui.compact}
                        onClick={() => change([...visible, team.id])}
                      >
                        {t('monitor.ranking.add', { rank: visible.length + 1 })}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.helpers}>
              <Button variant="secondary" onClick={fromQualifying} disabled={!leaderboard}>
                {t('monitor.ranking.fromQualifying')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => change([])}
                disabled={visible.length === 0}
              >
                {t('monitor.ranking.clear')}
              </Button>
            </div>
            <p className={ui.meta}>{t('monitor.ranking.fromQualifyingHint')}</p>
          </div>
        </div>
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
            saved={!dirty && save.isSuccess}
            label={t('monitor.ranking.save')}
          />
          {edited && (
            <Button variant="secondary" onClick={reload}>
              {t('monitor.ranking.revert')}
            </Button>
          )}
          {dirty && (
            <span className={ui.meta}>
              {edited ? t('monitor.ranking.unsaved') : t('monitor.ranking.gapped')}
            </span>
          )}
        </form>
      </Section>

      <Card
        title={t('monitor.seed.title')}
        description={t('monitor.seed.description')}
        footer={
          dirty ? (
            <p className={ui.meta}>{t('monitor.seed.saveFirst')}</p>
          ) : savedIds.length === 0 ? (
            <p className={ui.meta}>{t('monitor.seed.emptyRanking')}</p>
          ) : (
            <SeedButton onSeeded={setNotice} />
          )
        }
      />

      <InspectionOrder />
    </div>
  )
}
