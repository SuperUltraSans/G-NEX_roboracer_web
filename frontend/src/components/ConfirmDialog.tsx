import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import styles from './ConfirmDialog.module.css'

interface Props {
  open: boolean
  title: ReactNode
  children?: ReactNode
  confirmLabel: ReactNode
  cancelLabel: ReactNode
  danger?: boolean
  busy?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** 파괴적 동작(삭제, 무효, 결과 되돌리기)과 기록 저장 전 확인용 모달 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  confirmDisabled,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        // 저장 중에는 Esc 로 닫지 않는다 (취소 버튼도 막혀 있다)
        if (!busy) onCancel()
      }}
    >
      <form
        method="dialog"
        className={styles.body}
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm()
        }}
      >
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        {children && <div className={styles.content}>{children}</div>}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={danger ? 'danger' : 'primary'}
            disabled={busy || confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
