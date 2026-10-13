import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { QualifyingLapAdmin, QualifyingLapCreate } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { TextField } from '../../../components/Field'
import { ErrorState, Loading } from '../../../components/StateView'
import { useTeams } from '../../../features/content/hooks'
import { useLeaderboard } from '../../../features/live/hooks'
import { useLang } from '../../../i18n'
import { formatLap } from '../../../lib/laptime'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage, Message } from '../ui/Feedback'
import { filterTeams, teamName, teamOption } from '../ui/format'
import { useAdminMutation } from '../ui/mutation'
import { checkLapInput, ENTRY_STATUSES, previewLap, type EntryStatus } from './labels'
import styles from './Qualifying.module.css'

/** 팀 선택(차량 번호 검색) → 랩타임 → 상태 → 확인 → 저장 (doc/Instruction.md 5.4) */
export function LapEntry() {
  const { t } = useTranslation()
  const lang = useLang()
  const teams = useTeams()
  const leaderboard = useLeaderboard()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)

  const [search, setSearch] = useState('')
  const [teamId, setTeamId] = useState<number | null>(null)
  const [lapText, setLapText] = useState('')
  const [status, setStatus] = useState<EntryStatus>('valid')
  const [errors, setErrors] = useState<{ team?: string; lap?: string }>({})
  const [confirming, setConfirming] = useState<QualifyingLapCreate | null>(null)
  const [lastSaved, setLastSaved] = useState<QualifyingLapAdmin | null>(null)

  const save = useAdminMutation({
    mutationFn: (body: QualifyingLapCreate) =>
      api.post<QualifyingLapAdmin>('/api/admin/qualifying/laps', body),
    onSuccess: (lap) => {
      setLastSaved(lap)
      setConfirming(null)
      setTeamId(null)
      setSearch('')
      setLapText('')
      setStatus('valid')
      setErrors({})
      void queryClient.invalidateQueries({ queryKey: queryKeys.laps })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      // 다음 차량을 바로 찾을 수 있게 검색칸으로 돌아간다
      const field = formRef.current?.elements.namedItem('team-search')
      if (field instanceof HTMLElement) field.focus()
    },
  })

  if (teams.isPending) return <Loading />
  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => teams.refetch()} />

  const list = teams.data
  const filtered = filterTeams(list, search)
  const selected = list.find((team) => team.id === teamId) ?? null
  const standing = selected
    ? leaderboard.data?.rows.find((row) => row.team.id === selected.id)
    : undefined
  const preview = previewLap(lapText, status)

  const touched = () => {
    setLastSaved(null)
    save.reset()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const lap = checkLapInput(t, lapText, status)
    const next = {
      team: selected ? undefined : t('admin.qualifying.teamRequired'),
      lap: lap.error ?? undefined,
    }
    setErrors(next)
    if (!selected || lap.error) return
    setConfirming({ team_id: selected.id, lap_time_ms: lap.ms, status })
  }

  // 확인 대화상자는 자기 form 을 가지므로 바깥 form 밖에 둔다
  return (
    <>
      <form ref={formRef} className={styles.entry} onSubmit={submit} noValidate>
        {lastSaved && (
          <Message tone="success">
            {t('admin.qualifying.savedLap', {
              team: teamOption(t, lastSaved.team, lang),
              time:
                lastSaved.lap_time_ms !== null
                  ? formatLap(lastSaved.lap_time_ms)
                  : t(`admin.lapStatus.${lastSaved.status}`),
              attempt: lastSaved.attempt_no,
            })}
          </Message>
        )}

        <fieldset
          className={styles.teams}
          aria-describedby={errors.team ? 'team-error' : undefined}
        >
          <legend className={styles.teamsLegend}>{t('admin.qualifying.team')}</legend>
          <p className={styles.selected} aria-live="polite">
            {selected ? (
              <>
                <strong>{teamOption(t, selected, lang)}</strong>{' '}
                <span className={ui.meta}>
                  {standing && standing.best_lap_ms !== null
                    ? t('admin.qualifying.standing', {
                        rank: standing.rank,
                        best: formatLap(standing.best_lap_ms),
                        attempts: standing.attempts,
                      })
                    : t('admin.qualifying.noLapYet')}
                </span>
              </>
            ) : (
              <span className={ui.meta}>{t('admin.qualifying.noTeamSelected')}</span>
            )}
          </p>
          <TextField
            label={t('admin.qualifying.search')}
            name="team-search"
            type="search"
            inputMode="numeric"
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              touched()
            }}
            hint={t('admin.qualifying.searchHint')}
          />
          {list.length === 0 ? (
            <p className={styles.noMatch}>{t('admin.qualifying.noTeams')}</p>
          ) : filtered.length === 0 ? (
            <p className={styles.noMatch}>
              {t('admin.qualifying.noSearchMatch', { query: search })}
            </p>
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
                      setTeamId(team.id)
                      setErrors((prev) => ({ ...prev, team: undefined }))
                      touched()
                    }}
                  />
                  <span className={`num ${styles.car}`}>{team.car_number}</span>
                  <span className={styles.teamName}>{teamName(team, lang)}</span>
                </label>
              ))}
            </div>
          )}
          {errors.team && (
            <p id="team-error" className={styles.fieldError} role="alert">
              {errors.team}
            </p>
          )}
        </fieldset>

        <TextField
          label={t('admin.qualifying.lapTime')}
          name="lap-time"
          inputMode="decimal"
          autoComplete="off"
          placeholder={t('admin.qualifying.lapPlaceholder')}
          className={styles.lapInput}
          value={status === 'dnf' ? '' : lapText}
          disabled={status === 'dnf'}
          onChange={(event) => {
            setLapText(event.target.value)
            setErrors((prev) => ({ ...prev, lap: undefined }))
            touched()
          }}
          onBlur={() => {
            if (!lapText.trim()) return
            const lap = checkLapInput(t, lapText, status)
            setErrors((prev) => ({ ...prev, lap: lap.error ?? undefined }))
          }}
          hint={
            status === 'dnf'
              ? t('admin.qualifying.dnfHint')
              : preview !== null
                ? t('admin.qualifying.lapPreview', { time: formatLap(preview) })
                : status === 'dsq'
                  ? t('admin.qualifying.dsqHint')
                  : t('admin.qualifying.lapHint')
          }
          error={errors.lap}
        />

        <Choices
          legend={t('admin.qualifying.status')}
          value={status}
          onChange={(next) => {
            setStatus(next)
            setErrors((prev) => ({ ...prev, lap: undefined }))
            touched()
          }}
          options={ENTRY_STATUSES.map((value) => ({
            value,
            label: t(`admin.lapStatus.${value}`),
          }))}
        />

        <div className={ui.actions}>
          <Button type="submit" variant="primary" block>
            {t('admin.qualifying.review')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming !== null}
        title={t('admin.qualifying.confirmTitle')}
        confirmLabel={save.isPending ? t('admin.common.saving') : t('admin.common.save')}
        cancelLabel={t('admin.common.cancel')}
        busy={save.isPending}
        onConfirm={() => confirming && save.mutate(confirming)}
        onCancel={() => {
          setConfirming(null)
          save.reset()
        }}
      >
        {confirming && selected && (
          <>
            <dl className={ui.facts}>
              <dt>{t('admin.qualifying.team')}</dt>
              <dd>{teamOption(t, selected, lang)}</dd>
              <dt>{t('admin.qualifying.status')}</dt>
              <dd>{t(`admin.lapStatus.${confirming.status}`)}</dd>
            </dl>
            <p className={`num ${styles.confirmTime}`}>
              {confirming.lap_time_ms != null
                ? formatLap(confirming.lap_time_ms)
                : t('admin.qualifying.noTime')}
            </p>
            <ErrorMessage error={save.error} />
          </>
        )}
      </ConfirmDialog>
    </>
  )
}
