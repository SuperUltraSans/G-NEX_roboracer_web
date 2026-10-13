import { useTranslation } from 'react-i18next'
import { USE_MOCK } from '../api/client'
import styles from './MockBadge.module.css'

export function MockBadge() {
  const { t } = useTranslation()
  if (!USE_MOCK) return null
  return (
    <p className={styles.badge} data-surface="dark" title={t('mock.description')}>
      {t('mock.badge')}
      <span className="visually-hidden">{t('mock.description')}</span>
    </p>
  )
}
