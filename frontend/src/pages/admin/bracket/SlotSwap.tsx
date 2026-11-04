import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { Bracket, BracketSlot, BracketSlotSwap } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useLang } from '../../../i18n'
import ui from '../ui/admin.module.css'
import { isConflict } from '../ui/errors'
import { ErrorMessage, Message } from '../ui/Feedback'
import { useAdminMutation } from '../ui/mutation'
import styles from './Bracket.module.css'
import { SlotSwapContext, type Moving, type SlotSwap } from './slotSwapState'
import { findSlot, slotSource, slotTitle, swapPreview } from './utils'

/**
 * 관리자 화면 대진 구성: 칸을 끌어 다른 칸에 놓으면 두 칸의 자리를 바꾼다.
 * 끌기 어려우면 칸의 옮기기 버튼을 누른 뒤 바꿀 칸의 '여기와 바꾸기'를 누른다.
 */
export function SlotSwapProvider({ bracket, children }: { bracket: Bracket; children: ReactNode }) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const [moving, setMoving] = useState<Moving | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [pending, setPending] = useState<{ slotId: number; targetId: number } | null>(null)
  const [swapped, setSwapped] = useState<number[]>([])
  // 방금 바꾼 매치 라벨 (알림은 그릴 때 번역해 언어를 바꿔도 따라간다)
  const [notice, setNotice] = useState<string[] | null>(null)

  const describe = (slotId: number) => {
    const found = findSlot(bracket, slotId)
    return found ? `${found.match.label} · ${slotTitle(t, found.slot, lang, bracket)}` : ''
  }

  const swap = useAdminMutation({
    mutationFn: (body: BracketSlotSwap) => api.post<Bracket>('/api/admin/bracket/slots/swap', body),
    onSuccess: (next, body) => {
      const labels = swapPreview(bracket, body.slot_id, body.target_slot_id).map(
        ({ match }) => match.label,
      )
      queryClient.setQueryData(queryKeys.bracket, next)
      setPending(null)
      setSwapped([body.slot_id, body.target_slot_id])
      setNotice(labels)
    },
    onError: (error) => {
      // 그사이 대진이 바뀌었으면 최신 대진으로 미리보기를 다시 그린다 (확인 창은 그대로)
      if (isConflict(error)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.bracket, exact: true })
      }
    },
  })

  const value: SlotSwap = {
    moving,
    over,
    swapped,
    start: (slotId, by) => {
      setMoving({ slotId, by })
      setOver(null)
      setSwapped([])
      setNotice(null)
    },
    hover: setOver,
    cancel: () => {
      setMoving(null)
      setOver(null)
    },
    drop: (targetId) => {
      if (moving && moving.slotId !== targetId) {
        swap.reset()
        setPending({ slotId: moving.slotId, targetId })
      }
      setMoving(null)
      setOver(null)
    },
  }

  // 옮기기 버튼으로 골라 둔 것은 Esc 로 취소한다
  useEffect(() => {
    if (moving?.by !== 'pick') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoving(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moving])

  const changes = pending ? swapPreview(bracket, pending.slotId, pending.targetId) : []
  const finished = changes.some(({ match }) => match.status === 'finished')
  const confirm = () => {
    const from = pending && findSlot(bracket, pending.slotId)
    const to = pending && findSlot(bracket, pending.targetId)
    if (!from || !to) return
    swap.mutate({
      slot_id: from.slot.id,
      target_slot_id: to.slot.id,
      version: from.match.version,
      target_version: to.match.version,
    })
  }
  const close = () => {
    setPending(null)
    swap.reset()
  }

  const name = (slot: BracketSlot) => {
    const title = slotTitle(t, slot, lang, bracket)
    const source = slot.team ? slotSource(t, slot, bracket) : null
    return source ? `${title} (${source})` : title
  }

  return (
    <SlotSwapContext.Provider value={value}>
      <div className={styles.swapBar}>
        {moving?.by === 'pick' ? (
          <Message
            action={
              <Button variant="secondary" className={ui.compact} onClick={value.cancel}>
                {t('admin.common.cancel')}
              </Button>
            }
          >
            {t('admin.bracket.swapPicking', { slot: describe(moving.slotId) })}
          </Message>
        ) : notice ? (
          <Message tone="success">
            {notice.length === 1
              ? t('admin.bracket.swappedSame', { label: notice[0] })
              : t('admin.bracket.swapped', { a: notice[0], b: notice[1] })}
          </Message>
        ) : (
          <p className={ui.meta}>{t('admin.bracket.swapHint')}</p>
        )}
      </div>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={t('admin.bracket.swapTitle')}
        confirmLabel={swap.isPending ? t('admin.common.saving') : t('admin.bracket.swapConfirm')}
        cancelLabel={t('admin.common.cancel')}
        busy={swap.isPending}
        confirmDisabled={changes.length === 0 || finished}
        onConfirm={confirm}
        onCancel={close}
      >
        <p>{t('admin.bracket.swapBody')}</p>
        <div className={styles.swapPreview}>
          {changes.map(({ match, before, after, changed }) => (
            <section key={match.id} className={styles.swapMatch}>
              <h3 className={styles.swapLabel}>{match.label}</h3>
              <ol className={styles.swapRows}>
                {after.map((slot, index) => (
                  <li
                    key={slot.id}
                    className={changed.includes(slot.id) ? styles.swapChanged : undefined}
                  >
                    {changed.includes(slot.id) ? (
                      <>
                        <span className={ui.meta}>{name(before[index])}</span>
                        <strong>→ {name(slot)}</strong>
                      </>
                    ) : (
                      name(slot)
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        {finished && <Message tone="error">{t('admin.error.matchFinished')}</Message>}
        <ErrorMessage
          error={swap.error}
          overrides={{ VERSION_CONFLICT: t('admin.bracket.swapConflict') }}
        />
      </ConfirmDialog>
    </SlotSwapContext.Provider>
  )
}
