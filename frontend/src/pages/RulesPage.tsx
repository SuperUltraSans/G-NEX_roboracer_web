import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Page } from '../components/Page'
import { EmptyState, ErrorState, Loading } from '../components/StateView'
import { ClosedNotice } from '../features/content/ClosedNotice'
import { useEventTimezone, usePageState, useRules } from '../features/content/hooks'
import { Markdown } from '../features/content/Markdown'
import { useStickyFit } from '../features/rules/useStickyFit'
import { type TocEntry, useActiveHeading, useToc } from '../features/rules/useToc'
import { useLang } from '../i18n'
import { pickLocalized } from '../lib/localized'
import { formatDateTime } from '../lib/time'
import styles from './RulesPage.module.css'

/** 규칙 문서 뷰어: 화면 폭에 맞춰 넓어지는 본문과, 섹션·큰 제목으로 만든 목차 */
export function RulesPage() {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const page = usePageState('rules')
  const rules = useRules(page.status === 'open')
  // 문서는 데이터를 받은 뒤에 그려지므로 ref 대신 상태로 받아 목차 감시를 그때 시작한다
  const [documentElement, setDocumentElement] = useState<HTMLElement | null>(null)
  const toc = useToc(documentElement)
  const [layoutElement, setLayoutElement] = useState<HTMLDivElement | null>(null)
  const active = useActiveHeading(toc)
  useDocumentTitle(t('rules.title'))

  const sections = [...(rules.data ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  // 장(# 큰 제목) 아래의 절은 한 단계 내려간다. 첫 장보다 앞의 절(공지 등)과 장이 없는 문서는 맨 위 단계
  const firstChapter = sections.findIndex((section) => section.level === 1)

  // 관리자가 닫은 동안에는 규칙 대신 안내만 보인다
  if (page.status !== 'open') {
    return (
      <Page title={t('rules.title')}>
        {page.status === 'pending' ? <Loading /> : <ClosedNotice page="rules" note={page.note} />}
      </Page>
    )
  }

  return (
    <Page title={t('rules.title')}>
      {rules.isPending && <Loading />}
      {rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} />}
      {rules.isSuccess && sections.length === 0 && <EmptyState>{t('rules.empty')}</EmptyState>}
      {sections.length > 0 && (
        <div ref={setLayoutElement} className={styles.layout}>
          <RulesToc toc={toc} active={active} area={layoutElement} />
          <article ref={setDocumentElement} className={styles.document}>
            {sections.map((section, index) => {
              const chapter = section.level === 1
              const level = chapter || firstChapter < 0 || index < firstChapter ? 1 : 2
              const Heading = level === 1 ? 'h2' : 'h3'
              const body = pickLocalized(section, 'body', lang) ?? ''
              return (
                <section
                  key={section.id}
                  className={styles.section}
                  data-chapter={chapter ? '' : undefined}
                  data-level={level}
                  aria-labelledby={`rule-${section.id}`}
                >
                  <Heading
                    id={`rule-${section.id}`}
                    className={chapter ? styles.chapterTitle : styles.sectionTitle}
                    data-toc-section=""
                    data-level={level}
                  >
                    {pickLocalized(section, 'title', lang)}
                  </Heading>
                  {/* 본문이 없는 장은 제목만 */}
                  {(!chapter || body.trim()) && (
                    <p className={styles.updated}>
                      {t('rules.updatedAt', {
                        time: formatDateTime(section.updated_at, timezone, lang),
                      })}
                    </p>
                  )}
                  {body.trim() && <Markdown idPrefix={`rule-${section.id}`}>{body}</Markdown>}
                </section>
              )
            })}
          </article>
        </div>
      )}
    </Page>
  )
}

/**
 * 옆 목차. 스크롤할 때마다 화면에 보이는 공간에 맞춰 높이를 바꾸므로(맨 위·맨 아래에서 잘리던 문제)
 * 규칙 본문이 함께 다시 그려지지 않게 따로 둔다.
 */
function RulesToc({
  toc,
  active,
  area,
}: {
  toc: TocEntry[]
  active: string | null
  area: HTMLElement | null
}) {
  const { t } = useTranslation()
  const [element, setElement] = useState<HTMLElement | null>(null)
  const maxHeight = useStickyFit(element, area)
  return (
    <nav ref={setElement} className={styles.toc} style={{ maxHeight }} aria-labelledby="toc-title">
      <details className={styles.tocBox} open>
        <summary id="toc-title" className={styles.tocTitle}>
          {t('rules.toc')}
        </summary>
        <ol className={styles.tocList}>
          {toc.map((entry) => (
            <li key={entry.id} data-level={entry.level}>
              <a href={`#${entry.id}`} aria-current={entry.id === active ? 'location' : undefined}>
                {entry.text}
              </a>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  )
}
