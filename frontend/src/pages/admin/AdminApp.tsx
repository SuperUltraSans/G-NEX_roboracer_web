// 관리자 화면 진입점. /admin/* 아래의 라우트를 모두 여기서 정의한다.
// 경로는 상대 경로로 두고, 배포 경로(basename)는 라우터가 붙인다.
import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import { AuditPage } from './AuditPage'
import { BracketPage } from './bracket/BracketPage'
import { DashboardPage } from './DashboardPage'
import { LiveStatePage } from './LiveStatePage'
import { LoginPage } from './LoginPage'
import { QualifyingPage } from './qualifying/QualifyingPage'
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

export default function AdminApp() {
  useNoIndex()
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<DashboardPage />} />
        <Route path="live" element={<LiveStatePage />} />
        <Route path="qualifying" element={<QualifyingPage />} />
        <Route path="bracket" element={<BracketPage />} />
        <Route element={<AdminOnly />}>
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
  )
}
