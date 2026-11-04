import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { InspectionEntry, InspectionUpdate, LiveState, PracticeUpdate } from '../../api/types'
import { Button } from '../../components/Button'
import { ErrorState, Loading } from '../../components/StateView'
import { useLiveState } from '../../features/live/hooks'
import { PracticeView } from '../../features/live/PracticeView'
import { useLang } from '../../i18n'
import { Section } from '../admin/ui/AdminPage'
import ui from '../admin/ui/admin.module.css'
import { ErrorMessage, Tag } from '../admin/ui/Feedback'
import { teamOption } from '../admin/ui/format'
import { useAdminMutation } from '../admin/ui/mutation'
import styles from './Monitor.module.css'

type GroupName = NonNullable<PracticeUpdate['group']>

/**
 * 그룹 연습 조: 차량 검사를 마친 팀이 검사 순서대로 원하는 조(A·B 3팀, C 4팀)를 먼저 고른다.
 * 공개 모니터링 '연습' 탭에 바로 보인다.
 */
export function PracticePanel() {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const live = useLiveState()
  const inspection = useQuery({
    queryKey: queryKeys.inspection,
    queryFn: () => api.get<InspectionEntry[]>('/api/admin/qualifying/inspection'),
  })

  const pick = useAdminMutation({
    mutationFn: ({ teamId, group }: { teamId: number; group: GroupName | null }) =>
      api.put<LiveState>(`/api/admin/practice/${teamId}`, { group } satisfies PracticeUpdate),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.liveState, next),
  })
  const inspect = useAdminMutation({
    mutationFn: (teamId: number) =>
      api.put<InspectionEntry[]>(`/api/admin/qualifying/inspection/${teamId}`, {
        done: true,
      } satisfies InspectionUpdate),
    onSuccess: (entries) => {
      queryClient.setQueryData(queryKeys.inspection, entries)
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
    },
  })
  const busy = pick.isPending || inspect.isPending

  const groups = live.data?.practice ?? []
  const groupOf = new Map(
    groups.flatMap((group) => group.teams.map((member) => [member.team.id, group.name] as const)),
  )
  const entries = [...(inspection.data ?? [])].sort(
    (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.team.id - b.team.id,
  )
  // 검사를 마쳤는데 아직 조를 고르지 않은 팀 중 가장 앞이 지금 고를 차례
  const turnId = entries.find((entry) => entry.order && !groupOf.has(entry.team.id))?.team.id

  return (
    <Section id="monitor-practice" title={t('monitor.practice.title')}>
      <p className={ui.lead}>{t('monitor.lead.practice')}</p>
      {(live.isPending || inspection.isPending) && <Loading />}
      {live.isError && <ErrorState error={live.error} onRetry={() => live.refetch()} />}
      {inspection.isError && (
        <ErrorState error={inspection.error} onRetry={() => inspection.refetch()} />
      )}
      {live.data && <PracticeView state={live.data} />}
      <ErrorMessage error={pick.error ?? inspect.error} />
      {inspection.data && (
        <ol className={styles.mappingList}>
          {entries.map((entry) => {
            const chosen = groupOf.get(entry.team.id)
            return (
              <li
                key={entry.team.id}
                className={styles.mappingRow}
                data-status={entry.team.id === turnId ? 'onTrack' : undefined}
              >
                <span className={`num ${styles.practiceOrder}`}>
                  {entry.order
                    ? t('monitor.practice.inspectedAt', { n: entry.order })
                    : t('monitor.practice.notInspected')}
                </span>
                <span className={styles.mappingTeam}>
                  {teamOption(t, entry.team, lang)}{' '}
                  {chosen && <Tag tone="on">{t('live.practice.group', { name: chosen })}</Tag>}
                  {entry.team.id === turnId && <Tag tone="live">{t('monitor.practice.turn')}</Tag>}
                </span>
                <span className={ui.rowActions}>
                  {!entry.order ? (
                    <Button
                      variant="secondary"
                      className={ui.compact}
                      disabled={busy}
                      onClick={() => inspect.mutate(entry.team.id)}
                    >
                      {t('monitor.practice.inspect')}
                    </Button>
                  ) : chosen ? (
                    <Button
                      variant="secondary"
                      className={ui.compact}
                      disabled={busy}
                      onClick={() => pick.mutate({ teamId: entry.team.id, group: null })}
                    >
                      {t('monitor.practice.remove')}
                    </Button>
                  ) : (
                    groups.map((group) => {
                      const full = group.teams.length >= group.capacity
                      return (
                        <Button
                          key={group.name}
                          variant={entry.team.id === turnId && !full ? 'primary' : 'secondary'}
                          className={ui.compact}
                          disabled={busy || full}
                          onClick={() => pick.mutate({ teamId: entry.team.id, group: group.name })}
                        >
                          {full
                            ? t('monitor.practice.full', { name: group.name })
                            : t('monitor.practice.pickIn', { name: group.name })}
                        </Button>
                      )
                    })
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}
