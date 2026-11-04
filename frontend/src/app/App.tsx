import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { ApiError } from '../api/client'
import { Loading } from '../components/StateView'
import { LiveProvider } from '../features/live/LiveProvider'
import { ApplyPage } from '../pages/ApplyPage'
import { HomePage } from '../pages/HomePage'
import { LivePage } from '../pages/LivePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ResultsPage } from '../pages/ResultsPage'
import { RulesPage } from '../pages/RulesPage'
import { SchedulePage } from '../pages/SchedulePage'
import { Layout } from './Layout'
import { MockBadge } from './MockBadge'
import { TestSiteBanner } from './TestSiteBanner'

const AdminApp = lazy(() => import('../pages/admin/AdminApp'))
const MonitorApp = lazy(() => import('../pages/monitor/MonitorApp'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // 4xx(권한·주소 오류 등)는 다시 해도 같으므로 한 번 더 하지 않는다.
      // 모니터링 관리 주소가 틀렸을 때 재시도가 시도 제한 횟수를 써 버리지 않게 한다
      retry: (failureCount, error) =>
        failureCount < 1 &&
        !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <TestSiteBanner />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="apply" element={<ApplyPage />} />
              <Route path="live" element={<LivePage />} />
              <Route path="results" element={<ResultsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            {/* 모니터링 관리: 로그인 없이 ?pw= 비밀 주소로, 또는 로그인한 운영진이 연다 */}
            <Route
              path="monitoring-admin"
              element={
                <Suspense fallback={<Loading />}>
                  <MonitorApp />
                </Suspense>
              }
            />
            <Route
              path="admin/*"
              element={
                <Suspense fallback={<Loading />}>
                  <AdminApp />
                </Suspense>
              }
            />
          </Routes>
        </BrowserRouter>
        <MockBadge />
      </LiveProvider>
    </QueryClientProvider>
  )
}
