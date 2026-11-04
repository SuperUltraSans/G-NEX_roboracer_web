import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type {
  Mission,
  QualifyingLapAdmin,
  QualifyingLapCreate,
  QualifyingLapVoid,
} from '../../../api/types'
import { Button } from '../../../components/Button'
import { TextField } from '../../../components/Field'
import { ErrorState, Loading } from '../../../components/StateView'
import { useTeams } from '../../../features/content/hooks'
import { useLeaderboard, useLiveState } from '../../../features/live/hooks'
import { useLang } from '../../../i18n'
import { formatLap } from '../../../lib/laptime'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage, Message } from '../ui/Feedback'
import { filterTeams, teamName, teamOption } from '../ui/format'
import { useAdminMutation } from '../ui/mutation'
import { Judgements } from './Judgements'
import { byRunOrder, checkLapInput, MISSIONS, previewLap, type EntryStatus } from './labels'
import { MissionStatus } from './MissionStatus'
import styles from './Qualifying.module.css'

/**
 * 예선 기록: 팀(기본은 트랙 위 팀) → 랩이 끝날 때마다 '유효 랩'/'무효 랩'.
 * 미션은 연속 3랩이 되면 다음으로 저절로 넘어가고, Q3 의 유효 랩은 랩타임을 함께 적는다.
 * 빠르게 누르도록 확인 창 대신 '되돌리기'(입력 취소)를 둔다.
 */
export function LapEntry() {
  const { t } = useTranslation()
  const lang = useLang()
  const teams = useTeams()
  const leaderboard = useLeaderboard()
  const live = useLiveState()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  // 저장을 보낸 순간의 랩타임 칸. 응답이 오기 전에 다음 시간을 적었으면 지우지 않는다
  const sentText = useRef('')

  const [search, setSearch] = useState('')
  // 운영진이 직접 고른 팀. 고르지 않았으면 트랙 위 팀
  const [picked, setPicked] = useState<number | null>(null)
  // 직접 고른 미션. 고르지 않았으면 그 팀이 지금 하는 미션
  const [missionChoice, setMissionChoice] = useState<Mission | null>(null)
  const [lapText, setLapText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<QualifyingLapAdmin | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.laps })
    void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
  }

  const save = useAdminMutation({
    mutationFn: (body: QualifyingLapCreate) =>
      api.post<QualifyingLapAdmin>('/api/admin/qualifying/laps', body),
    onSuccess: (lap) => {
      setLastSaved(lap)
      setLapText((current) => (current === sentText.current ? '' : current))
      setMissionChoice(null)
      setError(null)
      refresh()
      // 다음 랩을 바로 적을 수 있게 랩타임 칸으로 돌아간다
      const field = formRef.current?.elements.namedItem('lap-time')
      if (field instanceof HTMLElement) field.focus()
    },
  })

  const undo = useAdminMutation({
    mutationFn: (lap: QualifyingLapAdmin) =>
      api.post<QualifyingLapAdmin>(`/api/admin/qualifying/laps/${lap.id}/void`, {
        reason: t('admin.qualifying.undoReason'),
        version: lap.version,
      } satisfies QualifyingLapVoid),
    onSuccess: () => {
      setLastSaved(null)
      refresh()
    },
  })

  if (teams.isPending) return <Loading />
  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => teams.refetch()} />

  // 팀 목록은 예선 출전 순서대로 (리더보드가 오기 전에는 팀 번호 순)
  const list = byRunOrder(teams.data, leaderboard.data?.rows)
  const onTrackId = live.data?.on_track_team?.id ?? null
  const teamId = picked ?? onTrackId
  const selected = list.find((team) => team.id === teamId) ?? null
  const row = selected ? leaderboard.data?.rows.find((r) => r.team.id === selected.id) : undefined
  const mission: Mission = missionChoice ?? row?.current_mission ?? 'Q1'
  const filtered = filterTeams(list, search)
  const preview = previewLap(lapText)

  const touched = () => {
    setError(null)
    setLastSaved(null)
    save.reset()
    undo.reset()
  }

  const recordLap = (status: EntryStatus) => {
    if (!selected) {
      setError(t('admin.qualifying.teamRequired'))
      return
    }
    const lap = checkLapInput(t, lapText, mission, status)
    if (lap.error) {
      setError(lap.error)
      return
    }
    undo.reset()
    sentText.current = lapText
    // 미션을 직접 고르지 않았으면 보내지 않는다: 서버가 저장하는 순간의 진행으로 정한다
    save.mutate({
      team_id: selected.id,
      ...(missionChoice ? { mission: missionChoice } : {}),
      status,
      lap_time_ms: lap.ms,
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    recordLap('valid')
  }

  return (
    <div className={styles.entry}>
      <fieldset className={styles.teams}>
        <legend className={styles.teamsLegend}>{t('admin.qualifying.team')}</legend>
        <p className={styles.selected} aria-live="polite">
          {selected ? (
            <>
              <strong>{teamOption(t, selected, lang)}</strong>{' '}
              {selected.id === onTrackId && (
                <span className={ui.meta}>{t('admin.qualifying.onTrack')}</span>
              )}
            </>
          ) : (
            <span className={ui.meta}>{t('admin.qualifying.noTeamSelected')}</span>
          )}
        </p>
        <TextField
          label={t('admin.qualifying.search')}
          name="team-search"
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          hint={t('admin.qualifying.searchHint')}
        />
        {list.length === 0 ? (
          <p className={styles.noMatch}>{t('admin.qualifying.noTeams')}</p>
        ) : filtered.length === 0 ? (
          <p className={styles.noMatch}>{t('admin.qualifying.noSearchMatch', { query: search })}</p>
        ) : (
          <div className={styles.teamList}>
            {filtered.map((team) => (
              <label key={team.id} className={styles.teamOption}>
                <input
                  type="radio"
                  name="team"
                  value={team.id}
                  checked={teamId === team.id}
                  onChange={() => {
                    setPicked(team.id)
                    setMissionChoice(null)
                    touched()
                  }}
                />
                <span className={`num ${styles.car}`}>#{team.id}</span>
                <span className={styles.teamName}>{teamName(team, lang)}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {selected && <MissionStatus row={row} />}

      <form ref={formRef} className={styles.lapForm} onSubmit={submit} noValidate>
        <Choices
          legend={t('admin.qualifying.mission')}
          value={mission}
          onChange={(next) => {
            setMissionChoice(next)
            touched()
          }}
          options={MISSIONS.map((value) => ({
            value,
            label: t(`admin.qualifying.missionName.${value}`),
          }))}
          hint={t('admin.qualifying.missionHint')}
        />
        <TextField
          label={t('admin.qualifying.lapTime')}
          name="lap-time"
          inputMode="decimal"
          autoComplete="off"
          placeholder={t('admin.qualifying.lapPlaceholder')}
          className={styles.lapInput}
          value={lapText}
          onChange={(event) => {
            setLapText(event.target.value)
            touched()
          }}
          hint={
            preview !== null
              ? t('admin.qualifying.lapPreview', { time: formatLap(preview) })
              : t(mission === 'Q3' ? 'admin.qualifying.lapHint' : 'admin.qualifying.lapOptional')
          }
          error={error ?? undefined}
        />
        <div className={styles.lapButtons}>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {t('admin.qualifying.validLap')}
          </Button>
          <Button variant="danger" disabled={save.isPending} onClick={() => recordLap('invalid')}>
            {t('admin.qualifying.invalidLap')}
          </Button>
        </div>
        <ErrorMessage error={save.error ?? undo.error} />
        {lastSaved && (
          <Message
            tone="success"
            action={
              <Button
                variant="secondary"
                className={ui.compact}
                disabled={undo.isPending}
                onClick={() => undo.mutate(lastSaved)}
              >
                {t('admin.qualifying.undo')}
              </Button>
            }
          >
            {t('admin.qualifying.savedLap', {
              team: teamOption(t, lastSaved.team, lang),
              mission: lastSaved.mission,
              result:
                lastSaved.status === 'valid'
                  ? t('admin.qualifying.validLap')
                  : t('admin.qualifying.invalidLap'),
              time: lastSaved.lap_time_ms !== null ? ` ${formatLap(lastSaved.lap_time_ms)}` : '',
              attempt: lastSaved.attempt_no,
            })}
          </Message>
        )}
        {undo.isSuccess && <Message>{t('admin.qualifying.undone')}</Message>}
      </form>

      {selected && <Judgements team={selected} row={row} />}
    </div>
  )
}
