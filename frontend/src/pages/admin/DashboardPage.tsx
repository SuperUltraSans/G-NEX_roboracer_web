// 대시보드: 대회 준비·진행 상황을 상자 하나씩으로 한눈에 보고, 각 상자에서 바로 해당 화면으로 간다.
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type {
  AdminSettings,
  AuditLogPage,
  LiveState,
  PageKey,
  PublishResource,
  Ranking,
} from '../../api/types'
import { ButtonLink } from '../../components/Button'
import { ErrorState, Loading } from '../../components/StateView'
import { applyState } from '../../features/apply/applyState'
import { useEventTimezone, usePublicSettings, useTeams } from '../../features/content/hooks'
import { useBracket, useLeaderboard, useLiveState } from '../../features/live/hooks'
import { usePublishStates } from '../../features/preview/publish'
import { useLiveStatus } from '../../features/live/liveStatus'
import { useLang } from '../../i18n'
import { missionProgress } from '../../features/live/labels'
import { formatLap } from '../../lib/laptime'
import { formatDate } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import { MONITOR_PATH, monitorUrl } from '../monitor/url'
import { AuditSummary } from './AuditPage'
import { useCurrentUser, useIsAdmin } from './auth'
import styles from './DashboardPage.module.css'
import { MAX_ACTIVE_TEAMS } from './teams/TeamsPage'
import { AdminPage, Card } from './ui/AdminPage'
import ui from './ui/admin.module.css'
import { CopyButton } from './ui/CopyButton'
import { Tag, type TagTone } from './ui/Feedback'
import { formatClock, teamOption } from './ui/format'

const MONITOR_TABS = ['live', 'qualifying', 'ranking', 'results'] as const
const PAGES: readonly PageKey[] = ['schedule', 'rules', 'live']
const PHASE_TONE: Record<LiveState['phase'], TagTone> = {
  idle: 'off',
  mapping: 'live',
  practice: 'live',
  free_practice: 'live',
  qualifying: 'live',
  bracket: 'live',
  break: 'default',
  finished: 'done',
}

export function DashboardPage() {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const isAdmin = useIsAdmin()

  return (
    <AdminPage
      title={t('admin.dashboard.title')}
      lead={t('admin.dashboard.lead', { name: user.username })}
    >
      <MonitorCard />
      <div className={ui.cards}>
        <LiveCard />
        <SiteCard />
        <TeamsCard />
        <QualifyingCard />
        <BracketCard />
      </div>
      {isAdmin && <RecentChanges />}
    </AdminPage>
  )
}

/** 대회 당일 쓰는 모니터링 관리로 가는 큰 상자. 관리자에게는 로그인 없이 쓰는 주소도 보인다 */
function MonitorCard() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()

  return (
    <section className={styles.monitor} data-surface="dark" aria-labelledby="monitor-card-title">
      <div className={styles.monitorHead}>
        <div className={styles.monitorText}>
          <h2 id="monitor-card-title" className={styles.monitorTitle}>
            {t('admin.dashboard.monitor.title')}
          </h2>
          <p className={styles.monitorLead}>{t('admin.dashboard.monitor.lead')}</p>
        </div>
        <ButtonLink to={MONITOR_PATH} target="_blank" rel="noreferrer" variant="darkPrimary">
          {t('admin.layout.openMonitor')} <span aria-hidden="true">↗</span>
          <span className="visually-hidden"> ({t('common.opensInNewTab')})</span>
        </ButtonLink>
      </div>
      <ol className={styles.steps}>
        {MONITOR_TABS.map((tab, index) => (
          <li key={tab}>
            <Link
              to={`${MONITOR_PATH}?tab=${tab}`}
              target="_blank"
              rel="noreferrer"
              className={styles.step}
            >
              <span className={styles.stepNo}>{index + 1}</span>
              <span className={styles.stepText}>
                <span className={styles.stepName}>{t(`monitor.tab.${tab}`)}</span>
                <span className={styles.stepHint}>{t(`monitor.tabHint.${tab}`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {isAdmin && <MonitorKeyStatus />}
    </section>
  )
}

function MonitorKeyStatus() {
  const { t } = useTranslation()
  const settings = useQuery({
    queryKey: queryKeys.settingsAdmin,
    queryFn: () => api.get<AdminSettings>('/api/admin/settings'),
  })
  if (!settings.data) return null
  const key = settings.data.monitor_key
  return (
    <div className={styles.keyRow}>
      <p className={styles.keyLabel}>{t('admin.dashboard.monitor.keyLabel')}</p>
      {key ? (
        <>
          <code className={styles.keyUrl}>{monitorUrl(key)}</code>
          <div className={styles.keyActions}>
            <CopyButton text={monitorUrl(key)} label={t('admin.dashboard.monitor.copy')} />
            <Link to="/admin/settings#monitor-key" className={styles.keyLink}>
              {t('admin.dashboard.monitor.change')}
            </Link>
          </div>
        </>
      ) : (
        <p className={styles.keyNone}>
          {t('admin.dashboard.monitor.keyNone')}{' '}
          <Link to="/admin/settings#monitor-key" className={styles.keyLink}>
            {t('admin.dashboard.monitor.makeKey')}
          </Link>
        </p>
      )}
    </div>
  )
}

function LiveCard() {
  const { t } = useTranslation()
  const lang = useLang()
  const live = useLiveState()
  const connection = useLiveStatus()
  const none = t('admin.common.none')

  return (
    <Card
      title={t('admin.dashboard.now')}
      footer={
        <ButtonLink to={`${MONITOR_PATH}?tab=live`} target="_blank" rel="noreferrer">
          {t('admin.dashboard.changeLive')} <span aria-hidden="true">↗</span>
        </ButtonLink>
      }
    >
      {live.isPending && <Loading />}
      {live.isError && <ErrorState error={live.error} onRetry={() => live.refetch()} />}
      {live.data && (
        <dl className={ui.facts}>
          <dt>{t('admin.live.phase')}</dt>
          <dd>
            <Tag tone={PHASE_TONE[live.data.phase]}>{t(`admin.phase.${live.data.phase}`)}</Tag>
          </dd>
          <dt>{t('admin.live.onTrack')}</dt>
          <dd>{live.data.on_track_team ? teamOption(t, live.data.on_track_team, lang) : none}</dd>
          <dt>{t('admin.live.currentMatch')}</dt>
          <dd>{live.data.current_match?.label ?? none}</dd>
          <dt>{t('admin.dashboard.notice')}</dt>
          <dd className={styles.notice}>{live.data.message_ko ?? none}</dd>
          <dt>{t('admin.dashboard.connection')}</dt>
          <dd>{t(`admin.connection.${connection}`)}</dd>
        </dl>
      )}
    </Card>
  )
}

/** 공개 사이트: 신청 접수 상태와 일정·규칙·모니터링 페이지 공개 여부 */
function SiteCard() {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const isAdmin = useIsAdmin()
  const settings = usePublicSettings()
  const now = useNow()
  const apply = settings.data ? applyState(settings.data, now) : null

  return (
    <Card
      title={t('admin.dashboard.site')}
      footer={
        isAdmin && <ButtonLink to="/admin/settings">{t('admin.dashboard.openSettings')}</ButtonLink>
      }
    >
      {settings.isPending && <Loading />}
      {settings.data && (
        <dl className={ui.facts}>
          <dt>{t('admin.dashboard.apply')}</dt>
          <dd>
            <Tag tone={apply === 'open' ? 'on' : 'off'}>{t(`apply.status.${apply}`)}</Tag>
            {settings.data.apply_close_at && (
              <span className={styles.after}>
                {t('admin.dashboard.applyUntil', {
                  date: formatDate(settings.data.apply_close_at, timezone, lang),
                })}
              </span>
            )}
          </dd>
          {PAGES.map((page) => (
            <PageFact key={page} page={page} open={settings.data.pages[page].open} />
          ))}
          {isAdmin && <PendingFact />}
        </dl>
      )}
    </Card>
  )
}

const PUBLISH_PATHS: Record<PublishResource, string> = {
  schedule: '/admin/schedule',
  rules: '/admin/rules',
  settings: '/admin/settings',
}

/** 고쳤지만 아직 게시하지 않은 것 (관리자에게만) */
function PendingFact() {
  const { t } = useTranslation()
  const states = usePublishStates()
  const pending = (states.data ?? []).filter((state) => state.pending)
  return (
    <>
      <dt>{t('admin.dashboard.pendingPublish')}</dt>
      <dd>
        {pending.length === 0 ? (
          <Tag tone="on">{t('admin.dashboard.nothingPending')}</Tag>
        ) : (
          <span className={styles.pendingList}>
            {pending.map((state) => (
              <Link key={state.resource} to={PUBLISH_PATHS[state.resource]}>
                <Tag tone="live">{t(`preview.resource.${state.resource}`)}</Tag>
              </Link>
            ))}
          </span>
        )}
      </dd>
    </>
  )
}

function PageFact({ page, open }: { page: PageKey; open: boolean }) {
  const { t } = useTranslation()
  return (
    <>
      <dt>{t(`admin.settings.page.${page}`)}</dt>
      <dd>
        <Tag tone={open ? 'on' : 'off'}>
          {open ? t('admin.settings.pageOpen') : t('admin.dashboard.pageClosed')}
        </Tag>
      </dd>
    </>
  )
}

function TeamsCard() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const teams = useTeams()
  return (
    <Card
      title={t('admin.dashboard.teams')}
      footer={
        isAdmin && <ButtonLink to="/admin/teams">{t('admin.dashboard.openTeams')}</ButtonLink>
      }
    >
      {teams.isPending && <Loading />}
      {teams.data && (
        <>
          <p className={ui.stat}>
            {t('admin.dashboard.teamCount', { count: teams.data.length, max: MAX_ACTIVE_TEAMS })}
          </p>
          <p className={ui.meta}>{t('admin.dashboard.teamsHint')}</p>
        </>
      )}
    </Card>
  )
}

function QualifyingCard() {
  const { t } = useTranslation()
  const lang = useLang()
  const leaderboard = useLeaderboard()
  const ranking = useQuery({
    queryKey: queryKeys.ranking,
    queryFn: () => api.get<Ranking>('/api/admin/ranking'),
  })
  const none = t('admin.common.none')
  const rows = leaderboard.data?.rows ?? []
  const leader = rows.find((row) => row.rank === 1)
  const timed = rows.filter((row) => row.rank !== null).length

  return (
    <Card
      title={t('admin.dashboard.qualifying')}
      footer={
        <>
          <ButtonLink to={`${MONITOR_PATH}?tab=qualifying`} target="_blank" rel="noreferrer">
            {t('admin.dashboard.enterLap')} <span aria-hidden="true">↗</span>
          </ButtonLink>
          <ButtonLink to={`${MONITOR_PATH}?tab=ranking`} target="_blank" rel="noreferrer">
            {t('admin.dashboard.setRanking')} <span aria-hidden="true">↗</span>
          </ButtonLink>
        </>
      }
    >
      {leaderboard.isPending && <Loading />}
      {leaderboard.data && (
        <dl className={ui.facts}>
          <dt>{t('admin.dashboard.rankedTeams')}</dt>
          <dd className="num">{t('admin.dashboard.countOf', { n: timed, total: rows.length })}</dd>
          <dt>{t('admin.dashboard.leader')}</dt>
          <dd>
            {leader ? (
              <>
                {teamOption(t, leader.team, lang)}{' '}
                <span className="num">
                  {leader.q3_best_ms !== null
                    ? formatLap(leader.q3_best_ms)
                    : missionProgress(t, leader)}
                </span>
              </>
            ) : (
              none
            )}
          </dd>
          <dt>{t('admin.dashboard.ranking')}</dt>
          <dd>
            {ranking.data ? (
              ranking.data.entries.length > 0 ? (
                <Tag tone="on">
                  {t('admin.dashboard.rankingSaved', { count: ranking.data.entries.length })}
                </Tag>
              ) : (
                <Tag tone="off">{t('admin.dashboard.rankingEmpty')}</Tag>
              )
            ) : (
              t('admin.common.dash')
            )}
          </dd>
        </dl>
      )}
    </Card>
  )
}

function BracketCard() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const bracket = useBracket()
  const matches = bracket.data?.rounds.flatMap((round) => round.matches) ?? []
  const finished = matches.filter((match) => match.status === 'finished').length
  const live = matches.find((match) => match.status === 'live')

  return (
    <Card
      title={t('admin.dashboard.bracket')}
      footer={
        <>
          <ButtonLink to={`${MONITOR_PATH}?tab=results`} target="_blank" rel="noreferrer">
            {t('admin.dashboard.enterResults')} <span aria-hidden="true">↗</span>
          </ButtonLink>
          {isAdmin && (
            <ButtonLink to="/admin/bracket">{t('admin.dashboard.editBracket')}</ButtonLink>
          )}
        </>
      }
    >
      {bracket.isPending && <Loading />}
      {bracket.data &&
        (matches.length === 0 ? (
          <p className={ui.meta}>{t('admin.dashboard.bracketEmpty')}</p>
        ) : (
          <dl className={ui.facts}>
            <dt>{t('admin.dashboard.rounds')}</dt>
            <dd className="num">{bracket.data.rounds.length}</dd>
            <dt>{t('admin.dashboard.finishedMatches')}</dt>
            <dd className="num">
              {t('admin.dashboard.countOf', { n: finished, total: matches.length })}
            </dd>
            <dt>{t('admin.live.currentMatch')}</dt>
            <dd>{live?.label ?? t('admin.common.none')}</dd>
          </dl>
        ))}
    </Card>
  )
}

function RecentChanges() {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const audit = useQuery({
    queryKey: [...queryKeys.audit, { offset: 0, entity: '', limit: 5 }],
    queryFn: () => api.get<AuditLogPage>('/api/admin/audit?limit=5&offset=0'),
  })

  return (
    <Card
      wide
      title={t('admin.dashboard.recent')}
      footer={<ButtonLink to="/admin/audit">{t('admin.dashboard.openAudit')}</ButtonLink>}
    >
      {audit.isPending && <Loading />}
      {audit.isError && <ErrorState error={audit.error} onRetry={() => audit.refetch()} />}
      {audit.data &&
        (audit.data.items.length === 0 ? (
          <p className={ui.meta}>{t('admin.audit.empty')}</p>
        ) : (
          <ul className={styles.recent}>
            {audit.data.items.map((log) => (
              <li key={log.id} className={styles.recentRow}>
                <span className={`num ${styles.recentTime}`}>
                  {formatDate(log.created_at, timezone, lang)}{' '}
                  {formatClock(log.created_at, timezone)}
                </span>
                <AuditSummary log={log} />
              </li>
            ))}
          </ul>
        ))}
    </Card>
  )
}
