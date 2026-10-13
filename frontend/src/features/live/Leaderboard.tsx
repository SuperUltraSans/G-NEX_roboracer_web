import { useTranslation } from 'react-i18next'
import type { Leaderboard as LeaderboardData } from '../../api/types'
import { useLang } from '../../i18n'
import { formatGap, formatLap } from '../../lib/laptime'
import { pickLocalized } from '../../lib/localized'
import { useHighlights } from './highlights'
import { teamName } from './labels'
import styles from './Leaderboard.module.css'

export function Leaderboard({ data }: { data: LeaderboardData }) {
  const { t } = useTranslation()
  const lang = useLang()
  const { teams: updated, lastTeamId } = useHighlights()
  const none = t('common.none')
  const announced = data.rows.find((row) => row.team.id === lastTeamId && row.best_lap_ms !== null)

  return (
    <>
      {/* 리더보드 갱신 알림 (doc/Instruction.md 5.3) */}
      <p className="visually-hidden" aria-live="polite">
        {announced &&
          t('live.leaderboard.announce', {
            team: teamName(announced.team, lang),
            time: formatLap(announced.best_lap_ms ?? 0),
            rank: announced.rank,
          })}
      </p>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <caption className="visually-hidden">{t('live.leaderboard.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.rank}>
                {t('live.leaderboard.rank')}
              </th>
              <th scope="col" className={styles.car}>
                {t('live.leaderboard.car')}
              </th>
              <th scope="col">{t('live.leaderboard.team')}</th>
              <th scope="col" className={styles.affiliation}>
                {t('live.leaderboard.affiliation')}
              </th>
              <th scope="col" className={styles.time}>
                {t('live.leaderboard.best')}
              </th>
              <th scope="col" className={styles.time}>
                {t('live.leaderboard.gap')}
              </th>
              <th scope="col" className={styles.attempts}>
                {t('live.leaderboard.attempts')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const affiliation = pickLocalized(row.team, 'affiliation', lang)
              return (
                <tr
                  key={row.team.id}
                  data-leader={row.rank === 1 ? '' : undefined}
                  data-updated={updated.has(row.team.id) ? '' : undefined}
                  data-empty={row.rank === null ? '' : undefined}
                >
                  <td className={`record ${styles.rank}`}>{row.rank ?? none}</td>
                  <td className={`record ${styles.car}`}>{row.team.car_number}</td>
                  <td className={styles.team}>
                    <span className={`record ${styles.teamCar}`}>{row.team.car_number}</span>
                    {teamName(row.team, lang)}
                    {affiliation && <span className={styles.teamAffiliation}>{affiliation}</span>}
                  </td>
                  <td className={styles.affiliation}>{affiliation ?? none}</td>
                  <td className={`record ${styles.time} ${styles.best}`}>
                    {row.best_lap_ms === null ? none : formatLap(row.best_lap_ms)}
                  </td>
                  <td className={`record ${styles.time}`}>
                    {row.gap_ms ? formatGap(row.gap_ms) : none}
                  </td>
                  <td className={`record ${styles.attempts}`}>{row.attempts}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
