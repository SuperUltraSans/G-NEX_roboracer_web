import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Page } from '../components/Page'
import { EmptyState, ErrorState, Loading } from '../components/StateView'
import { BracketView } from '../features/live/BracketView'
import { useBracket, useLeaderboard, useLiveState } from '../features/live/hooks'
import { Leaderboard } from '../features/live/Leaderboard'
import { LiveStatusBar } from '../features/live/LiveStatusBar'
import styles from './LivePage.module.css'

export function LivePage() {
  const { t } = useTranslation()
  const liveState = useLiveState()
  const leaderboard = useLeaderboard()
  const bracket = useBracket()
  const [params] = useSearchParams()
  const bigScreen = params.get('display') === '1'
  useDocumentTitle(t('live.title'))

  const hasBracket = (bracket.data?.rounds ?? []).some((round) => round.matches.length > 0)

  const toggle = (
    <Link className={styles.toggle} to={bigScreen ? '/live' : '/live?display=1'}>
      {bigScreen ? t('live.exitDisplay') : t('live.display')}
    </Link>
  )

  return (
    <div
      className={bigScreen ? styles.bigScreen : undefined}
      data-surface={bigScreen ? 'dark' : undefined}
    >
      <Page
        title={t('live.title')}
        aside={
          <>
            <LiveStatusBar state={liveState.data} />
            {toggle}
          </>
        }
      >
        {liveState.data?.phase === 'idle' && <p className={styles.idle}>{t('live.idle')}</p>}

        <section className={styles.section} aria-labelledby="leaderboard-title">
          <h2 id="leaderboard-title" className={styles.sectionTitle}>
            {t('live.leaderboard.title')}
          </h2>
          {leaderboard.isPending && <Loading />}
          {leaderboard.isError && (
            <ErrorState error={leaderboard.error} onRetry={() => leaderboard.refetch()} />
          )}
          {leaderboard.data &&
            (leaderboard.data.rows.length === 0 ? (
              <EmptyState>{t('live.leaderboard.empty')}</EmptyState>
            ) : (
              <Leaderboard data={leaderboard.data} />
            ))}
        </section>

        <section className={styles.section} aria-labelledby="bracket-title">
          <h2 id="bracket-title" className={styles.sectionTitle}>
            {t('live.bracket.title')}
          </h2>
          {bracket.isPending && <Loading />}
          {bracket.isError && (
            <ErrorState error={bracket.error} onRetry={() => bracket.refetch()} />
          )}
          {bracket.data &&
            (hasBracket ? (
              <BracketView data={bracket.data} currentMatchId={liveState.data?.current_match?.id} />
            ) : (
              <EmptyState>{t('live.bracket.empty')}</EmptyState>
            ))}
        </section>
      </Page>
    </div>
  )
}
