import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useLocation } from 'react-router'
import { setLang, useLang } from '../i18n'
import styles from './Header.module.css'
import { useHeroInView } from './heroInView'
import { NAV_TABS } from './navTabs'

export function Header() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const heroInView = useHeroInView()
  const [menuOpen, setMenuOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)

  // 넓은 화면: 메뉴 밑줄이 고른 메뉴로 미끄러져 간다 (상태 대신 CSS 변수로 바로 써서 다시 그리지 않는다)
  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) return
    const place = () => {
      const active = nav.querySelector<HTMLElement>('a[aria-current="page"]')
      if (!active) {
        indicator.dataset.hidden = ''
        return
      }
      const { offsetLeft, offsetTop, offsetHeight, offsetWidth } = active
      // 처음 그릴 때와 메뉴에 없는 페이지에서 돌아올 때는 미끄러지지 않고 그 자리에 바로 그린다
      const jump = indicator.dataset.ready === undefined || indicator.dataset.hidden !== undefined
      if (jump) delete indicator.dataset.ready
      delete indicator.dataset.hidden
      indicator.style.setProperty('--x', `${offsetLeft}px`)
      indicator.style.setProperty('--y', `${offsetTop + offsetHeight}px`)
      indicator.style.setProperty('--w', `${offsetWidth}px`)
      if (jump) {
        // 바뀐 자리를 먼저 반영한 뒤에 움직임을 켠다
        indicator.getBoundingClientRect()
        indicator.dataset.ready = ''
      }
    }
    place()
    // 언어를 바꾸거나 글꼴이 늦게 오면 메뉴 폭이 바뀐다
    const observer = new ResizeObserver(place)
    observer.observe(nav)
    nav.querySelectorAll('a').forEach((link) => observer.observe(link))
    return () => observer.disconnect()
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <header
      className={styles.header}
      data-surface="dark"
      data-overlay={heroInView && !menuOpen ? '' : undefined}
    >
      <div className={styles.bar}>
        <Link to="/" className={styles.logo} onClick={() => setMenuOpen(false)}>
          {t('brand.logo')}
        </Link>
        <nav
          ref={navRef}
          id="site-nav"
          className={styles.nav}
          aria-label={t('nav.label')}
          data-open={menuOpen ? '' : undefined}
        >
          <ul className={styles.tabs}>
            {NAV_TABS.map((tab) => (
              <li key={tab.to}>
                <NavLink
                  to={tab.to}
                  end={'end' in tab ? tab.end : undefined}
                  className={styles.tab}
                  onClick={() => setMenuOpen(false)}
                >
                  {t(tab.key)}
                </NavLink>
              </li>
            ))}
          </ul>
          <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
        </nav>
        <LangToggle />
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={menuOpen}
          aria-controls="site-nav"
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? t('nav.close') : t('nav.menu')}
        </button>
      </div>
    </header>
  )
}

export function LangToggle() {
  const { t } = useTranslation()
  const lang = useLang()
  return (
    <div className={styles.lang} role="group" aria-label={t('lang.label')}>
      {(['ko', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          title={t(code === 'ko' ? 'lang.koFull' : 'lang.enFull')}
          onClick={() => setLang(code)}
        >
          {t(code === 'ko' ? 'lang.ko' : 'lang.en')}
        </button>
      ))}
    </div>
  )
}
