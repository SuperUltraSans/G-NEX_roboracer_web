import { useTranslation } from 'react-i18next'
import type { LeaderboardRow, Mission } from '../../../api/types'
import { formatLap } from '../../../lib/laptime'
import styles from './Qualifying.module.css'

const PASS_LAPS = 3

/** 고른 팀의 예선 진행: Q1·Q2 연속 유효 랩, Q3 최고 기록, FA, 지금 순위 */
export function MissionStatus({ row }: { row: LeaderboardRow | undefined }) {
  const { t } = useTranslation()
  if (!row) return null

  const value = (mission: Mission, index: number): string => {
    const passed = row.missions_passed > index
    if (mission === 'Q3') {
      if (row.q3_best_ms !== null) return formatLap(row.q3_best_ms)
      return row.current_mission === 'Q3' && row.attempts > 0
        ? t('admin.qualifying.progress.noValid')
        : t('admin.qualifying.progress.waiting')
    }
    if (passed) return t('admin.qualifying.progress.passed')
    if (row.current_mission === mission) {
      return t('admin.qualifying.progress.streak', { count: row.current_streak })
    }
    return t('admin.qualifying.progress.waiting')
  }

  const faState = row.fa ? 'yes' : row.fa_lost ? 'lost' : 'open'

  return (
    <section className={styles.status} aria-label={t('admin.qualifying.progress.title')}>
      <dl className={styles.missions}>
        {(['Q1', 'Q2', 'Q3'] as const).map((mission, index) => {
          const state =
            row.missions_passed > index
              ? 'passed'
              : row.current_mission === mission
                ? 'active'
                : 'waiting'
          return (
            <div key={mission} className={styles.mission} data-state={state}>
              <dt>{mission}</dt>
              <dd className="num">{value(mission, index)}</dd>
              {state === 'active' && mission !== 'Q3' && (
                <dd className={styles.dots} aria-hidden="true">
                  {Array.from({ length: PASS_LAPS }, (_, i) => (
                    <span key={i} data-on={i < row.current_streak ? '' : undefined} />
                  ))}
                </dd>
              )}
            </div>
          )
        })}
      </dl>
      <p className={styles.statusLine}>
        <span data-fa={faState}>{t(`admin.qualifying.progress.fa.${faState}`)}</span>
        <span>
          {row.rank !== null
            ? t('admin.qualifying.progress.rank', { rank: row.rank })
            : t('admin.qualifying.progress.noRank')}
        </span>
        {row.rank_drops > 0 && (
          <span>{t('admin.qualifying.progress.drops', { count: row.rank_drops })}</span>
        )}
      </p>
    </section>
  )
}
