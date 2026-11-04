import { useTranslation } from 'react-i18next'
import type { Leaderboard as LeaderboardData } from '../../api/types'
import { useLang } from '../../i18n'
import { formatLap } from '../../lib/laptime'
import { pickLocalized } from '../../lib/localized'
import { useHighlights } from './highlights'
import { faMark, missionProgress, teamName } from './labels'
import styles from './Leaderboard.module.css'

/** 예선 순위표. 규칙 4.7 의 예시 표처럼 FA, Q3 최속 랩, Q2·Q1 완료 랩을 보인다. 팀 옆에는 검차 순서 */
export function Leaderboard({
  data,
  onTrackTeamId,
}: {
  data: LeaderboardData
  /** 트랙 위에서 달리는 팀: '진행 중'과 지금 미션의 연속 랩을 함께 보인다 */
  onTrackTeamId?: number | null
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const { teams: updated, lastTeamId } = useHighlights()
  const none = t('common.none')
  const announced = data.rows.find((row) => row.team.id === lastTeamId && row.attempts > 0)

  return (
    <>
      {/* 리더보드 갱신 알림 (doc/Instruction.md 5.3) */}
      <p className="visually-hidden" aria-live="polite">
        {announced &&
          t('live.leaderboard.announce', {
            team: teamName(announced.team, lang),
            progress: missionProgress(t, announced),
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
              <th scope="col">{t('live.leaderboard.team')}</th>
              <ColumnHead
                long={t('live.leaderboard.inspection')}
                short={t('live.leaderboard.inspectionShort')}
                className={styles.inspection}
              />
              <th scope="col" className={styles.affiliation}>
                {t('live.leaderboard.affiliation')}
              </th>
              <th scope="col" className={styles.fa}>
                {t('live.leaderboard.fa')}
              </th>
              <ColumnHead long={t('live.leaderboard.q3')} short="Q3" className={styles.time} />
              <ColumnHead long={t('live.leaderboard.q2')} short="Q2" className={styles.laps} />
              <ColumnHead long={t('live.leaderboard.q1')} short="Q1" className={styles.laps} />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const affiliation = pickLocalized(row.team, 'affiliation', lang)
              const running = row.team.id === onTrackTeamId
              const fa = faMark(row, running)
              return (
                <tr
                  key={row.team.id}
                  data-leader={row.rank === 1 ? '' : undefined}
                  data-updated={updated.has(row.team.id) ? '' : undefined}
                  data-empty={row.rank === null ? '' : undefined}
                  data-running={running ? '' : undefined}
                >
                  <td className={`record ${styles.rank}`}>
                    {row.rank ?? none}
                    {row.rank_drops > 0 && (
                      <span
                        className={styles.drop}
                        title={t('live.leaderboard.dropped', { count: row.rank_drops })}
                      >
                        <span aria-hidden="true">▼{row.rank_drops}</span>
                        <span className="visually-hidden">
                          {t('live.leaderboard.dropped', { count: row.rank_drops })}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className={styles.team}>
                    {teamName(row.team, lang)}
                    {running && (
                      <span className={styles.running}>
                        <span className={styles.runningDot} aria-hidden="true" />
                        {t('live.leaderboard.running')} · {missionProgress(t, row)}
                      </span>
                    )}
                    {affiliation && <span className={styles.teamAffiliation}>{affiliation}</span>}
                  </td>
                  <td className={`record ${styles.inspection}`}>{row.inspection_order ?? none}</td>
                  <td className={styles.affiliation}>{affiliation ?? none}</td>
                  <td className={`record ${styles.fa}`} data-fa={fa}>
                    <span aria-hidden="true">{fa === 'yes' ? 'O' : fa === 'no' ? 'X' : none}</span>
                    <span className="visually-hidden">{t(`live.leaderboard.faMark.${fa}`)}</span>
                  </td>
                  <td className={`record ${styles.time} ${styles.best}`}>
                    {row.q3_best_ms === null ? none : formatLap(row.q3_best_ms)}
                  </td>
                  <td className={`record ${styles.laps}`}>{row.q2_laps ?? none}</td>
                  <td className={`record ${styles.laps}`}>{row.q1_laps ?? none}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** 넓은 화면에서는 'Q3 최속 랩', 좁은 화면에서는 'Q3' */
function ColumnHead({
  long,
  short,
  className,
}: {
  long: string
  short: string
  className: string
}) {
  return (
    <th scope="col" className={className}>
      <span className={styles.long}>{long}</span>
      <span className={styles.short} aria-hidden="true">
        {short}
      </span>
    </th>
  )
}
