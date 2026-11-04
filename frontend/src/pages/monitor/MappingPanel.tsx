import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { LiveState, LiveStateUpdate, MappingUpdate } from '../../api/types'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ErrorState, Loading } from '../../components/StateView'
import { useEventTimezone, useTeams } from '../../features/content/hooks'
import { useLiveState } from '../../features/live/hooks'
import { mappingRows } from '../../features/live/mapping'
import { useLang } from '../../i18n'
import { Section } from '../admin/ui/AdminPage'
import ui from '../admin/ui/admin.module.css'
import { ErrorMessage, Message, Tag, type TagTone } from '../admin/ui/Feedback'
import { formatClock, teamOption } from '../admin/ui/format'
import { useAdminMutation } from '../admin/ui/mutation'
import styles from './Monitor.module.css'

const STATUS_TONE = {
  done: 'done',
  onTrack: 'live',
  next: 'on',
  waiting: 'off',
} as const satisfies Record<string, TagTone>

/**
 * 맵핑 순서: 참가 팀을 무작위로 섞고, 차례대로 트랙에 올리고, 마치면 완료로 표시한다.
 * 공개 모니터링 '맵핑' 탭과 상태 줄에 바로 보인다. 동결한 뒤(예선 순서로 씀)에는 보기만 한다.
 */
export function MappingPanel() {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  const live = useLiveState()
  const teams = useTeams()
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const state = live.data
  const rows = mappingRows(state)
  const frozen = state?.mapping_frozen ?? false
  const doneCount = rows.filter((row) => row.status === 'done').length
  const onTrack = rows.some((row) => row.status === 'onTrack')
  // 순서를 정한 뒤에 등록한 팀은 다시 섞어야 들어간다
  const missing = (teams.data ?? []).filter((team) => !rows.some((row) => row.team.id === team.id))

  const apply = (next: LiveState) => queryClient.setQueryData(queryKeys.liveState, next)

  const shuffle = useAdminMutation({
    mutationFn: () => api.post<LiveState>('/api/admin/mapping/shuffle'),
    onSuccess: (next) => {
      apply(next)
      setConfirming(false)
    },
  })
  // 맵핑 전체 취소: 순서와 완료 기록을 모두 지운다 (현재 단계·트랙 위 팀은 그대로)
  const reset = useAdminMutation({
    mutationFn: () => api.delete<LiveState>('/api/admin/mapping'),
    onSuccess: (next) => {
      apply(next)
      setResetting(false)
    },
  })
  const mark = useAdminMutation({
    mutationFn: ({ teamId, done }: { teamId: number; done: boolean }) =>
      api.put<LiveState>(`/api/admin/mapping/${teamId}`, { done } satisfies MappingUpdate),
    onSuccess: apply,
  })
  // 트랙에 올리기: 진행 상태를 '맵핑'으로 두고 트랙 위 팀만 바꾼다 (진행 중 매치·공지는 그대로)
  const putOnTrack = useAdminMutation({
    mutationFn: (teamId: number) =>
      api.put<LiveState>('/api/admin/live/state', {
        phase: 'mapping',
        on_track_team_id: teamId,
        current_match_id: state?.current_match?.id ?? null,
        message_ko: state?.message_ko ?? null,
        message_en: state?.message_en ?? null,
      } satisfies LiveStateUpdate),
    onSuccess: apply,
  })
  const busy = shuffle.isPending || reset.isPending || mark.isPending || putOnTrack.isPending

  return (
    <Section id="monitor-mapping" title={t('monitor.mapping.title')}>
      {!state?.mapping_frozen && <p className={ui.lead}>{t('monitor.lead.mapping')}</p>}
      {live.isPending && <Loading />}
      {live.isError && <ErrorState error={live.error} onRetry={() => live.refetch()} />}
      {state && (
        <>
          {frozen && <Message>{t('monitor.mapping.frozen')}</Message>}
          <div className={ui.actions}>
            {!frozen && (
              <Button
                variant={rows.length === 0 ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => (rows.length === 0 ? shuffle.mutate() : setConfirming(true))}
              >
                {rows.length === 0 ? t('monitor.mapping.shuffle') : t('monitor.mapping.reshuffle')}
              </Button>
            )}
            {!frozen && rows.length > 0 && (
              <Button variant="danger" disabled={busy} onClick={() => setResetting(true)}>
                {t('monitor.mapping.reset')}
              </Button>
            )}
            {rows.length > 0 && (
              <span className={ui.meta}>
                {t('live.mapping.summary', { done: doneCount, total: rows.length })}
              </span>
            )}
          </div>
          {!frozen && rows.length > 0 && missing.length > 0 && (
            <Message>
              {t('monitor.mapping.missing', {
                count: missing.length,
                teams: missing.map((team) => teamOption(t, team, lang)).join(', '),
              })}
            </Message>
          )}
          <ErrorMessage error={shuffle.error ?? mark.error ?? putOnTrack.error} />
          {rows.length === 0 ? (
            <p className={ui.meta}>{t('monitor.mapping.empty')}</p>
          ) : (
            <ol className={styles.mappingList}>
              {rows.map((row) => (
                <li key={row.team.id} className={styles.mappingRow} data-status={row.status}>
                  <span className={`num ${styles.mappingOrder}`}>{row.order}</span>
                  <span className={styles.mappingTeam}>
                    {teamOption(t, row.team, lang)}{' '}
                    <Tag tone={STATUS_TONE[row.status]}>
                      {t(`live.mapping.state.${row.status}`)}
                    </Tag>
                    {row.mapped_at && (
                      <span className={ui.meta}> {formatClock(row.mapped_at, timezone)}</span>
                    )}
                  </span>
                  {!frozen && (
                    <span className={ui.rowActions}>
                      {row.status !== 'done' && row.status !== 'onTrack' && (
                        <Button
                          variant={row.status === 'next' && !onTrack ? 'primary' : 'secondary'}
                          className={ui.compact}
                          disabled={busy}
                          onClick={() => putOnTrack.mutate(row.team.id)}
                        >
                          {t('monitor.mapping.putOnTrack')}
                        </Button>
                      )}
                      <Button
                        variant={row.status === 'onTrack' ? 'primary' : 'secondary'}
                        className={ui.compact}
                        disabled={busy}
                        onClick={() =>
                          mark.mutate({ teamId: row.team.id, done: row.status !== 'done' })
                        }
                      >
                        {row.status === 'done'
                          ? t('monitor.mapping.undo')
                          : t('monitor.mapping.done')}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('monitor.mapping.reshuffleTitle')}
        confirmLabel={shuffle.isPending ? t('admin.common.saving') : t('monitor.mapping.reshuffle')}
        cancelLabel={t('admin.common.cancel')}
        busy={shuffle.isPending}
        onConfirm={() => shuffle.mutate()}
        onCancel={() => {
          setConfirming(false)
          shuffle.reset()
        }}
      >
        <p>{t('monitor.mapping.reshuffleBody', { count: doneCount })}</p>
        <ErrorMessage error={shuffle.error} />
      </ConfirmDialog>
      <ConfirmDialog
        open={resetting}
        danger
        title={t('monitor.mapping.resetTitle')}
        confirmLabel={reset.isPending ? t('admin.common.saving') : t('monitor.mapping.reset')}
        cancelLabel={t('admin.common.cancel')}
        busy={reset.isPending}
        onConfirm={() => reset.mutate()}
        onCancel={() => {
          setResetting(false)
          reset.reset()
        }}
      >
        <p>{t('monitor.mapping.resetBody', { total: rows.length, count: doneCount })}</p>
        <ErrorMessage error={reset.error} />
      </ConfirmDialog>
    </Section>
  )
}
