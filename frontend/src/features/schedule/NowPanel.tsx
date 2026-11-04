// 일정 맨 위: 전자시계(시:분:초)와 그 옆에 오늘 날짜·지금 진행 중인 일정, 그 아래 한 줄로 다음 일정.
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { ScheduleItemPublic } from '../../api/types'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import { dateKey, formatClock, formatDate, formatEndTime, formatTime } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import styles from './NowPanel.module.css'
import { SevenSegment } from './SevenSegment'
import { currentAndNext, itemAnchor } from './timeline'

const MINUTE = 60_000

/** 다음 일정까지 남은 시간 (분 단위로 올림) */
function untilText(t: TFunction, ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE))
  if (minutes < 60) return t('schedule.in.minutes', { count: minutes })
  if (minutes < 24 * 60) {
    return t('schedule.in.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }
  return t('schedule.in.days', { count: Math.floor(minutes / (24 * 60)) })
}

function timeRange(item: ScheduleItemPublic, timezone: string): string {
  const start = formatTime(item.starts_at, timezone)
  return item.ends_at ? `${start}–${formatEndTime(item.starts_at, item.ends_at, timezone)}` : start
}

export function NowPanel({ items, timezone }: { items: ScheduleItemPublic[]; timezone: string }) {
  const { t } = useTranslation()
  const lang = useLang()
  // 초까지 보이므로 이 상자만 1초마다 다시 그린다
  const now = useNow(1_000)
  const nowIso = new Date(now).toISOString()
  const clock = formatClock(nowIso, timezone)
  const { current, next } = currentAndNext(items, now)
  const today = dateKey(nowIso, timezone)

  return (
    <section className={styles.panel} aria-label={t('schedule.nowPanel')}>
      <div className={styles.clock}>
        <p className={styles.time}>
          <SevenSegment text={clock} />
          <time className="visually-hidden" dateTime={nowIso}>
            {t('schedule.currentTime')} {clock}
          </time>
        </p>
      </div>

      <div className={styles.schedule}>
        {/* 날짜는 전자시계와 섞지 않고 일정 쪽 첫 줄에 일반 글씨로 */}
        <p className={styles.date}>
          {formatDate(nowIso, timezone, lang)}
          {current && <span className={styles.flag}> · {t('schedule.nowRunning')}</span>}
        </p>
        {current ? (
          <a href={`#${itemAnchor(current.id)}`} className={styles.current}>
            <span className={`num ${styles.currentTime}`}>{timeRange(current, timezone)}</span>
            <span className={styles.currentTitle}>{pickLocalized(current, 'title', lang)}</span>
            {pickLocalized(current, 'location', lang) && (
              <span className={styles.location}>{pickLocalized(current, 'location', lang)}</span>
            )}
          </a>
        ) : (
          <p className={styles.idle}>{next ? t('schedule.noneRunning') : t('schedule.allDone')}</p>
        )}

        {/* 다음 일정은 작게 한 줄로 (넘치면 말줄임) */}
        {next && (
          <a href={`#${itemAnchor(next.id)}`} className={styles.next}>
            <span className={styles.nextLabel}>{t('schedule.upNext')}</span>{' '}
            <span className="num">
              {dateKey(next.starts_at, timezone) !== today &&
                `${formatDate(next.starts_at, timezone, lang)} `}
              {timeRange(next, timezone)}
            </span>{' '}
            <span className={styles.nextTitle}>{pickLocalized(next, 'title', lang)}</span>
            <span className={styles.until}>
              {' '}
              · {untilText(t, Date.parse(next.starts_at) - now)}
            </span>
          </a>
        )}
      </div>
    </section>
  )
}
