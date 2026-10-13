import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Page } from '../components/Page'
import { EmptyState, ErrorState, Loading } from '../components/StateView'
import { useEventTimezone, useRules } from '../features/content/hooks'
import { Markdown } from '../features/content/Markdown'
import { useActiveHeading, useToc } from '../features/rules/useToc'
import { useLang } from '../i18n'
import { pickLocalized } from '../lib/localized'
import { formatDateTime } from '../lib/time'
import styles from './RulesPage.module.css'

/** 규칙 문서 뷰어: 화면 폭에 맞춰 넓어지는 본문과, 섹션·큰 제목으로 만든 목차 */
export function RulesPage() {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const rules = useRules()
  // 문서는 데이터를 받은 뒤에 그려지므로 ref 대신 상태로 받아 목차 감시를 그때 시작한다
  const [documentElement, setDocumentElement] = useState<HTMLElement | null>(null)
  const toc = useToc(documentElement)
  const active = useActiveHeading(toc)
  useDocumentTitle(t('rules.title'))

  const sections = [...(rules.data ?? [])].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <Page title={t('rules.title')} wide>
      {rules.isPending && <Loading />}
      {rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
      {rules.isSuccess && sections.length === 0 && <EmptyState>{t('rules.empty')}</EmptyState>}
      {sections.length > 0 && (
        <div className={styles.layout}>
          <nav className={styles.toc} aria-labelledby="toc-title">
            <details className={styles.tocBox} open>
              <summary id="toc-title" className={styles.tocTitle}>
                {t('rules.toc')}
              </summary>
              <ol className={styles.tocList}>
                {toc.map((entry) => (
                  <li key={entry.id} data-level={entry.level}>
                    <a
                      href={`#${entry.id}`}
                      aria-current={entry.id === active ? 'location' : undefined}
                    >
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          </nav>
          <article ref={setDocumentElement} className={styles.document}>
            {sections.map((section) => (
              <section
                key={section.id}
                className={styles.section}
                aria-labelledby={`rule-${section.id}`}
              >
                <h2 id={`rule-${section.id}`} className={styles.sectionTitle} data-toc-section="">
                  {pickLocalized(section, 'title', lang)}
                </h2>
                <p className={styles.updated}>
                  {t('rules.updatedAt', {
                    time: formatDateTime(section.updated_at, timezone, lang),
                  })}
                </p>
                <Markdown idPrefix={`rule-${section.id}`}>
                  {pickLocalized(section, 'body', lang) ?? ''}
                </Markdown>
              </section>
            ))}
          </article>
        </div>
      )}
    </Page>
  )
}
