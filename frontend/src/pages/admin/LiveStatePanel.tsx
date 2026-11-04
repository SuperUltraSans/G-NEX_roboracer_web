import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { Bracket, LiveState, LiveStateUpdate, Phase, TeamPublic } from '../../api/types'
import { SelectField, TextArea } from '../../components/Field'
import { ErrorState, Loading } from '../../components/StateView'
import { useEventTimezone, useTeams } from '../../features/content/hooks'
import { useBracket, useLiveState } from '../../features/live/hooks'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import { formatDateTime } from '../../lib/time'
import ui from './ui/admin.module.css'
import { Choices } from './ui/Choices'
import { ErrorMessage, SaveButton, StaleNotice } from './ui/Feedback'
import { teamOption } from './ui/format'
import { useAdminMutation } from './ui/mutation'
import { useForm } from './ui/useForm'

const PHASES: readonly Phase[] = [
  'idle',
  'mapping',
  'practice',
  'free_practice',
  'qualifying',
  'bracket',
  'break',
  'finished',
]

interface LiveForm {
  phase: Phase
  teamId: string
  matchId: string
  messageKo: string
  messageEn: string
}

function toForm(state: LiveState): LiveForm {
  return {
    phase: state.phase,
    teamId: state.on_track_team ? String(state.on_track_team.id) : '',
    matchId: state.current_match ? String(state.current_match.id) : '',
    messageKo: state.message_ko ?? '',
    messageEn: state.message_en ?? '',
  }
}

/** 진행 상태 바꾸기: 현재 단계, 트랙 위 팀, 진행 중 매치, 공지 (모니터링 관리) */
export function LiveStatePanel() {
  const live = useLiveState()
  const teams = useTeams()
  const bracket = useBracket()

  return (
    <>
      {live.isPending && <Loading />}
      {live.isError && <ErrorState error={live.error} onRetry={() => live.refetch()} />}
      {live.data && (
        <LiveStateForm latest={live.data} teams={teams.data ?? []} bracket={bracket.data} />
      )}
    </>
  )
}

function LiveStateForm({
  latest,
  teams,
  bracket,
}: {
  latest: LiveState
  teams: TeamPublic[]
  bracket: Bracket | undefined
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const queryClient = useQueryClient()
  const [base, setBase] = useState(latest)
  const { values, set, reset, saved, setSaved } = useForm(() => toForm(latest))

  const save = useAdminMutation({
    mutationFn: (body: LiveStateUpdate) => api.put<LiveState>('/api/admin/live/state', body),
    onSuccess: (state) => {
      queryClient.setQueryData(queryKeys.liveState, state)
      // 진행 중 매치를 고르면 그 매치 상태도 바뀐다 (실시간 연결이 끊겨 있어도 맞게)
      void queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
      setBase(state)
      reset(toForm(state))
      setSaved(true)
    },
  })

  const reload = () => {
    setBase(latest)
    reset(toForm(latest))
    save.reset()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // 그사이 비활성화(기권)된 팀은 보내지 않는다 (서버가 거절한다)
    const teamId = values.teamId ? Number(values.teamId) : null
    const activeTeam = teamId !== null && teams.some((team) => team.id === teamId)
    save.mutate({
      phase: values.phase,
      on_track_team_id: activeTeam ? teamId : null,
      current_match_id: values.matchId ? Number(values.matchId) : null,
      message_ko: values.messageKo.trim() || null,
      message_en: values.messageEn.trim() || null,
    })
  }

  // 지금 진행 상태의 팀이 비활성이어도 선택 상자에 보이게 한다
  const teamChoices =
    latest.on_track_team && !teams.some((team) => team.id === latest.on_track_team?.id)
      ? [latest.on_track_team, ...teams]
      : teams

  return (
    <form className={`${ui.form} ${ui.narrow}`} onSubmit={submit} noValidate>
      {latest.updated_at !== base.updated_at && !save.isPending && (
        <StaleNotice onReload={reload} />
      )}
      <p className={ui.meta}>
        {t('admin.live.updatedAt', { time: formatDateTime(base.updated_at, timezone, lang) })}
      </p>
      <Choices
        legend={t('admin.live.phase')}
        value={values.phase}
        onChange={(phase) => set('phase', phase)}
        options={PHASES.map((phase) => ({ value: phase, label: t(`admin.phase.${phase}`) }))}
      />
      <SelectField
        label={t('admin.live.onTrack')}
        value={values.teamId}
        onChange={(event) => set('teamId', event.target.value)}
      >
        <option value="">{t('admin.common.none')}</option>
        {teamChoices.map((team) => (
          <option key={team.id} value={team.id}>
            {teamOption(t, team, lang)}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={t('admin.live.currentMatch')}
        value={values.matchId}
        onChange={(event) => set('matchId', event.target.value)}
        hint={bracket && bracket.rounds.length === 0 ? t('admin.live.noMatches') : undefined}
      >
        <option value="">{t('admin.common.none')}</option>
        {bracket?.rounds.map((round) => (
          <optgroup key={round.id} label={pickLocalized(round, 'name', lang) ?? ''}>
            {round.matches.map((match) => (
              <option key={match.id} value={match.id}>
                {t('admin.live.matchOption', {
                  label: match.label,
                  status: t(`admin.matchStatus.${match.status}`),
                })}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectField>
      <div className={ui.pair}>
        <TextArea
          label={t('admin.live.noticeKo')}
          value={values.messageKo}
          onChange={(event) => set('messageKo', event.target.value)}
          maxLength={500}
          rows={3}
          hint={t('admin.live.noticeHint')}
        />
        <TextArea
          label={t('admin.live.noticeEn')}
          lang="en"
          value={values.messageEn}
          onChange={(event) => set('messageEn', event.target.value)}
          maxLength={500}
          rows={3}
          hint={t('admin.common.enFallback')}
        />
      </div>
      <ErrorMessage error={save.error} />
      <div className={ui.actions}>
        <SaveButton pending={save.isPending} saved={saved} />
      </div>
    </form>
  )
}
