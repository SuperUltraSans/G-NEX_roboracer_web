import { useTranslation } from 'react-i18next'
import type { LiveState } from '../../api/types'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import { teamName } from './labels'
import styles from './LiveStatusBar.module.css'
import { useLiveStatus } from './liveStatus'

export function LiveStatusBar({ state }: { state: LiveState | undefined }) {
  const { t } = useTranslation()
  const lang = useLang()
  const connection = useLiveStatus()
  const message = state ? pickLocalized(state, 'message', lang) : null

  return (
    <section className={styles.bar} aria-label={t('live.phaseLabel')}>
      <dl className={styles.facts}>
        <div className={styles.phase}>
          <dt>{t('live.phaseLabel')}</dt>
          <dd className={styles.phaseValue} data-phase={state?.phase}>
            {state ? t(`live.phase.${state.phase}`) : t('common.none')}
          </dd>
        </div>
        <div>
          <dt>{t('live.onTrack')}</dt>
          <dd>
            {state?.on_track_team ? (
              <>
                <span className="num">#{state.on_track_team.car_number}</span>{' '}
                {teamName(state.on_track_team, lang)}
              </>
            ) : (
              t('common.none')
            )}
          </dd>
        </div>
        <div>
          <dt>{t('live.currentMatch')}</dt>
          <dd className="num">{state?.current_match?.label ?? t('common.none')}</dd>
        </div>
        <div className={styles.connection} data-status={connection}>
          <dt className="visually-hidden">{t('live.connectionLabel')}</dt>
          <dd data-testid="connection">
            <span className={styles.dot} aria-hidden="true" />
            {t(`live.connection.${connection}`)}
          </dd>
        </div>
      </dl>
      {message && (
        <p className={styles.notice}>
          <span className={styles.noticeLabel}>{t('live.notice')}</span>
          {message}
        </p>
      )}
      {connection === 'closed' && (
        <p className={styles.closed} role="status">
          {t('live.connection.closedHint')}
        </p>
      )}
    </section>
  )
}
