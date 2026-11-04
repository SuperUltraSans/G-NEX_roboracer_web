// 모니터링 관리: 대회 당일 진행 상태, 맵핑 순서, 연습 조, 예선 기록, 랭킹·시드, 본선 결과를 다루는 화면.
// 로그인 없이 /monitoring-admin?pw=<비밀 값> 으로 들어오거나, 로그인한 운영진이 연다.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useSearchParams } from 'react-router'
import { api, ApiError, setMonitorKey } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { MonitorAccess } from '../../api/types'
import { LangToggle } from '../../app/Header'
import { useDocumentTitle } from '../../app/useDocumentTitle'
import { ErrorState, Loading } from '../../components/StateView'
import { useLiveState } from '../../features/live/hooks'
import { LiveStatusBar } from '../../features/live/LiveStatusBar'
import { MockNotice } from '../admin/AdminLayout'
import { BracketBoard } from '../admin/bracket/BracketPage'
import { LiveStatePanel } from '../admin/LiveStatePanel'
import { LapEntry } from '../admin/qualifying/LapEntry'
import { RecentLaps } from '../admin/qualifying/RecentLaps'
import { Section } from '../admin/ui/AdminPage'
import ui from '../admin/ui/admin.module.css'
import { Message } from '../admin/ui/Feedback'
import styles from './Monitor.module.css'
import { MappingPanel } from './MappingPanel'
import { PracticePanel } from './PracticePanel'
import { QualifyingOrderPanel } from './QualifyingOrderPanel'
import { RankingPanel } from './RankingPanel'

const TABS = ['live', 'mapping', 'practice', 'qualifying', 'ranking', 'results'] as const

/** 쓰는 중에 이 오류가 나면 더 쓸 수 없다: 주소가 바뀌었거나, 시도 제한, 로그인이 끝남 */
const REVOKING = new Set(['MONITOR_KEY_INVALID', 'RATE_LIMITED', 'UNAUTHENTICATED'])

/** 쓰는 중에 주소가 바뀌거나 로그인이 끝나면 그 오류를 돌려준다 (그러면 화면을 막는다) */
function useRevoked(): ApiError | null {
  const queryClient = useQueryClient()
  const [revoked, setRevoked] = useState<ApiError | null>(null)
  useEffect(() => {
    const check = (error: unknown) => {
      if (error instanceof ApiError && REVOKING.has(error.code)) setRevoked(error)
    }
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') check(event.action.error)
    })
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') check(event.action.error)
    })
    return () => {
      queries()
      mutations()
    }
  }, [queryClient])
  return revoked
}
type Tab = (typeof TABS)[number]

/** 검색 엔진에 내지 않고, 다른 사이트로 나갈 때 주소(비밀 값)를 넘기지 않는다 */
function usePrivatePage() {
  useEffect(() => {
    const metas = [
      Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex' }),
      Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' }),
    ]
    metas.forEach((meta) => document.head.appendChild(meta))
    return () => metas.forEach((meta) => meta.remove())
  }, [])
}

export default function MonitorApp() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const key = params.get('pw')
  // 첫 요청보다 먼저 비밀 값을 심는다 (렌더 중 한 번)
  const [appliedKey] = useState(() => {
    setMonitorKey(key)
    return key
  })
  // 다시 붙을 때(개발 모드의 두 번 붙이기 포함) 다시 심고, 떠날 때 지운다
  useEffect(() => {
    setMonitorKey(appliedKey)
    return () => setMonitorKey(null)
  }, [appliedKey])
  usePrivatePage()
  useDocumentTitle(t('monitor.title'))
  const revoked = useRevoked()

  const access = useQuery({
    queryKey: [...queryKeys.monitorAccess, appliedKey],
    queryFn: () => api.get<MonitorAccess>('/api/admin/monitor/access'),
    retry: false,
    staleTime: Infinity,
  })

  return (
    <div className={styles.shell}>
      <MonitorTopBar access={revoked ? undefined : access.data} />
      <MockNotice />
      <main id="monitor-main" className={styles.main}>
        {access.isPending && <Loading />}
        {access.isError && <AccessError error={access.error} onRetry={() => access.refetch()} />}
        {/* 쓰는 중에 주소가 바뀌면 화면을 내리고 더 요청하지 않는다 (시도 제한에 걸리지 않게) */}
        {access.data && revoked && <AccessError error={revoked} onRetry={() => undefined} />}
        {access.data && !revoked && <MonitorBody />}
      </main>
    </div>
  )
}

function MonitorTopBar({ access }: { access: MonitorAccess | undefined }) {
  const { t } = useTranslation()
  return (
    <header className={styles.topbar} data-surface="dark">
      <div className={styles.bar}>
        <p className={styles.brand}>
          <span className={styles.brandMark}>G-NEX</span> {t('monitor.title')}
        </p>
        {access && (
          <p className={styles.access}>
            {access.via === 'key'
              ? t('monitor.viaKey')
              : t('monitor.viaSession', { name: access.username })}
          </p>
        )}
        <div className={styles.tools}>
          <a href={`${import.meta.env.BASE_URL}live`} target="_blank" rel="noreferrer">
            {t('monitor.openPublic')}
            <span className="visually-hidden"> ({t('common.opensInNewTab')})</span>
          </a>
          <LangToggle />
        </div>
      </div>
    </header>
  )
}

function AccessError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation()
  const { pathname, search } = useLocation()
  const code = error instanceof ApiError ? error.code : ''
  if (code === 'UNAUTHENTICATED' || code === 'MONITOR_KEY_INVALID' || code === 'RATE_LIMITED') {
    return (
      <div className={styles.denied}>
        <h1 className={styles.deniedTitle}>{t('monitor.deniedTitle')}</h1>
        <Message tone="error">
          {code === 'MONITOR_KEY_INVALID'
            ? t('monitor.keyInvalid')
            : code === 'RATE_LIMITED'
              ? t('monitor.rateLimited')
              : t('monitor.needKey')}
        </Message>
        <p className={ui.meta}>
          {/* 로그인한 뒤 이 화면으로 돌아온다 (주소의 비밀 값은 넘기지 않는다) */}
          <Link to="/admin/login" state={{ from: `${pathname}${tabOnly(search)}` }}>
            {t('monitor.staffLogin')}
          </Link>
        </p>
      </div>
    )
  }
  return <ErrorState error={error} onRetry={onRetry} />
}

function tabOnly(search: string): string {
  const tab = new URLSearchParams(search).get('tab')
  return tab ? `?tab=${encodeURIComponent(tab)}` : ''
}

function MonitorBody() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const live = useLiveState()
  const raw = params.get('tab')
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'live'

  // 탭을 바꿔도 주소의 비밀 값(pw)은 그대로 둔다
  const select = (next: Tab) =>
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev)
        nextParams.set('tab', next)
        return nextParams
      },
      { replace: true },
    )

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab)
    const next =
      event.key === 'ArrowRight'
        ? TABS[(index + 1) % TABS.length]
        : event.key === 'ArrowLeft'
          ? TABS[(index - 1 + TABS.length) % TABS.length]
          : event.key === 'Home'
            ? TABS[0]
            : event.key === 'End'
              ? TABS[TABS.length - 1]
              : null
    if (!next) return
    event.preventDefault()
    select(next)
    document.getElementById(`monitor-tab-${next}`)?.focus()
  }

  return (
    <>
      <div className={styles.status}>
        <LiveStatusBar state={live.data} />
      </div>
      <div className={styles.tabs} role="tablist" aria-label={t('monitor.tabsLabel')}>
        {TABS.map((item, index) => (
          <button
            key={item}
            id={`monitor-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls="monitor-panel"
            tabIndex={tab === item ? 0 : -1}
            className={styles.tab}
            onClick={() => select(item)}
            onKeyDown={move}
          >
            <span className={styles.tabStep}>{index + 1}</span>
            <span className={styles.tabText}>
              <span className={styles.tabName}>{t(`monitor.tab.${item}`)}</span>
              <span className={styles.tabHint}>{t(`monitor.tabHint.${item}`)}</span>
            </span>
          </button>
        ))}
      </div>
      <section
        id="monitor-panel"
        role="tabpanel"
        aria-labelledby={`monitor-tab-${tab}`}
        className={styles.panel}
      >
        {tab === 'live' && (
          <Section id="monitor-live" title={t('monitor.tab.live')}>
            <p className={ui.lead}>{t('monitor.lead.live')}</p>
            <LiveStatePanel />
          </Section>
        )}
        {tab === 'mapping' && <MappingPanel />}
        {tab === 'practice' && <PracticePanel />}
        {tab === 'qualifying' && (
          <>
            <div className={styles.split}>
              <Section id="lap-entry" title={t('admin.qualifying.entryTitle')}>
                <p className={ui.lead}>{t('monitor.lead.qualifying')}</p>
                <LapEntry />
              </Section>
              <Section id="recent-laps" title={t('admin.qualifying.recentTitle')}>
                <RecentLaps />
              </Section>
            </div>
            <QualifyingOrderPanel />
          </>
        )}
        {tab === 'ranking' && <RankingPanel />}
        {tab === 'results' && (
          <Section id="monitor-results" title={t('monitor.tab.results')}>
            {!live.data?.bracket_frozen && <p className={ui.lead}>{t('monitor.lead.results')}</p>}
            <BracketBoard mode="results" />
          </Section>
        )}
      </section>
    </>
  )
}
