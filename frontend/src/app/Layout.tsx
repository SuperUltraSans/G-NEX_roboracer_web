import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useSearchParams } from 'react-router'
import { Footer } from './Footer'
import { Header } from './Header'
import { HeroInViewContext } from './heroInView'
import styles from './Layout.module.css'
import { navMotion, type NavMotion } from './navTabs'

export function Layout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  // 현장 프로젝터용 큰 화면 모드에서는 헤더와 푸터를 숨긴다 (doc/Design.md 7장, P2)
  const bigScreen = pathname === '/live' && params.get('display') === '1'
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
    <HeroInViewContext.Provider value={heroContext}>
      <a className="skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>
      {!bigScreen && <Header />}
      <main id="main" tabIndex={-1} className={styles.main}>
        <div key={pathname} className={styles.page} data-motion={page.motion ?? undefined}>
          <Outlet />
        </div>
      </main>
      {!bigScreen && <Footer />}
    </HeroInViewContext.Provider>
  )
}
