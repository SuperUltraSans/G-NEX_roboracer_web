import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { api, ApiError, USE_MOCK } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import { LangToggle } from '../../app/Header'
import styles from './AdminLayout.module.css'
import { ADMIN_ONLY_KEYS, sectionsFor, useCurrentUser } from './auth'
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
  const { pathname } = useLocation()
  const navRef = useRef<HTMLUListElement>(null)

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

  // 화면을 옮기면 맨 위로 올리고, 휴대폰에서 가로로 밀리는 메뉴의 현재 항목이 보이게 한다
  useEffect(() => {
    window.scrollTo(0, 0)
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])

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
      <nav className={styles.nav} aria-label={t('admin.layout.navLabel')}>
        <ul className={styles.navList} ref={navRef}>
          {sectionsFor(user.role).map((section) => (
            <li key={section.key}>
              <NavLink to={section.path} end={section.end} className={styles.navLink}>
                {t(`admin.nav.${section.key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <MockNotice />
      {logout.isError && !(logout.error instanceof ApiError && logout.error.status === 401) && (
        <div className={styles.banner}>
          <ErrorMessage error={logout.error} />
        </div>
      )}
      <main id="admin-main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

export function CenteredState({ children }: { children: ReactNode }) {
  return <div className={styles.centered}>{children}</div>
}
