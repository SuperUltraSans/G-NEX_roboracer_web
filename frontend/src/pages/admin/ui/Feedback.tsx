import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import styles from './admin.module.css'
import { errorMessage, type ErrorOverrides } from './errors'

type Tone = 'error' | 'info' | 'success'

/** 폼 위·아래에 띄우는 한 줄 알림. 오류는 role=alert, 나머지는 role=status. */
export function Message({
  tone = 'info',
  children,
  action,
}: {
  tone?: Tone
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={styles.message} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <p>{children}</p>
      {action && <div className={styles.messageActions}>{action}</div>}
    </div>
  )
}

export function ErrorMessage({ error, overrides }: { error: unknown; overrides?: ErrorOverrides }) {
  const { t } = useTranslation()
  if (!error) return null
  return <Message tone="error">{errorMessage(t, error, overrides)}</Message>
}

/** "저장" → 저장 중 → "저장됨". 같은 행동은 늘 같은 이름을 쓴다. */
export function SaveButton({
  pending,
  saved,
  label,
  savedLabel,
  disabled,
  block,
}: {
  pending: boolean
  saved: boolean
  label?: ReactNode
  savedLabel?: ReactNode
  disabled?: boolean
  block?: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      <Button type="submit" variant="primary" disabled={pending || disabled} block={block}>
        {pending
          ? t('admin.common.saving')
          : saved
            ? (savedLabel ?? t('admin.common.saved'))
            : (label ?? t('admin.common.save'))}
      </Button>
      <span className="visually-hidden" role="status">
        {saved ? (savedLabel ?? t('admin.common.saved')) : ''}
      </span>
    </>
  )
}

export type TagTone = 'default' | 'off' | 'live' | 'done' | 'danger'

export function Tag({ tone = 'default', children }: { tone?: TagTone; children: ReactNode }) {
  return (
    <span className={styles.tag} data-tone={tone}>
      {children}
    </span>
  )
}

/** 다른 사람이 같은 항목을 바꿨을 때: 지금 폼은 그대로 두고 최신 값을 불러올 수 있게 한다. */
export function StaleNotice({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation()
  return (
    <Message
      action={
        <Button variant="secondary" onClick={onReload}>
          {t('admin.common.loadLatest')}
        </Button>
      }
    >
      {t('admin.common.staleNotice')}
    </Message>
  )
}
