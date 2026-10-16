import { useTranslation } from 'react-i18next'
import type { PageKey } from '../../api/types'
import styles from './ClosedNotice.module.css'

/** 관리자가 닫은 공개 페이지 자리에 보이는 안내. 관리자가 쓴 문구가 없으면 페이지별 기본 문구 */
export function ClosedNotice({ page, note }: { page: PageKey; note: string | null }) {
  const { t } = useTranslation()
  return (
    <div className={styles.notice} role="status">
      <p className={styles.label}>{t('closed.label')}</p>
      <p className={styles.message}>{note ?? t(`closed.${page}`)}</p>
    </div>
  )
}
