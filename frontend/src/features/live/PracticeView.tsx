import { useTranslation } from 'react-i18next'
import type { LiveState } from '../../api/types'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import { formatTime } from '../../lib/time'
import { useEventTimezone } from '../content/hooks'
import { teamName } from './labels'
import styles from './PracticeView.module.css'

/** 공개 모니터링 '연습' 탭: 그룹 연습 A·B·C조의 연습 시간, 편성과 빈자리 */
export function PracticeView({ state }: { state: LiveState }) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const groups = state.practice ?? []

  return (
    <div className={styles.wrap}>
      <p className={styles.lead}>{t('live.practice.lead')}</p>
      <div className={styles.groups}>
        {groups.map((group) => (
          <section
            key={group.name}
            className={styles.group}
            aria-labelledby={`practice-${group.name}`}
          >
            <h3 id={`practice-${group.name}`} className={styles.name}>
              <span>
                {t('live.practice.group', { name: group.name })}
                <span className={`num ${styles.time}`}>
                  {t('live.practice.time', {
                    start: formatTime(group.starts_at, timezone),
                    end: formatTime(group.ends_at, timezone),
                  })}
                </span>
              </span>
              <span className={`num ${styles.seats}`}>
                {t('live.practice.seats', {
                  count: group.teams.length,
                  capacity: group.capacity,
                })}
              </span>
            </h3>
            <ol className={styles.members}>
              {group.teams.map((member) => (
                <li key={member.team.id} className={styles.member}>
                  <span className={styles.team}>{teamName(member.team, lang)}</span>
                  {pickLocalized(member.team, 'affiliation', lang) && (
                    <span className={styles.affiliation}>
                      {pickLocalized(member.team, 'affiliation', lang)}
                    </span>
                  )}
                </li>
              ))}
              {Array.from({ length: Math.max(0, group.capacity - group.teams.length) }, (_, i) => (
                <li key={`open-${i}`} className={styles.member} data-open="">
                  {t('live.practice.empty')}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
