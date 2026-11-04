import { useTranslation } from 'react-i18next'
import { REAL_SITE_URL, TEST_SITE } from './testSite'
import styles from './TestSiteBanner.module.css'

/** 테스트 사이트의 모든 화면 맨 위 띠. 여기 기록이 실제 대회 기록으로 오해되지 않게 한다. */
export function TestSiteBanner() {
  const { t } = useTranslation()
  if (!TEST_SITE) return null
  return (
    <p className={styles.banner} role="note">
      <strong>{t('testSite.label')}</strong> · {t('testSite.body')}
      {REAL_SITE_URL && (
        <>
          {' '}
          <a href={REAL_SITE_URL}>{t('testSite.real')}</a>
        </>
      )}
    </p>
  )
}
