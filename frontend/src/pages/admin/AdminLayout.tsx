import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { api, ApiError, USE_MOCK } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import { LangToggle } from '../../app/Header'
import styles from './AdminLayout.module.css'
import { MONITOR_PATH } from '../monitor/url'
import { ADMIN_ONLY_KEYS, SECTION_GROUPS, sectionsFor, useCurrentUser } from './auth'
import { ErrorMessage, Message } from './ui/Feedback'

/** 어두운 위쪽 막대. 로그인 화면과 관리자 화면이 함께 쓴다. */
export function TopBar({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <header className={styles.topbar} data-surface="dark">
      <div className={styles.bar}>
        <div className={styles.home}>
          <Link to="/admin" className={styles.brand}>
            {t('admin.layout.brand')}
          </Link>
          <Link to="/" className={styles.siteLink}>
            {t('admin.layout.toSite')}
          </Link>
        </div>
        <div className={styles.tools}>
          {children}
          <LangToggle />
        </div>
      </div>
    </header>
  )
}

export function MockNotice() {
  const { t } = useTranslation()
  if (!USE_MOCK) return null
  return (
    <div className={styles.banner}>
      <Message>{t('admin.layout.mockNotice')}</Message>
    </div>
  )
}

export function AdminLayout() {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  const navRef = useRef<HTMLDivElement>(null)
  const sections = sectionsFor(user.role)

  const signOut = () => {
    for (const key of ADMIN_ONLY_KEYS) queryClient.removeQueries({ queryKey: key })
    queryClient.setQueryData(queryKeys.me, null)
    navigate('/admin/login', { replace: true })
  }

  const logout = useMutation({
    mutationFn: () => api.post<void>('/api/admin/auth/logout'),
    onSuccess: signOut,
    onError: (error) => {
      // 세션이 이미 끝났으면 로그아웃된 것과 같다
      if (error instanceof ApiError && error.status === 401) signOut()
    },
  })

  // 화면을 옮기면 맨 위로 올리고(#상자 주소면 그 상자로), 휴대폰에서 가로로 밀리는 메뉴의 현재 항목이 보이게 한다
  useEffect(() => {
    window.scrollTo(0, 0)
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])

  // #상자 주소는 내용이 그려진 뒤에야 갈 곳이 생기므로 잠깐 기다렸다가 옮긴다
  useEffect(() => {
    if (!hash) return
    let tries = 0
    const timer = window.setInterval(() => {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)))
      if (target || ++tries > 20) {
        window.clearInterval(timer)
        target?.scrollIntoView({ block: 'start' })
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [pathname, hash])

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#admin-main">
        {t('admin.layout.skip')}
      </a>
      <TopBar>
        <p className={styles.user}>
          <span className={styles.username}>{user.username}</span>
          <span className={styles.role}>{t(`admin.role.${user.role}`)}</span>
        </p>
        <button
          type="button"
          className={styles.logout}
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          {logout.isPending ? t('admin.layout.loggingOut') : t('admin.layout.logout')}
        </button>
      </TopBar>
      <MockNotice />
      {logout.isError && !(logout.error instanceof ApiError && logout.error.status === 401) && (
        <div className={styles.banner}>
          <ErrorMessage error={logout.error} />
        </div>
      )}
      <div className={styles.body}>
        {/* 넓은 화면에서는 왼쪽 옆 메뉴, 좁은 화면에서는 가로로 미는 메뉴 */}
        <nav className={styles.nav} aria-label={t('admin.layout.navLabel')}>
          <Link to={MONITOR_PATH} target="_blank" rel="noreferrer" className={styles.monitorLink}>
            <span className={styles.monitorName}>
              {t('admin.layout.openMonitor')} <span aria-hidden="true">↗</span>
            </span>
            <span className={styles.monitorHint}>{t('admin.layout.openMonitorHint')}</span>
            <span className="visually-hidden"> ({t('common.opensInNewTab')})</span>
          </Link>
          <div className={styles.groups} ref={navRef}>
            {SECTION_GROUPS.map((group) => {
              const items = sections.filter((section) => section.group === group)
              if (items.length === 0) return null
              return (
                <div key={group} className={styles.group}>
                  {group !== 'home' && (
                    <p className={styles.groupLabel} id={`nav-group-${group}`}>
                      {t(`admin.navGroup.${group}`)}
                    </p>
                  )}
                  <ul
                    className={styles.navList}
                    aria-labelledby={group !== 'home' ? `nav-group-${group}` : undefined}
                  >
                    {items.map((section) => (
                      <li key={section.key}>
                        <NavLink to={section.path} end={section.end} className={styles.navLink}>
                          {t(`admin.nav.${section.key}`)}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </nav>
        <main id="admin-main" tabIndex={-1} className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function CenteredState({ children }: { children: ReactNode }) {
  return <div className={styles.centered}>{children}</div>
}
