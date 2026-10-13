import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useSearchParams } from 'react-router'
import { Footer } from './Footer'
import { Header } from './Header'
import { HeroInViewContext } from './heroInView'

export function Layout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  // 현장 프로젝터용 큰 화면 모드에서는 헤더와 푸터를 숨긴다 (doc/Design.md 7장, P2)
  const bigScreen = pathname === '/live' && params.get('display') === '1'
  // 규칙 문서는 넓은 폭으로 보여 주므로 헤더·푸터의 시작선도 같은 폭에 맞춘다
  const wide = pathname === '/rules'
  const [heroInView, setHeroInView] = useState(false)
  const heroContext = useMemo(() => ({ heroInView, setHeroInView }), [heroInView])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <HeroInViewContext.Provider value={heroContext}>
      <a className="skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>
      {!bigScreen && <Header wide={wide} />}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      {!bigScreen && <Footer wide={wide} />}
    </HeroInViewContext.Provider>
  )
}
