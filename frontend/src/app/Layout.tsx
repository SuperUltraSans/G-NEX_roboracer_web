import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useSearchParams } from 'react-router'
import { PreviewContext } from '../features/preview/context'
import { PreviewBar } from '../features/preview/PreviewBar'
import { setPreview, usePreviewSettings } from '../features/preview/store'
import { useMe } from '../pages/admin/auth'
import { Footer } from './Footer'
import { Header } from './Header'
import { HeroInViewContext } from './heroInView'
import styles from './Layout.module.css'
import { navMotion, type NavMotion } from './navTabs'

export function Layout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  // 현장 프로젝터용 큰 화면 모드에서는 헤더와 푸터를 숨긴다 (doc/Design.md 7장, P2)
  const bigScreen = pathname === '/live' && params.get('display') === '1'

  // 미리보기: 관리자 화면에서 ?preview=1 로 연다. 켜 두면 이 탭에서 페이지를 옮겨도 이어진다
  const previewSettings = usePreviewSettings()
  const previewParam = params.get('preview')
  const previewOn = previewParam === '1' || (previewParam !== '0' && previewSettings.enabled)
  useEffect(() => {
    if (previewParam !== '1' && previewParam !== '0') return
    setPreview({ enabled: previewParam === '1' })
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('preview')
        return next
      },
      { replace: true },
    )
  }, [previewParam, setParams])
  const me = useMe(previewOn)
  const admin = previewOn && me.data?.role === 'admin'
  const previewMode = useMemo(
    () => ({
      active: admin,
      // 미리보기는 페이지 공개 설정과 관계없이 늘 실제 화면을 보인다
      showClosed: admin,
      draftFiles: admin,
    }),
    [admin],
  )
  const [heroInView, setHeroInView] = useState(false)
  const heroContext = useMemo(() => ({ heroInView, setHeroInView }), [heroInView])
  // 메뉴에 있는 페이지끼리 옮길 때 새 페이지가 메뉴 순서 방향에서 들어온다. 처음 열 때는 움직이지 않는다
  const [page, setPage] = useState<{ pathname: string; motion: NavMotion | null }>({
    pathname,
    motion: null,
  })
  if (page.pathname !== pathname) {
    setPage({ pathname, motion: navMotion(page.pathname, pathname) })
  }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <PreviewContext.Provider value={previewMode}>
      <HeroInViewContext.Provider value={heroContext}>
        <a className="skip-link" href="#main">
          {t('nav.skipToContent')}
        </a>
        {previewOn && !bigScreen && <PreviewBar admin={admin} checking={me.isPending} />}
        {!bigScreen && <Header />}
        <main id="main" tabIndex={-1} className={styles.main}>
          <div key={pathname} className={styles.page} data-motion={page.motion ?? undefined}>
            <Outlet />
          </div>
        </main>
        {!bigScreen && <Footer />}
      </HeroInViewContext.Provider>
    </PreviewContext.Provider>
  )
}
