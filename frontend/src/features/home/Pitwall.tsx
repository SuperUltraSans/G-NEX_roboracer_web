import { useTranslation } from 'react-i18next'
import { keepTogether } from '../../lib/keepTogether'
import { HeroActions } from './HeroActions'
import { HeroFrame } from './HeroFrame'
import styles from './Pitwall.module.css'
import { useIntroOnce } from './useHeroMotion'

// 대회명 안에서 줄이 바뀌면 안 되는 구절 (긴 것부터)
const NO_BREAK = ['G-NEX CHAMPIONSHIP', '글로벌 혁신 페스타', 'G-NEX']

/** 피트월: 타이밍 타워처럼 행을 쌓고, 일시가 가장 크다 */
export function PitwallHero() {
  const { t } = useTranslation()
  const play = useIntroOnce()
  return (
    <HeroFrame>
      <div className={styles.tower} data-intro={play ? '' : undefined}>
        <h1 id="hero-title" className={`display ${styles.title}`}>
          {keepTogether(t('home.title'), NO_BREAK, styles.nowrap)}
        </h1>
        <dl className={styles.rows}>
          <div className={`${styles.row} ${styles.dateRow}`}>
            <dt>{t('home.dateLabel')}</dt>
            <dd className={`display ${styles.date}`}>{t('home.date')}</dd>
          </div>
          <div className={styles.row}>
            <dt>{t('home.venueLabel')}</dt>
            <dd>{t('home.venue')}</dd>
          </div>
          <div className={styles.row}>
            <dt>{t('home.hostLabel')}</dt>
            <dd>{t('home.host')}</dd>
          </div>
        </dl>
        <HeroActions className={styles.actions} />
        {play && <span className={styles.sweep} aria-hidden="true" />}
      </div>
    </HeroFrame>
  )
}

export function PitwallIntro() {
  const { t } = useTranslation()
  return (
    <section id="intro" tabIndex={-1} className={styles.intro} aria-labelledby="intro-title">
      <div className={styles.introInner}>
        <h2 id="intro-title" className={`display ${styles.introTitle}`}>
          {t('home.introTitle')}
        </h2>
        <p className={styles.introBody}>{t('home.introBody')}</p>
        <h3 className={styles.formatTitle}>{t('home.formatTitle')}</h3>
        <ol className={styles.band}>
          <li>
            <span className={styles.stageName}>{t('home.qualifyingName')}</span>
            <span className={styles.stageKind}>{t('home.qualifyingKind')}</span>
            <span className={styles.stageBody}>{t('home.qualifyingBody')}</span>
          </li>
          <li>
            <span className={styles.stageName}>{t('home.bracketName')}</span>
            <span className={styles.stageKind}>{t('home.bracketKind')}</span>
            <span className={styles.stageBody}>{t('home.bracketBody')}</span>
          </li>
        </ol>
      </div>
    </section>
  )
}
