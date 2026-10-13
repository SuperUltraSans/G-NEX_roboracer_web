import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type UIEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { RuleSectionAdmin, RuleSectionCreate, RuleSectionUpdate } from '../../../api/types'
import { Button } from '../../../components/Button'
import { Checkbox, TextArea, TextField } from '../../../components/Field'
import { EmptyState, ErrorState, Loading } from '../../../components/StateView'
import { Markdown } from '../../../features/content/Markdown'
import { useEventTimezone } from '../../../features/content/hooks'
import { useLang } from '../../../i18n'
import { formatDateTime } from '../../../lib/time'
import { AdminPage, Section } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { ContentRowActions } from '../ui/ContentRowActions'
import { ErrorMessage, Message, SaveButton, StaleNotice, Tag } from '../ui/Feedback'
import { isConflict } from '../ui/errors'
import { useAdminMutation } from '../ui/mutation'
import { movedIds } from '../ui/order'
import { useEditor } from '../ui/useEditor'
import styles from './Rules.module.css'
import { RulesDocumentPanel } from './RulesDocumentPanel'

const BASE = '/api/admin/rules'

export function RulesAdminPage() {
  const { t } = useTranslation()
  const sections = useQuery({
    queryKey: queryKeys.rulesAdmin,
    queryFn: () => api.get<RuleSectionAdmin[]>(BASE),
  })
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <AdminPage title={t('admin.rules.title')} lead={t('admin.rules.lead')}>
      {sections.isPending && <Loading />}
      {sections.isError && <ErrorState error={sections.error} onRetry={() => sections.refetch()} />}
      {sections.data && (
        <>
          <Section id="rule-sections" title={t('admin.rules.listTitle')}>
            {notice && <Message tone="success">{notice}</Message>}
            {creating ? (
              <RuleForm
                onDone={(message) => {
                  setCreating(false)
                  setNotice(message)
                }}
              />
            ) : (
              <div className={ui.actions}>
                <Button
                  variant="primary"
                  onClick={() => {
                    setNotice(null)
                    setCreating(true)
                  }}
                >
                  {t('admin.rules.add')}
                </Button>
              </div>
            )}
            {sections.data.length === 0 ? (
              <EmptyState>{t('admin.rules.empty')}</EmptyState>
            ) : (
              <ol className={ui.list}>
                {sections.data.map((section, index) => (
                  <RuleRow
                    key={section.id}
                    section={section}
                    index={index}
                    ids={sections.data.map((other) => other.id)}
                  />
                ))}
              </ol>
            )}
          </Section>
          <RulesDocumentPanel sectionCount={sections.data.length} />
        </>
      )}
    </AdminPage>
  )
}

function RuleRow({
  section,
  index,
  ids,
}: {
  section: RuleSectionAdmin
  index: number
  ids: number[]
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const [editing, setEditing] = useState(false)

  return (
    <li className={ui.row}>
      <div className={ui.rowHead}>
        <span className={ui.rowTitle}>{section.title_ko}</span>
        {section.title_en && section.title_en !== section.title_ko && (
          <span className={ui.meta} lang="en">
            {section.title_en}
          </span>
        )}
        <Tag tone={section.is_published ? 'default' : 'off'}>
          {section.is_published ? t('admin.common.published') : t('admin.common.unpublished')}
        </Tag>
      </div>
      <p className={ui.meta}>
        {t('admin.rules.updatedAt', { time: formatDateTime(section.updated_at, timezone, lang) })}
      </p>
      {editing ? (
        <RuleForm section={section} onDone={() => setEditing(false)} />
      ) : (
        <ContentRowActions
          item={section}
          basePath={BASE}
          adminKey={queryKeys.rulesAdmin}
          publicKey={queryKeys.rules}
          onEdit={() => setEditing(true)}
          orderUp={movedIds(ids, index, -1)}
          orderDown={movedIds(ids, index, 1)}
          deleteTitle={t('admin.rules.deleteTitle', { title: section.title_ko })}
          deleteBody={t('admin.rules.deleteBody')}
        />
      )}
    </li>
  )
}

interface RuleValues {
  titleKo: string
  titleEn: string
  bodyKo: string
  bodyEn: string
  isPublished: boolean
}

function RuleForm({
  section,
  onDone,
}: {
  section?: RuleSectionAdmin
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [titleMissing, setTitleMissing] = useState(false)

  const editor = useEditor<RuleSectionAdmin, RuleValues>({
    item: section,
    queryKey: queryKeys.rulesAdmin,
    toValues: (source) => ({
      titleKo: source?.title_ko ?? '',
      titleEn: source?.title_en ?? '',
      bodyKo: source?.body_ko ?? '',
      bodyEn: source?.body_en ?? '',
      isPublished: source?.is_published ?? true,
    }),
  })
  const { values, set, base } = editor

  const save = useAdminMutation({
    // 순서는 목록의 순서 변경으로만 바꾼다
    mutationFn: (body: Omit<RuleSectionCreate, 'sort_order'>) =>
      base
        ? api.patch<RuleSectionAdmin>(`${BASE}/${base.id}`, {
            ...body,
            version: base.version,
          } satisfies RuleSectionUpdate)
        : api.post<RuleSectionAdmin>(BASE, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.rules })
      if (base) editor.saved(saved)
      else onDone(t('admin.rules.added', { title: saved.title_ko }))
    },
    onError: (error) => {
      if (isConflict(error)) void editor.handleConflict()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const missing = !values.titleKo.trim()
    setTitleMissing(missing)
    if (missing) return
    save.mutate({
      title_ko: values.titleKo.trim(),
      title_en: values.titleEn.trim(),
      body_ko: values.bodyKo,
      body_en: values.bodyEn,
      is_published: values.isPublished,
    })
  }

  return (
    <form className={ui.editor} onSubmit={submit} noValidate>
      {editor.stale && !save.isPending && (
        <StaleNotice onReload={() => section && editor.load(section)} />
      )}
      {editor.conflict && <Message tone="error">{t('admin.error.versionConflict')}</Message>}
      <div className={ui.pair}>
        <TextField
          label={t('admin.rules.titleKo')}
          value={values.titleKo}
          maxLength={200}
          onChange={(event) => {
            set('titleKo', event.target.value)
            setTitleMissing(false)
          }}
          error={titleMissing ? t('admin.common.koRequired') : undefined}
          required
        />
        <TextField
          label={t('admin.rules.titleEn')}
          lang="en"
          value={values.titleEn}
          maxLength={200}
          onChange={(event) => set('titleEn', event.target.value)}
          hint={t('admin.common.enFallback')}
        />
      </div>
      <BodyEditor
        idPrefix={`edit-${section?.id ?? 'new'}`}
        ko={values.bodyKo}
        en={values.bodyEn}
        onChange={(lang, value) => set(lang === 'ko' ? 'bodyKo' : 'bodyEn', value)}
      />
      <Checkbox
        label={t('admin.common.publishedLabel')}
        checked={values.isPublished}
        onChange={(event) => set('isPublished', event.target.checked)}
      />
      <ErrorMessage error={isConflict(save.error) ? null : save.error} />
      <div className={ui.actions}>
        {base ? (
          <SaveButton pending={save.isPending} saved={editor.isSaved} />
        ) : (
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t('admin.common.saving') : t('admin.rules.add')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => onDone(null)}>
          {base ? t('admin.common.close') : t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  )
}

type BodyLang = 'ko' | 'en'
type BodyView = 'edit' | 'preview'

interface SegmentOption<T extends string> {
  value: T
  label: string
  lang?: string
}

/** 하나만 고르는 버튼 묶음 (aria-pressed). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={[styles.segmented, className ?? ''].join(' ')}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.lang}
          className={styles.segment}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 본문 편집기. 한 번에 한 언어를 고친다.
 * 넓은 화면(1024px 이상)은 왼쪽 입력창과 오른쪽 미리보기를 같은 높이로 나란히 두고, 미리보기를
 * 입력창의 스크롤 비율에 맞춰 함께 움직인다. 좁은 화면은 [수정]과 [미리보기]를 번갈아 본다.
 */
function BodyEditor({
  idPrefix,
  ko,
  en,
  onChange,
}: {
  idPrefix: string
  ko: string
  en: string
  onChange: (lang: BodyLang, value: string) => void
}) {
  const { t } = useTranslation()
  const [lang, setLang] = useState<BodyLang>('ko')
  const [view, setView] = useState<BodyView>('edit')
  const value = lang === 'ko' ? ko : en
  const preview = useDeferredValue(value)
  const previewPane = useRef<HTMLDivElement>(null)
  const previewContent = useRef<HTMLDivElement>(null)
  // 입력창이 스크롤된 비율 (0 = 맨 위, 1 = 맨 아래)
  const ratio = useRef(0)
  const label = t(lang === 'ko' ? 'admin.rules.bodyKo' : 'admin.rules.bodyEn')

  const followSource = useCallback(() => {
    const pane = previewPane.current
    if (pane) pane.scrollTop = ratio.current * (pane.scrollHeight - pane.clientHeight)
  }, [])

  const scrolled = (event: UIEvent<HTMLTextAreaElement>) => {
    const area = event.currentTarget
    const range = area.scrollHeight - area.clientHeight
    ratio.current = range > 0 ? area.scrollTop / range : 0
    followSource()
  }

  // 입력으로 미리보기 내용이 바뀌거나 [미리보기]로 넘어왔을 때도 같은 자리를 보인다
  useLayoutEffect(followSource, [preview, view, lang, followSource])

  // 그림이 늦게 불러와져 미리보기 높이가 바뀌어도 맞춘다
  useEffect(() => {
    const content = previewContent.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(followSource)
    observer.observe(content)
    return () => observer.disconnect()
  }, [followSource])

  return (
    <div className={styles.bodyEditor}>
      <div className={styles.bodyBar}>
        <Segmented
          label={t('admin.rules.bodyLang')}
          value={lang}
          options={[
            { value: 'ko', label: t('admin.rules.bodyLangKo'), lang: 'ko' },
            { value: 'en', label: t('admin.rules.bodyLangEn'), lang: 'en' },
          ]}
          onChange={(next) => {
            ratio.current = 0
            setLang(next)
          }}
        />
        <Segmented
          className={styles.viewSwitch}
          label={t('admin.rules.bodyView')}
          value={view}
          options={[
            { value: 'edit', label: t('admin.rules.viewEdit') },
            { value: 'preview', label: t('admin.rules.preview') },
          ]}
          onChange={setView}
        />
      </div>
      <div className={styles.bodyPanes} data-view={view}>
        <div className={styles.sourcePane}>
          <TextArea
            key={lang}
            label={label}
            lang={lang}
            value={value}
            maxLength={100_000}
            className={styles.source}
            onChange={(event) => onChange(lang, event.target.value)}
            onScroll={scrolled}
            hint={t('admin.rules.markdownHint')}
          />
        </div>
        <section className={styles.previewPane} aria-label={t('admin.rules.previewOf', { label })}>
          <p className={styles.previewLabel} aria-hidden="true">
            {t('admin.rules.preview')}
          </p>
          <div ref={previewPane} className={styles.preview} lang={lang}>
            <div ref={previewContent}>
              {preview.trim() ? (
                <Markdown idPrefix={`${idPrefix}-${lang}`}>{preview}</Markdown>
              ) : (
                <p className={ui.meta}>{t('admin.rules.previewEmpty')}</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
