import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type {
  RulesDocument,
  RulesDocumentImport,
  RulesImportResult,
  RulesLang,
} from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Section } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { ErrorMessage, Message } from '../ui/Feedback'
import { useAdminMutation } from '../ui/mutation'
import {
  MAX_PACKAGE_BYTES,
  downloadRulesPackage,
  hasZipSignature,
  looksLikeZip,
  uploadRulesPackage,
} from './packageApi'
import styles from './Rules.module.css'

const DOCUMENT = '/api/admin/rules/document'
const LANGS: RulesLang[] = ['ko', 'en']
// 서버의 문서 길이 한도 (backend/app/services/rules_markdown.py 의 MAX_DOCUMENT_CHARS)
const MAX_CHARS = 1_000_000
const MAX_PACKAGE_MB = MAX_PACKAGE_BYTES / 1024 / 1024

type Picked =
  | { kind: 'markdown'; lang: RulesLang; file: string; markdown: string }
  | { kind: 'zip'; lang: RulesLang; file: string; zip: File }

type DownloadKind = 'markdown' | 'zip'
const DOWNLOADS = [
  { kind: 'markdown', label: 'admin.rules.doc.downloadMarkdown' },
  { kind: 'zip', label: 'admin.rules.doc.downloadZip' },
] as const satisfies readonly { kind: DownloadKind; label: string }[]

interface Notice {
  tone: 'success' | 'error'
  text: string
  warnings?: string[]
}

function saveFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function upload(picked: Picked): Promise<RulesImportResult> {
  if (picked.kind === 'zip') return uploadRulesPackage(picked.lang, picked.zip)
  const body: RulesDocumentImport = { lang: picked.lang, markdown: picked.markdown }
  return api.put<RulesImportResult>(DOCUMENT, body)
}

async function download(lang: RulesLang, kind: DownloadKind) {
  if (kind === 'zip') {
    const { filename, blob } = await downloadRulesPackage(lang)
    saveFile(filename, blob)
    return
  }
  const doc = await api.get<RulesDocument>(`${DOCUMENT}?lang=${lang}`)
  saveFile(doc.filename, new Blob([doc.markdown], { type: 'text/markdown;charset=utf-8' }))
}

/**
 * 규칙 전체를 언어별 Markdown 문서 하나로 올리고 내려받는다. 그림이 있으면 문서와 그림을 묶은
 * ZIP 으로 주고받는다. 올린 문서는 확인을 거쳐 서버에 적용되고, 공개 화면은 WebSocket 알림으로
 * 바로 바뀐다.
 */
export function RulesDocumentPanel({ sectionCount }: { sectionCount: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const langName = (lang: RulesLang) => t(`admin.rules.doc.lang.${lang}`)

  const apply = useAdminMutation({
    mutationFn: upload,
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.rulesAdmin, result.sections)
      void queryClient.invalidateQueries({ queryKey: queryKeys.rules, exact: true })
      setPicked(null)
      const counts = { created: result.created, updated: result.updated, deleted: result.deleted }
      const applied =
        result.lang === 'ko'
          ? t('admin.rules.doc.appliedKo', counts)
          : t('admin.rules.doc.appliedEn', counts)
      const pictures = t('admin.rules.doc.appliedPictures', { count: result.assets })
      setNotice({ tone: 'success', text: `${applied} ${pictures}`, warnings: result.warnings })
    },
    // 오류는 대화상자를 닫고 패널 아래에 보인다 (문서를 고쳐서 다시 올려야 하므로)
    onError: () => setPicked(null),
  })

  const save = useAdminMutation({
    mutationFn: ({ lang, kind }: { lang: RulesLang; kind: DownloadKind }) => download(lang, kind),
  })

  const pick = async (lang: RulesLang, file: File) => {
    apply.reset()
    save.reset()
    setNotice(null)
    const fail = (key: string) =>
      setNotice({ tone: 'error', text: t(key, { file: file.name, size: MAX_PACKAGE_MB }) })

    if (looksLikeZip(file)) {
      if (file.size > MAX_PACKAGE_BYTES) return fail('admin.rules.doc.zipTooLarge')
      let signature: boolean
      try {
        signature = await hasZipSignature(file)
      } catch {
        return fail('admin.rules.doc.readFailed')
      }
      if (!signature) return fail('admin.rules.doc.notZip')
      setPicked({ kind: 'zip', lang, file: file.name, zip: file })
      return
    }

    // UTF-8 한 글자는 4바이트를 넘지 않으므로 이보다 크면 읽지 않고 거절한다
    if (file.size > MAX_CHARS * 4) return fail('admin.rules.doc.tooLarge')
    let markdown: string
    try {
      markdown = await file.text()
    } catch {
      return fail('admin.rules.doc.readFailed')
    }
    // file.text() 는 UTF-8 로 읽고 읽을 수 없는 바이트를 U+FFFD 로 바꾼다 (예: EUC-KR 파일)
    if (markdown.includes('�')) return fail('admin.rules.doc.notUtf8')
    if (markdown.length > MAX_CHARS) return fail('admin.rules.doc.tooLarge')
    setPicked({ kind: 'markdown', lang, file: file.name, markdown })
  }

  const error = apply.error ?? save.error
  const busy = apply.isPending || save.isPending
  const tooLarge = t('admin.rules.doc.zipTooLargeServer', { size: MAX_PACKAGE_MB })

  return (
    <Section id="rules-document" title={t('admin.rules.doc.title')}>
      <p className={ui.lead}>{t('admin.rules.doc.lead')}</p>
      <p className={`${ui.meta} ${styles.hint}`}>{t('admin.rules.doc.formatHint')}</p>
      <p className={`${ui.meta} ${styles.hint}`}>
        {t('admin.rules.doc.zipHint', { size: MAX_PACKAGE_MB })}
      </p>
      <ul className={styles.documents}>
        {LANGS.map((lang) => (
          <DocumentRow
            key={lang}
            lang={lang}
            name={langName(lang)}
            busy={busy}
            downloading={
              save.isPending && save.variables?.lang === lang ? save.variables.kind : null
            }
            onPick={(file) => void pick(lang, file)}
            onDownload={(kind) => {
              apply.reset()
              setNotice(null)
              save.mutate({ lang, kind })
            }}
          />
        ))}
      </ul>
      {notice && (
        <Message tone={notice.tone}>
          {notice.text}
          {notice.warnings && notice.warnings.length > 0 && (
            <> {t('admin.rules.doc.warningsLead', { count: notice.warnings.length })}</>
          )}
        </Message>
      )}
      {notice?.warnings && notice.warnings.length > 0 && (
        <section
          className={styles.warnings}
          aria-label={t('admin.rules.doc.warningsTitle', { count: notice.warnings.length })}
        >
          <p className={styles.warningsTitle}>
            {t('admin.rules.doc.warningsTitle', { count: notice.warnings.length })}
          </p>
          <ul className={styles.warningList}>
            {notice.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
      <ErrorMessage
        error={error}
        overrides={{
          VALIDATION_ERROR:
            error instanceof ApiError
              ? t('admin.rules.doc.invalid', { detail: error.message })
              : undefined,
          PAYLOAD_TOO_LARGE: tooLarge,
          // 리버스 프록시가 먼저 막으면 JSON 없는 413 이 온다
          UNKNOWN: error instanceof ApiError && error.status === 413 ? tooLarge : undefined,
        }}
      />
      <ConfirmDialog
        open={picked !== null}
        danger
        title={picked && t('admin.rules.doc.confirmTitle', { lang: langName(picked.lang) })}
        confirmLabel={apply.isPending ? t('admin.rules.doc.applying') : t('admin.rules.doc.apply')}
        cancelLabel={t('admin.common.cancel')}
        busy={apply.isPending}
        onConfirm={() => picked && apply.mutate(picked)}
        onCancel={() => setPicked(null)}
      >
        {picked && (
          <>
            <p>
              {picked.lang === 'ko'
                ? t('admin.rules.doc.confirmKo', { file: picked.file, count: sectionCount })
                : t('admin.rules.doc.confirmEn', { file: picked.file, count: sectionCount })}
            </p>
            {picked.kind === 'zip' && <p>{t('admin.rules.doc.confirmZip')}</p>}
            {picked.lang === 'ko' && <p>{t('admin.rules.doc.confirmKoEn')}</p>}
            <p>{t('admin.rules.doc.confirmBackup')}</p>
          </>
        )}
      </ConfirmDialog>
    </Section>
  )
}

function DocumentRow({
  lang,
  name,
  busy,
  downloading,
  onPick,
  onDownload,
}: {
  lang: RulesLang
  name: string
  busy: boolean
  downloading: DownloadKind | null
  onPick: (file: File) => void
  onDownload: (kind: DownloadKind) => void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 같은 파일을 고쳐서 다시 골라도 change 가 일어나게 비운다
    event.target.value = ''
    if (file) onPick(file)
  }

  return (
    <li className={styles.document}>
      <span className={styles.documentName}>
        <span className={ui.rowTitle}>{name}</span>
        <span className={ui.meta} lang="en">
          rules.{lang}.md · rules.{lang}.zip
        </span>
      </span>
      <span className={styles.documentActions}>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.zip,application/zip,text/markdown"
          hidden
          onChange={change}
        />
        <Button
          variant="secondary"
          className={ui.compact}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {t('admin.rules.doc.upload')}
          <span className="visually-hidden"> ({name})</span>
        </Button>
        <span
          className={styles.downloads}
          role="group"
          aria-label={t('admin.rules.doc.downloadGroup', { name })}
        >
          {DOWNLOADS.map(({ kind, label }) => (
            <Button
              key={kind}
              variant="secondary"
              className={ui.compact}
              disabled={busy}
              onClick={() => onDownload(kind)}
            >
              {downloading === kind ? t('admin.rules.doc.downloading') : t(label)}
            </Button>
          ))}
        </span>
      </span>
    </li>
  )
}
