import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { Bracket, BracketMatch, MatchResultSubmit } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { TextField } from '../../../components/Field'
import { useLang } from '../../../i18n'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage, Message, StaleNotice } from '../ui/Feedback'
import { isConflict } from '../ui/errors'
import { useAdminMutation } from '../ui/mutation'
import styles from './Bracket.module.css'
import { replaceMatch, resultLabel, slotTitle, sortedSlots, useReloadMatch } from './utils'

type Ranks = Record<number, number | null>
type Notes = Record<number, string>

/** 팀이 있는 칸만 순위를 매긴다. 빈 칸은 부전승(결과 없이 끝냄) */
function teamSlots(match: BracketMatch) {
  return match.slots.filter((slot) => slot.team)
}

function initRanks(match: BracketMatch): Ranks {
  const slots = teamSlots(match)
  // 혼자 남은 팀은 고를 것 없이 1위
  if (slots.length === 1) return { [slots[0].id]: 1 }
  return Object.fromEntries(slots.map((slot) => [slot.id, slot.result_rank]))
}

function initNotes(match: BracketMatch): Notes {
  return Object.fromEntries(teamSlots(match).map((slot) => [slot.id, slot.result_text ?? '']))
}

/**
 * 순위를 고르면 그 순위를 갖고 있던 슬롯과 맞바꾼다. 남은 슬롯과 남은 순위가 하나씩이면 자동으로 채운다.
 * 2대 매치에서는 승자 하나만 고르면 끝난다.
 */
function assignRank(ranks: Ranks, slotId: number, rank: number, total: number): Ranks {
  const next: Ranks = { ...ranks }
  const previous = next[slotId] ?? null
  for (const id of Object.keys(next).map(Number)) {
    if (id !== slotId && next[id] === rank) next[id] = previous
  }
  next[slotId] = rank
  const ids = Object.keys(next).map(Number)
  const unranked = ids.filter((id) => next[id] == null)
  const used = new Set(ids.map((id) => next[id]))
  const unused = Array.from({ length: total }, (_, i) => i + 1).filter((r) => !used.has(r))
  if (unranked.length === 1 && unused.length === 1) next[unranked[0]] = unused[0]
  return next
}

/** 매치 결과 입력: 슬롯마다 순위와 메모 → 확인 → 종료 처리 (심판도 쓴다) */
export function ResultForm({
  match,
  hasDownstream,
  onDone,
}: {
  match: BracketMatch
  /** 이 매치의 결과를 받는 슬롯이 있는지 (종료 뒤 안내 문구용) */
  hasDownstream: boolean
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const reloadMatch = useReloadMatch()
  const [base, setBase] = useState(match)
  const [ranks, setRanks] = useState<Ranks>(() => initRanks(match))
  const [notes, setNotes] = useState<Notes>(() => initNotes(match))
  const [missing, setMissing] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const slots = sortedSlots(base).filter((slot) => slot.team)
  const byes = base.slots.length - slots.length
  const total = slots.length

  const load = (latest: BracketMatch) => {
    setBase(latest)
    setRanks(initRanks(latest))
    setNotes(initNotes(latest))
  }

  const finish = useAdminMutation({
    mutationFn: (body: MatchResultSubmit) =>
      api.post<BracketMatch>(`/api/admin/matches/${base.id}/result`, body),
    onSuccess: (updated) => {
      setConfirming(false)
      queryClient.setQueryData<Bracket>(queryKeys.bracket, (old) =>
        old ? replaceMatch(old, updated) : old,
      )
      // 후속 매치 슬롯도 바뀌었으므로 대진 전체를 다시 받는다 (WebSocket 이 끊겨 있어도 맞도록)
      void queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
      onDone(
        t(hasDownstream ? 'admin.bracket.finishedNotice' : 'admin.bracket.finishedFinal', {
          label: updated.label,
        }),
      )
    },
    onError: async (error) => {
      setConfirming(false)
      if (!isConflict(error)) return
      const latest = await reloadMatch(base.id)
      if (latest) load(latest)
      setConflict(true)
    },
  })

  if (slots.length === 0) {
    return (
      <div className={ui.editor}>
        <Message>{t('admin.bracket.teamsMissing')}</Message>
        <div className={ui.actions}>
          <Button variant="secondary" onClick={() => onDone(null)}>
            {t('admin.common.close')}
          </Button>
        </div>
      </div>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const complete = slots.every((slot) => ranks[slot.id] != null)
    setMissing(!complete)
    if (complete) setConfirming(true)
  }

  const ordered = [...slots].sort((a, b) => (ranks[a.id] ?? 0) - (ranks[b.id] ?? 0))

  return (
    <>
      <form className={ui.editor} onSubmit={submit} noValidate>
        {match.version > base.version && !finish.isPending && !conflict && (
          <StaleNotice onReload={() => load(match)} />
        )}
        {conflict && <Message tone="error">{t('admin.error.versionConflict')}</Message>}
        {byes > 0 && <Message>{t('admin.bracket.byeNotice', { count: byes })}</Message>}
        {slots.map((slot) => (
          <fieldset key={slot.id} className={styles.resultSlot}>
            <legend className={styles.resultTeam}>{slotTitle(t, slot, lang)}</legend>
            <Choices
              legend={t(base.slots.length === 2 ? 'admin.bracket.outcome' : 'admin.bracket.rank')}
              value={ranks[slot.id] != null ? String(ranks[slot.id]) : ''}
              onChange={(value) => {
                setRanks((prev) => assignRank(prev, slot.id, Number(value), total))
                setMissing(false)
                setConflict(false)
              }}
              options={Array.from({ length: total }, (_, i) => ({
                value: String(i + 1),
                label: resultLabel(t, i + 1, base.slots.length),
              }))}
            />
            <TextField
              label={t('admin.bracket.resultNote')}
              placeholder={t('admin.bracket.resultNotePlaceholder')}
              maxLength={200}
              value={notes[slot.id] ?? ''}
              onChange={(event) => {
                const value = event.target.value
                setNotes((prev) => ({ ...prev, [slot.id]: value }))
                setConflict(false)
              }}
            />
          </fieldset>
        ))}
        {missing && <Message tone="error">{t('admin.bracket.rankMissing')}</Message>}
        <ErrorMessage error={isConflict(finish.error) ? null : finish.error} />
        <div className={ui.actions}>
          <Button type="submit" variant="primary">
            {t('admin.bracket.finish')}
          </Button>
          <Button variant="secondary" onClick={() => onDone(null)}>
            {t('admin.common.cancel')}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        title={t('admin.bracket.finishTitle', { label: base.label })}
        confirmLabel={finish.isPending ? t('admin.common.saving') : t('admin.bracket.finish')}
        cancelLabel={t('admin.common.cancel')}
        busy={finish.isPending}
        onConfirm={() =>
          finish.mutate({
            version: base.version,
            results: slots.map((slot) => ({
              slot_id: slot.id,
              result_rank: ranks[slot.id] as number,
              result_text: notes[slot.id]?.trim() || null,
            })),
          })
        }
        onCancel={() => setConfirming(false)}
      >
        <ol className={styles.confirmList}>
          {ordered.map((slot) => (
            <li key={slot.id}>
              <span className="num">
                {resultLabel(t, ranks[slot.id] as number, base.slots.length)}
              </span>{' '}
              {slotTitle(t, slot, lang)}
              {notes[slot.id]?.trim() && <span className={ui.meta}> {notes[slot.id].trim()}</span>}
            </li>
          ))}
        </ol>
        {byes > 0 && <p className={ui.meta}>{t('admin.bracket.byeConfirm', { count: byes })}</p>}
        <p className={ui.meta}>{t('admin.bracket.finishBody')}</p>
      </ConfirmDialog>
    </>
  )
}
