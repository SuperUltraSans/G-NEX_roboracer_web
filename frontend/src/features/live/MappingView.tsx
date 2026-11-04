import { useTranslation } from 'react-i18next'
import type { LiveState } from '../../api/types'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import { formatTime } from '../../lib/time'
import { useEventTimezone } from '../content/hooks'
import { teamName } from './labels'
import { mappingRows } from './mapping'
import styles from './MappingView.module.css'

/** 공개 모니터링 '맵핑' 탭: 무작위로 정한 맵핑 순서와 팀마다 진행 상태 */
export function MappingView({ state }: { state: LiveState }) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const rows = mappingRows(state)
  const done = rows.filter((row) => row.status === 'done').length

  return (
    <div className={styles.wrap}>
      <p className={styles.summary}>{t('live.mapping.summary', { done, total: rows.length })}</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.order}>
              {t('live.mapping.order')}
            </th>
            <th scope="col">{t('live.mapping.team')}</th>
            <th scope="col" className={styles.status}>
              {t('live.mapping.status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team.id} data-status={row.status}>
              <td className={`num ${styles.order}`}>{row.order}</td>
              <td>
                <span className={styles.team}>{teamName(row.team, lang)}</span>
                {pickLocalized(row.team, 'affiliation', lang) && (
                  <span className={styles.affiliation}>
                    {pickLocalized(row.team, 'affiliation', lang)}
                  </span>
                )}
              </td>
              <td className={styles.status}>
                {row.status === 'onTrack' && <span className={styles.dot} aria-hidden="true" />}
                {t(`live.mapping.state.${row.status}`)}
                {row.status === 'done' && row.mapped_at && (
                  <span className={`num ${styles.time}`}>
                    {formatTime(row.mapped_at, timezone)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
