import { useTranslation } from 'react-i18next'
import { AdminPage, Section } from '../ui/AdminPage'
import { LapEntry } from './LapEntry'
import { RecentLaps } from './RecentLaps'

export function QualifyingPage() {
  const { t } = useTranslation()
  return (
    <AdminPage title={t('admin.qualifying.title')} lead={t('admin.qualifying.lead')}>
      <Section id="lap-entry" title={t('admin.qualifying.entryTitle')}>
        <LapEntry />
      </Section>
      <Section id="recent-laps" title={t('admin.qualifying.recentTitle', { count: 20 })}>
        <RecentLaps />
      </Section>
    </AdminPage>
  )
}
