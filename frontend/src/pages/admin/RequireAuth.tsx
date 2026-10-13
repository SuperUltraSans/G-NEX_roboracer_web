import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router'
import { ButtonLink } from '../../components/Button'
import { ErrorState, Loading } from '../../components/StateView'
import { AdminLayout, CenteredState, TopBar } from './AdminLayout'
import { CurrentUserContext, useCurrentUser, useMe } from './auth'
import { AdminPage } from './ui/AdminPage'
import { Message } from './ui/Feedback'

/** 세션이 없으면 로그인 화면으로 보내고, 로그인 뒤 원래 가려던 주소로 돌아오게 한다. */
export function RequireAuth() {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) {
    return (
      <>
        <TopBar />
        <CenteredState>
          <Loading />
        </CenteredState>
      </>
    )
  }
  if (me.isError) {
    return (
      <>
        <TopBar />
        <CenteredState>
          <ErrorState error={me.error} onRetry={() => me.refetch()} />
        </CenteredState>
      </>
    )
  }
  if (!me.data) {
    const from = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/admin/login" replace state={{ from }} />
  }
  return (
    <CurrentUserContext.Provider value={me.data}>
      <AdminLayout />
    </CurrentUserContext.Provider>
  )
}

/** 관리자 전용 화면. 심판에게는 권한이 없다는 안내만 보인다. */
export function AdminOnly() {
  const user = useCurrentUser()
  if (user.role === 'admin') return <Outlet />
  return <NoPermission />
}

function NoPermission() {
  const { t } = useTranslation()
  return (
    <AdminPage title={t('admin.noPermission.title')}>
      <Message>{t('admin.noPermission.body')}</Message>
      <div>
        <ButtonLink to="/admin" variant="secondary">
          {t('admin.noPermission.back')}
        </ButtonLink>
      </div>
    </AdminPage>
  )
}

export function AdminNotFound() {
  const { t } = useTranslation()
  return (
    <AdminPage title={t('admin.notFound.title')}>
      <Message>{t('admin.notFound.body')}</Message>
      <div>
        <ButtonLink to="/admin" variant="secondary">
          {t('admin.noPermission.back')}
        </ButtonLink>
      </div>
    </AdminPage>
  )
}
