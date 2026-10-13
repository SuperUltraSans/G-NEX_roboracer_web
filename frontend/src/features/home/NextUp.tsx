import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useEventTimezone, useSchedule } from '../content/hooks'
import { pickLocalized } from '../../lib/localized'
import { formatDate, formatTime } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import { useLang } from '../../i18n'
import { currentOrNext } from '../schedule/timeline'
import styles from './HomeSections.module.css'

/** 다음 일정 1건 (doc/Instruction.md 5.3, P2) */
export function NextUp() {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const now = useNow()
  const { data } = useSchedule()
  const item = data ? currentOrNext(data, now) : null
  if (!item) return null

  const location = pickLocalized(item, 'location', lang)
  return (
    <section className={styles.section} aria-labelledby="next-title">
      <h2 id="next-title" className={styles.sectionTitle}>
        {t('home.nextTitle')}
      </h2>
      <div className={styles.next}>
        <p className={`num ${styles.nextWhen}`}>
          <span>{formatDate(item.starts_at, timezone, lang)}</span>{' '}
          <span>{formatTime(item.starts_at, timezone)}</span>
        </p>
        <p className={styles.nextTitle}>{pickLocalized(item, 'title', lang)}</p>
        {location && <p className={styles.nextWhere}>{location}</p>}
        <Link to="/schedule" className={styles.nextLink}>
          {t('home.nextAll')}
        </Link>
      </div>
    </section>
  )
}

const SPONSOR_SLOTS = [1, 2, 3, 4, 5, 6]

/** 주최·후원 로고 자리. 로고가 정해지면 이미지로 바꾼다 */
export function Sponsors() {
  const { t } = useTranslation()
  return (
    <section className={styles.section} aria-labelledby="sponsors-title">
      <h2 id="sponsors-title" className={styles.sectionTitle}>
        {t('home.sponsorsTitle')}
      </h2>
      <ul className={styles.sponsors}>
        {SPONSOR_SLOTS.map((n) => (
          <li key={n}>{t('home.sponsor', { n })}</li>
        ))}
      </ul>
    </section>
  )
}
