import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { InspectionEntry, InspectionOrderUpdate } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ErrorState, Loading } from '../../../components/StateView'
import { useLang } from '../../../i18n'
import { Card } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { ErrorMessage, Message } from '../ui/Feedback'
import { teamOption } from '../ui/format'
import { useAdminMutation } from '../ui/mutation'
import { MAX_ACTIVE_TEAMS } from '../teams/TeamsPage'
import { parseInspectionOrders } from './labels'
import styles from './Qualifying.module.css'

/**
 * 차량 검사를 마친 순서를 관리자가 직접 적는다. 공개 예선 리더보드의 팀 옆에 보이고,
 * 예선 순위가 같으면 앞 번호 팀이 앞선다 (규칙 4.7). 비우면 지운다.
 */
export function InspectionOrder() {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const inspection = useQuery({
    queryKey: queryKeys.inspection,
    queryFn: () => api.get<InspectionEntry[]>('/api/admin/qualifying/inspection'),
  })
  // 고친 칸만 담는다 (팀 id → 적은 글자). 저장하면 비운다
  const [draft, setDraft] = useState<Record<number, string>>({})
  const [saved, setSaved] = useState(false)

  const save = useAdminMutation({
    mutationFn: (body: InspectionOrderUpdate) =>
      api.put<InspectionEntry[]>('/api/admin/qualifying/inspection-order', body),
    onSuccess: (entries) => {
      queryClient.setQueryData(queryKeys.inspection, entries)
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      setDraft({})
      setSaved(true)
    },
  })

  // 저장된 순서대로 둔다 (적는 동안에는 줄이 움직이지 않는다)
  const entries = [...(inspection.data ?? [])].sort(
    (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.team.id - b.team.id,
  )
  const text = (entry: InspectionEntry) =>
    draft[entry.team.id] ?? (entry.inspection_order === null ? '' : String(entry.inspection_order))
  const check = parseInspectionOrders(
    entries.map((entry) => [entry.team.id, text(entry)]),
    MAX_ACTIVE_TEAMS,
  )
  const dirty = entries.some(
    (entry) =>
      entry.team.id in draft && text(entry).trim() !== String(entry.inspection_order ?? ''),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (check.bad.size > 0 || check.taken.size > 0) return
    save.mutate({
      items: entries.map((entry) => ({
        team_id: entry.team.id,
        order: check.orders.get(entry.team.id) ?? null,
      })),
    })
  }

  return (
    <Card
      title={t('admin.qualifying.inspection.title')}
      description={t('admin.qualifying.inspection.description')}
    >
      {inspection.isPending && <Loading />}
      {inspection.isError && (
        <ErrorState error={inspection.error} onRetry={() => inspection.refetch()} />
      )}
      {inspection.data && (
        <form onSubmit={submit} noValidate>
          <ol className={styles.inspection}>
            {entries.map((entry) => {
              const id = `inspection-order-${entry.team.id}`
              const team = teamOption(t, entry.team, lang)
              const invalid = check.bad.has(entry.team.id) || check.taken.has(entry.team.id)
              return (
                <li key={entry.team.id} className={styles.inspectionRow}>
                  <input
                    id={id}
                    className={styles.inspectionInput}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={text(entry)}
                    aria-label={t('admin.qualifying.inspection.inputLabel', { team })}
                    aria-invalid={invalid || undefined}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, [entry.team.id]: event.target.value }))
                      setSaved(false)
                      save.reset()
                    }}
                  />
                  <label htmlFor={id} className={styles.inspectionTeam}>
                    {team}
                  </label>
                </li>
              )
            })}
          </ol>
          {check.bad.size > 0 && (
            <Message tone="error">
              {t('admin.qualifying.inspection.bad', { max: MAX_ACTIVE_TEAMS })}
            </Message>
          )}
          {check.taken.size > 0 && (
            <Message tone="error">
              {t('admin.qualifying.inspection.taken', { numbers: check.takenNumbers.join(', ') })}
            </Message>
          )}
          <ErrorMessage error={save.error} />
          {saved && !dirty && <Message>{t('admin.qualifying.inspection.saved')}</Message>}
          <div className={ui.actions}>
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty || save.isPending || check.bad.size > 0 || check.taken.size > 0}
            >
              {save.isPending ? t('admin.common.saving') : t('admin.qualifying.inspection.save')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
