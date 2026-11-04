// 일정 전체를 Markdown 문서 하나로 내려받고 올린다 (한국어·영어를 한 문서에).
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type {
  ScheduleDocument,
  ScheduleDocumentImport,
  ScheduleImportResult,
} from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Section } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { Help } from '../ui/Controls'
import { ErrorMessage, Message } from '../ui/Feedback'
import { saveFile } from '../ui/files'
import { Icon } from '../ui/Icon'
import { useAdminMutation } from '../ui/mutation'
import styles from './Schedule.module.css'

const DOCUMENT = '/api/admin/schedule/document'
// 서버 한도 (Markdown 10만 자)
const MAX_CHARS = 100_000

const EXAMPLE = `## 2026-11-01 (일)

### 09:00-10:00 참가 등록 및 검차
- 장소: 피트 구역
- 영문: Registration and inspection
- 영문 장소: Pit area
차량 검차와 참가 등록을 진행합니다.

### 10:00 개회식 <!-- hidden -->`

interface Picked {
  file: string
  markdown: string
  /** 문서에 든 일정 수 ('### ' 줄) */
  count: number
}

export function ScheduleDocumentPanel({ itemCount }: { itemCount: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const apply = useAdminMutation({
    mutationFn: (body: ScheduleDocumentImport) => api.put<ScheduleImportResult>(DOCUMENT, body),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.scheduleAdmin, result.items)
      void queryClient.invalidateQueries({ queryKey: queryKeys.publish })
      setPicked(null)
      setNotice({
        tone: 'success',
        text: t('admin.schedule.doc.applied', { created: result.created, deleted: result.deleted }),
      })
    },
    onError: () => setPicked(null),
  })

  const download = useAdminMutation({
    mutationFn: () => api.get<ScheduleDocument>(DOCUMENT),
    onSuccess: (doc) =>
      saveFile(doc.filename, new Blob([doc.markdown], { type: 'text/markdown;charset=utf-8' })),
  })

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // 같은 파일을 고쳐 다시 골라도 바뀌게
    if (!file) return
    apply.reset()
    setNotice(null)
    const fail = (key: string) => setNotice({ tone: 'error', text: t(key, { file: file.name }) })
    if (file.size > MAX_CHARS * 4) return fail('admin.schedule.doc.tooLarge')
    let markdown: string
    try {
      markdown = await file.text()
    } catch {
      return fail('admin.schedule.doc.readFailed')
    }
    if (markdown.includes('�')) return fail('admin.schedule.doc.notUtf8')
    if (markdown.length > MAX_CHARS) return fail('admin.schedule.doc.tooLarge')
    const count = markdown.split('\n').filter((line) => line.trim().startsWith('### ')).length
    setPicked({ file: file.name, markdown, count })
  }

  const busy = apply.isPending || download.isPending
  const failure = apply.error instanceof ApiError ? apply.error : null

  return (
    <Section id="schedule-document" title={t('admin.schedule.doc.title')}>
      <p className={ui.meta}>{t('admin.schedule.doc.lead')}</p>
      <div className={styles.document}>
        <span className={styles.documentName}>
          <span className={ui.rowTitle}>{t('admin.schedule.doc.name')}</span>
          <span className={ui.meta} lang="en">
            schedule.md
          </span>
        </span>
        <span className={ui.rowActions}>
          <input
            ref={input}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={(event) => void pick(event)}
          />
          <Button
            variant="secondary"
            className={ui.compact}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Icon name="upload" /> {t('admin.schedule.doc.upload')}
          </Button>
          <Button
            variant="secondary"
            className={ui.compact}
            disabled={busy}
            onClick={() => download.mutate()}
          >
            <Icon name="download" />{' '}
            {download.isPending
              ? t('admin.schedule.doc.downloading')
              : t('admin.schedule.doc.download')}
          </Button>
        </span>
      </div>
      {notice && <Message tone={notice.tone}>{notice.text}</Message>}
      {failure?.code === 'VALIDATION_ERROR' ? (
        <Message tone="error">
          {t('admin.schedule.doc.invalid', { detail: failure.message })}
        </Message>
      ) : (
        <ErrorMessage error={apply.error ?? download.error} />
      )}
      <Help title={t('admin.schedule.doc.formatTitle')}>
        <p>{t('admin.schedule.doc.format1')}</p>
        <p>{t('admin.schedule.doc.format2')}</p>
        <pre className={styles.example}>{EXAMPLE}</pre>
      </Help>

      <ConfirmDialog
        open={picked !== null}
        danger
        title={t('admin.schedule.doc.confirmTitle')}
        confirmLabel={apply.isPending ? t('admin.common.saving') : t('admin.schedule.doc.apply')}
        cancelLabel={t('admin.common.cancel')}
        busy={apply.isPending}
        onConfirm={() => picked && apply.mutate({ markdown: picked.markdown })}
        onCancel={() => setPicked(null)}
      >
        {picked && (
          <p>
            {t('admin.schedule.doc.confirmBody', {
              file: picked.file,
              count: picked.count,
              current: itemCount,
            })}
          </p>
        )}
      </ConfirmDialog>
    </Section>
  )
}
