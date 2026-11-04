import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Page } from '../components/Page'
import { EmptyState, ErrorState, Loading } from '../components/StateView'
import { useResults } from '../features/content/hooks'
import { teamName } from '../features/live/labels'
import { useLang } from '../i18n'
import { pickLocalized } from '../lib/localized'
import styles from './ResultsPage.module.css'

/** 대회 시상: 대상 · 최우수상 · 우수상과 받은 팀. 순위는 보이지 않는다 */
export function ResultsPage() {
  const { t } = useTranslation()
  const lang = useLang()
  const results = useResults()
  useDocumentTitle(t('results.title'))
  const entries = results.data?.entries ?? []

  return (
    <Page title={t('results.title')} lead={entries.length > 0 ? t('results.lead') : undefined}>
      {results.isPending && <Loading />}
      {results.isError && <ErrorState error={results.error} onRetry={() => results.refetch()} />}
      {results.isSuccess && entries.length === 0 && <EmptyState>{t('results.empty')}</EmptyState>}
      {entries.length > 0 && (
        <>
          <table className={styles.table}>
            <caption className="visually-hidden">{t('results.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.award}>
                  {t('results.award')}
                </th>
                <th scope="col">{t('results.team')}</th>
                <th scope="col" className={styles.affiliation}>
                  {t('results.affiliation')}
                </th>
              </tr>
            </thead>
            {/* 상마다 한 묶음: 상 이름은 첫 줄에 한 번만 */}
            {entries.map((entry) => (
              <tbody key={entry.award} data-award={entry.award}>
                {entry.teams.map((team, index) => {
                  const affiliation = pickLocalized(team, 'affiliation', lang)
                  return (
                    <tr key={team.id}>
                      {index === 0 && (
                        <th scope="rowgroup" rowSpan={entry.teams.length} className={styles.award}>
                          {t(`results.awards.${entry.award}`)}
                        </th>
                      )}
                      <td className={styles.team}>
                        {teamName(team, lang)}
                        {affiliation && (
                          <span className={styles.teamAffiliation}>{affiliation}</span>
                        )}
                      </td>
                      <td className={styles.affiliation}>{affiliation ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
          <p className={styles.links}>
            <Link to="/live?tab=bracket">{t('results.bracketLink')} →</Link>
          </p>
        </>
      )}
    </Page>
  )
}
