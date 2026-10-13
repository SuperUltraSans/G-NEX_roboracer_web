import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Loading } from '../components/StateView'
import { LiveProvider } from '../features/live/LiveProvider'
import { ApplyPage } from '../pages/ApplyPage'
import { HomePage } from '../pages/HomePage'
import { LivePage } from '../pages/LivePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { RulesPage } from '../pages/RulesPage'
import { SchedulePage } from '../pages/SchedulePage'
import { Layout } from './Layout'
import { MockBadge } from './MockBadge'

const AdminApp = lazy(() => import('../pages/admin/AdminApp'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="apply" element={<ApplyPage />} />
              <Route path="live" element={<LivePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
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
