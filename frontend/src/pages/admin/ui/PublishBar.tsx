// 게시 막대: 일정·규칙·사이트 설정 화면 맨 위에서 공개 사이트와 다른지 보이고, 미리보기와 게시를 한다.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PublishResource } from '../../../api/types'
import { Button, ButtonLink } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useEventTimezone } from '../../../features/content/hooks'
import { usePublish, usePublishStates } from '../../../features/preview/publish'
import { useLang } from '../../../i18n'
import { formatDateTime } from '../../../lib/time'
import styles from './admin.module.css'
import { ErrorMessage, Message, Tag } from './Feedback'

export function PublishBar({
  resource,
  previewPath,
}: {
  resource: PublishResource
  /** 미리보기로 열 공개 화면 (예: /schedule) */
  previewPath: string
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const states = usePublishStates()
  const publish = usePublish()
  const [confirming, setConfirming] = useState(false)
  const state = states.data?.find((item) => item.resource === resource)
  if (!state) return null
  const name = t(`preview.resource.${resource}`)

  return (
    <section
      className={styles.publishBar}
      data-pending={state.pending ? '' : undefined}
      aria-label={t('admin.publish.label')}
    >
      <div className={styles.publishText}>
        <p className={styles.publishStatus}>
          <Tag tone={state.pending ? 'live' : 'on'}>
            {state.pending ? t('admin.publish.pending') : t('admin.publish.clean')}
          </Tag>
          <span>
            {state.pending ? t('admin.publish.pendingHint') : t('admin.publish.cleanHint')}
          </span>
        </p>
        {state.published_at && (
          <p className={styles.meta}>
            {t('admin.publish.last', {
              time: formatDateTime(state.published_at, timezone, lang),
              by: state.published_by ?? t('admin.publish.byServer'),
            })}
          </p>
        )}
        {publish.isSuccess && !state.pending && (
          <Message tone="success">{t('admin.publish.done', { resource: name })}</Message>
        )}
      </div>
      <div className={styles.publishActions}>
        <ButtonLink to={`${previewPath}?preview=1`} target="_blank" rel="noreferrer">
          {t('admin.publish.preview')} <span aria-hidden="true">↗</span>
          <span className="visually-hidden"> ({t('common.opensInNewTab')})</span>
        </ButtonLink>
        <Button
          variant="primary"
          disabled={!state.pending}
          onClick={() => {
            publish.reset()
            setConfirming(true)
          }}
        >
          {t('admin.publish.button')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('preview.confirmTitle', { resource: name })}
        confirmLabel={publish.isPending ? t('preview.publishing') : t('preview.confirm')}
        cancelLabel={t('admin.common.cancel')}
        busy={publish.isPending}
        onConfirm={() => publish.mutate(resource, { onSuccess: () => setConfirming(false) })}
        onCancel={() => setConfirming(false)}
      >
        <p>{t('preview.confirmBody')}</p>
        <ErrorMessage error={publish.error} />
      </ConfirmDialog>
    </section>
  )
}
