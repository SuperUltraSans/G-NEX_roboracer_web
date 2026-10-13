import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ButtonLink } from '../../components/Button'
import { ErrorState, Loading } from '../../components/StateView'
import { useBracket, useLeaderboard, useLiveState } from '../../features/live/hooks'
import { useLiveStatus } from '../../features/live/liveStatus'
import { useLang } from '../../i18n'
import { formatLap } from '../../lib/laptime'
import { sectionsFor, useCurrentUser } from './auth'
import styles from './DashboardPage.module.css'
import { AdminPage, Section } from './ui/AdminPage'
import ui from './ui/admin.module.css'
import { teamOption } from './ui/format'

export function DashboardPage() {
  const { t } = useTranslation()
  const lang = useLang()
  const user = useCurrentUser()
  const live = useLiveState()
  const leaderboard = useLeaderboard()
  const bracket = useBracket()
  const connection = useLiveStatus()
  const none = t('admin.common.none')

  const rows = leaderboard.data?.rows ?? []
  const leader = rows.find((row) => row.rank === 1)
  const ranked = rows.filter((row) => row.rank !== null).length
  const matches = bracket.data?.rounds.flatMap((round) => round.matches) ?? []
  const finished = matches.filter((match) => match.status === 'finished').length

  return (
    <AdminPage
      title={t('admin.dashboard.title')}
      lead={t('admin.dashboard.lead', { name: user.username })}
    >
      <Section
        id="now"
        title={t('admin.dashboard.now')}
        actions={
          <ButtonLink to="/admin/live" variant="secondary">
            {t('admin.dashboard.changeLive')}
          </ButtonLink>
        }
      >
        {live.isPending && <Loading />}
        {live.isError && <ErrorState error={live.error} onRetry={() => live.refetch()} />}
        {live.data && (
          <dl className={ui.facts}>
            <dt>{t('admin.live.phase')}</dt>
            <dd>{t(`admin.phase.${live.data.phase}`)}</dd>
            <dt>{t('admin.live.onTrack')}</dt>
            <dd>{live.data.on_track_team ? teamOption(t, live.data.on_track_team, lang) : none}</dd>
            <dt>{t('admin.live.currentMatch')}</dt>
            <dd>{live.data.current_match?.label ?? none}</dd>
            <dt>{t('admin.live.noticeKo')}</dt>
            <dd className={styles.notice}>{live.data.message_ko ?? none}</dd>
            <dt>{t('admin.dashboard.connection')}</dt>
            <dd>{t(`admin.connection.${connection}`)}</dd>
          </dl>
        )}
      </Section>

      <div className={styles.summaries}>
        <Section
          id="qualifying-summary"
          title={t('admin.nav.qualifying')}
          actions={
            <ButtonLink to="/admin/qualifying" variant="secondary">
              {t('admin.dashboard.enterLap')}
            </ButtonLink>
          }
        >
          {leaderboard.data ? (
            <dl className={ui.facts}>
              <dt>{t('admin.dashboard.rankedTeams')}</dt>
              <dd className="num">
                {t('admin.dashboard.countOf', { n: ranked, total: rows.length })}
              </dd>
              <dt>{t('admin.dashboard.leader')}</dt>
              <dd>
                {leader && leader.best_lap_ms !== null ? (
                  <>
                    {teamOption(t, leader.team, lang)}{' '}
                    <span className="num">{formatLap(leader.best_lap_ms)}</span>
                  </>
                ) : (
                  none
                )}
              </dd>
            </dl>
          ) : (
            leaderboard.isPending && <Loading />
          )}
        </Section>

        <Section
          id="bracket-summary"
          title={t('admin.nav.bracket')}
          actions={
            <ButtonLink to="/admin/bracket" variant="secondary">
              {t('admin.dashboard.openBracket')}
            </ButtonLink>
          }
        >
          {bracket.data ? (
            <dl className={ui.facts}>
              <dt>{t('admin.dashboard.finishedMatches')}</dt>
              <dd className="num">
                {t('admin.dashboard.countOf', { n: finished, total: matches.length })}
              </dd>
            </dl>
          ) : (
            bracket.isPending && <Loading />
          )}
        </Section>
      </div>

      <Section id="shortcuts" title={t('admin.dashboard.shortcuts')}>
        <ul className={styles.links}>
          {sectionsFor(user.role)
            .filter((section) => section.key !== 'dashboard')
            .map((section) => (
              <li key={section.key} className={styles.link}>
                <Link to={section.path}>{t(`admin.nav.${section.key}`)}</Link>
                <p className={ui.meta}>{t(`admin.dashboard.describe.${section.key}`)}</p>
              </li>
            ))}
        </ul>
      </Section>
    </AdminPage>
  )
}
