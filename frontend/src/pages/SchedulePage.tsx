import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Page } from '../components/Page'
import { EmptyState, ErrorState, Loading } from '../components/StateView'
import { useEventTimezone, useSchedule } from '../features/content/hooks'
import { groupByDate, timelineStates } from '../features/schedule/timeline'
import { useLang } from '../i18n'
import { pickLocalized } from '../lib/localized'
import { formatDate, formatTime } from '../lib/time'
import { useNow } from '../lib/useNow'
import styles from './SchedulePage.module.css'

export function SchedulePage() {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const now = useNow()
  const schedule = useSchedule()
  useDocumentTitle(t('schedule.title'))

  const items = schedule.data ?? []
  const states = timelineStates(items, now)

  return (
    <Page title={t('schedule.title')} lead={t('schedule.lead', { timezone })}>
      {schedule.isPending && <Loading />}
      {schedule.isError && <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />}
      {schedule.isSuccess && items.length === 0 && <EmptyState>{t('schedule.empty')}</EmptyState>}
      <div className={styles.timeline}>
        {groupByDate(items, timezone).map((group) => (
          <section key={group.key} className={styles.day} aria-labelledby={`day-${group.key}`}>
            <h2 id={`day-${group.key}`} className={styles.dayTitle}>
              {formatDate(group.items[0].starts_at, timezone, lang)}
            </h2>
            <ol className={styles.items}>
              {group.items.map((item) => {
                const state = states.get(item.id)
                const start = formatTime(item.starts_at, timezone)
                const location = pickLocalized(item, 'location', lang)
                const description = pickLocalized(item, 'description', lang)
                return (
                  <li key={item.id} className={styles.item} data-state={state}>
                    <p className={`num ${styles.time}`}>
                      {item.ends_at
                        ? t('schedule.until', { start, end: formatTime(item.ends_at, timezone) })
                        : start}
                    </p>
                    <div className={styles.body}>
                      {(state === 'now' || state === 'next') && (
                        <p className={styles.flag}>
                          {state === 'now' ? t('schedule.now') : t('schedule.next')}
                        </p>
                      )}
                      <h3 className={styles.title}>{pickLocalized(item, 'title', lang)}</h3>
                      {location && <p className={styles.location}>{location}</p>}
                      {description && <p className={styles.description}>{description}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </Page>
  )
}
