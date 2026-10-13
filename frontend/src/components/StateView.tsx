import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { Button } from './Button'
import styles from './StateView.module.css'

export function Loading() {
  const { t } = useTranslation()
  return (
    <p className={styles.loading} role="status">
      {t('common.loading')}
    </p>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  const network = error instanceof ApiError && error.status === 0
  return (
    <div className={styles.error} role="alert">
      <p>{network ? t('common.networkError') : t('common.loadError')}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
