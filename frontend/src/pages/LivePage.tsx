import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Page } from '../components/Page'
import { EmptyState, ErrorState, Loading } from '../components/StateView'
import { BracketView } from '../features/live/BracketView'
import { useBracket, useLeaderboard, useLiveState } from '../features/live/hooks'
import { keepManual, phaseTab, type ManualTab } from '../features/live/liveTab'
import { Leaderboard } from '../features/live/Leaderboard'
import { LiveStatusBar } from '../features/live/LiveStatusBar'
import { LiveTabs, type LiveTab } from '../features/live/LiveTabs'
import styles from './LivePage.module.css'

export function LivePage() {
  const { t } = useTranslation()
  const liveState = useLiveState()
  const leaderboard = useLeaderboard()
  const bracket = useBracket()
  const [params, setParams] = useSearchParams()
  const bigScreen = params.get('display') === '1'
  useDocumentTitle(t('live.title'))

  const hasBracket = (bracket.data?.rounds ?? []).some((round) => round.matches.length > 0)
  const phase = liveState.data?.phase
  const matchRunning = (bracket.data?.rounds ?? []).some((round) =>
    round.matches.some((match) => match.status === 'live'),
  )

  const autoTab = phaseTab(phase, hasBracket)

  // 큰 화면은 진행 단계를 따라간다. 손으로 고른 탭은 진행 단계 탭이 바뀔 때까지만 유지하고
  // 주소에 남기지 않는다(주소의 ?tab= 도 보지 않는다). 큰 화면을 켜고 끌 때마다 처음부터 다시 따라간다.
  const [manual, setManual] = useState<ManualTab | null>(null)
  const [manualFor, setManualFor] = useState(bigScreen)
  if (manualFor !== bigScreen) {
    setManualFor(bigScreen)
    setManual(null)
  }
  // 진행 단계 탭이 바뀌면 손으로 고른 탭을 버린다 (단계가 되돌아와도 되살아나지 않게)
  const kept = keepManual(manual, autoTab)
  if (kept !== manual) setManual(kept)

  // 일반 화면에서 고른 탭은 주소(?tab=)에 남긴다
  const chosen = params.get('tab')
  const tab: LiveTab = bigScreen
    ? (kept?.tab ?? autoTab)
    : chosen === 'qualifying' || chosen === 'bracket'
      ? chosen
      : autoTab
  const writeTab = (next: LiveTab) =>
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev)
        nextParams.set('tab', next)
        return nextParams
      },
      { replace: true },
    )
  const selectTab = (next: LiveTab) =>
    bigScreen ? setManual({ tab: next, auto: autoTab }) : writeTab(next)

  // 일반 화면은 처음 열 때의 진행 단계로 탭을 정하고 고정한다. 보는 중에 운영진이 단계를 바꿔도
  // 화면이 저절로 넘어가지 않게 하기 위해서다. 프로젝터용 큰 화면은 계속 진행 단계를 따라간다.
  const pinInitialTab = !bigScreen && !chosen && liveState.isSuccess
  useEffect(() => {
    if (pinInitialTab) writeTab(autoTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 한 번만
  }, [pinInitialTab])

  // 큰 화면으로 갈 때는 탭을 넘기지 않는다(진행 단계를 따라가게). 끌 때는 보던 탭을 그대로 연다
  const toggleTo = bigScreen ? `/live?tab=${tab}` : '/live?display=1'

  const toggle = (
    <Link className={styles.toggle} to={toggleTo}>
      {bigScreen ? t('live.exitDisplay') : t('live.display')}
    </Link>
  )

  return (
    <div
      className={bigScreen ? styles.bigScreen : undefined}
      data-surface={bigScreen ? 'dark' : undefined}
    >
      <Page title={t('live.title')} aside={<LiveStatusBar state={liveState.data} />}>
        {liveState.data?.phase === 'idle' && <p className={styles.idle}>{t('live.idle')}</p>}

        <LiveTabs
          selected={tab}
          onSelect={selectTab}
          live={{
            qualifying: phase === 'qualifying',
            bracket: phase === 'bracket' || matchRunning,
          }}
          end={toggle}
        >
          {tab === 'qualifying' ? (
            <>
              <h2 className="visually-hidden">{t('live.leaderboard.title')}</h2>
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
            </>
          ) : (
            <>
              <h2 className="visually-hidden">{t('live.bracket.title')}</h2>
              {bracket.isPending && <Loading />}
              {bracket.isError && (
                <ErrorState error={bracket.error} onRetry={() => bracket.refetch()} />
              )}
              {bracket.data &&
                (hasBracket ? (
                  <BracketView
                    data={bracket.data}
                    currentMatchId={liveState.data?.current_match?.id}
                  />
                ) : (
                  <EmptyState>{t('live.bracket.empty')}</EmptyState>
                ))}
            </>
          )}
        </LiveTabs>
      </Page>
    </div>
  )
}
