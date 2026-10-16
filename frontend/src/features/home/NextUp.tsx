import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useEventTimezone, usePageState, useSchedule } from '../content/hooks'
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
  // 일정 페이지를 닫았으면 첫 화면의 다음 일정도 숨긴다
  const page = usePageState('schedule')
  const { data } = useSchedule(page.status === 'open')
  const item = page.status === 'open' && data ? currentOrNext(data, now) : null
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

// 포스터 아래쪽 순서. 로고는 public/sponsors/ (교육부·한국연구재단·경상남도·경남앵커센터는 기관 공식 파일,
// 인제대학교 앵커사업단은 공개된 파일이 없어 포스터에서 따 왔다. doc/DECISIONS.md 참고)
const SPONSORS = [
  { key: 'moe', logo: 'moe.svg' },
  { key: 'nrf', logo: 'nrf.svg' },
  { key: 'gyeongnam', logo: 'gyeongnam.svg' },
  { key: 'gnAnchor', logo: 'gn-anchor.png' },
  { key: 'injeAnchor', logo: 'inje-anchor.png' },
] as const

const logoBase = `${import.meta.env.BASE_URL}sponsors/`

/** 주최·후원 기관 로고. 로고에 기관 이름이 들어 있으므로 제목과 이름 글자는 보이지 않게 두고 화면 읽기 프로그램에만 알린다 */
export function Sponsors() {
  const { t } = useTranslation()
  return (
    <section className={styles.section} aria-labelledby="sponsors-title">
      <h2 id="sponsors-title" className="visually-hidden">
        {t('home.sponsorsTitle')}
      </h2>
      <ul className={styles.sponsors}>
        {SPONSORS.map(({ key, logo }) => (
          <li key={key}>
            <img
              src={logoBase + logo}
              alt={t(`home.sponsors.${key}`)}
              className={styles.sponsorLogo}
              loading="lazy"
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
