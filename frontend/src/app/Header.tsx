import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router'
import { setLang, useLang } from '../i18n'
import styles from './Header.module.css'
import { useHeroInView } from './heroInView'

const TABS = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/schedule', key: 'nav.schedule' },
  { to: '/rules', key: 'nav.rules' },
  { to: '/apply', key: 'nav.apply' },
  { to: '/live', key: 'nav.live' },
] as const

export function Header({ wide = false }: { wide?: boolean }) {
  const { t } = useTranslation()
  const heroInView = useHeroInView()
  const [menuOpen, setMenuOpen] = useState(false)

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
      <div className={wide ? `${styles.bar} ${styles.wide}` : styles.bar}>
        <Link to="/" className={styles.logo} onClick={() => setMenuOpen(false)}>
          {t('brand.logo')}
        </Link>
        <nav
          id="site-nav"
          className={styles.nav}
          aria-label={t('nav.label')}
          data-open={menuOpen ? '' : undefined}
        >
          <ul className={styles.tabs}>
            {TABS.map((tab) => (
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
