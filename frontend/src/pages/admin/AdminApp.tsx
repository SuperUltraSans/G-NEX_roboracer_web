// 관리자 화면 진입점. /admin/* 아래의 라우트를 모두 여기서 정의한다.
// 경로는 상대 경로로 두고, 배포 경로(basename)는 라우터가 붙인다.
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { PreviewContext } from '../../features/preview/context'
import { AuditPage } from './AuditPage'
import { BracketPage } from './bracket/BracketPage'
import { DashboardPage } from './DashboardPage'
import { LoginPage } from './LoginPage'
import { AdminNotFound, AdminOnly, RequireAuth } from './RequireAuth'
import { RulesAdminPage } from './rules/RulesAdminPage'
import { ScheduleAdminPage } from './schedule/ScheduleAdminPage'
import { SettingsPage } from './SettingsPage'
import { TeamsPage } from './teams/TeamsPage'
import { UsersPage } from './UsersPage'

/** 관리자 화면은 검색 엔진에 노출하지 않는다 (doc/Instruction.md 7장). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}

// 관리자 화면의 규칙 미리보기는 규칙 페이지가 닫혀 있어도 그림이 보여야 한다
const ADMIN_PREVIEW = { active: false, showClosed: false, draftFiles: true }

export default function AdminApp() {
  useNoIndex()
  return (
    <PreviewContext.Provider value={ADMIN_PREVIEW}>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route index element={<DashboardPage />} />
          {/* 진행 상태·예선 기록은 모니터링 관리로 옮겼다. 예전 주소는 그리로 보낸다 */}
          <Route path="live" element={<Navigate to="/monitoring-admin?tab=live" replace />} />
          <Route
            path="qualifying"
            element={<Navigate to="/monitoring-admin?tab=qualifying" replace />}
          />
          <Route element={<AdminOnly />}>
            <Route path="bracket" element={<BracketPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="schedule" element={<ScheduleAdminPage />} />
            <Route path="rules" element={<RulesAdminPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<AdminNotFound />} />
        </Route>
      </Routes>
    </PreviewContext.Provider>
  )
}
