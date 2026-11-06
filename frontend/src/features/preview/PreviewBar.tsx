// 미리보기 막대: 공개 화면 맨 위에서 지금 미리보기 중임을 알리고, 게시와 미리보기 끝내기를 한다.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { PageKey, PublishResource } from '../../api/types'
import { HIDE_ADMIN_LINK } from '../../app/adminLink'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { errorMessage } from '../../pages/admin/ui/errors'
import { usePublicSettings } from '../content/hooks'
import styles from './PreviewBar.module.css'
import { usePublish, usePublishStates } from './publish'
import { setPreview } from './store'

const PAGES: readonly PageKey[] = ['schedule', 'rules', 'live']

export function PreviewBar({ admin, checking }: { admin: boolean; checking: boolean }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  // 미리보기는 닫힌 페이지도 보여 주므로, 공개 사이트에서는 닫혀 보일 페이지를 따로 알린다
  const settings = usePublicSettings()
  const closed = PAGES.filter((page) => settings.data && !settings.data.pages[page].open)
  const states = usePublishStates(admin)
  const publish = usePublish()
  const [confirming, setConfirming] = useState<PublishResource | null>(null)
  const pending = (states.data ?? []).filter((state) => state.pending)

  return (
    <div className={styles.bar} data-surface="dark" role="region" aria-label={t('preview.label')}>
      <div className={styles.inner}>
        <p className={styles.title}>
          <span className={styles.badge}>{t('preview.badge')}</span>
          {admin ? t('preview.lead') : checking ? t('preview.checking') : t('preview.needAdmin')}
        </p>
        {admin && (
          <div className={styles.row}>
            <p className={styles.pending}>
              {pending.length === 0
                ? t('preview.nothingPending')
                : t('preview.pending', {
                    list: pending
                      .map((state) => t(`preview.resource.${state.resource}`))
                      .join(', '),
                  })}
            </p>
            <div className={styles.actions}>
              {pending.map((state) => (
                <Button
                  key={state.resource}
                  className={styles.publishButton}
                  variant="secondary"
                  onClick={() => {
                    publish.reset()
                    setConfirming(state.resource)
                  }}
                >
                  {t('preview.publish', { resource: t(`preview.resource.${state.resource}`) })}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className={styles.row}>
          {admin && closed.length > 0 && (
            <p className={styles.note}>
              {t('preview.closedPages', {
                list: closed.map((page) => t(`nav.${page}`)).join(', '),
              })}
            </p>
          )}
          <div className={styles.actions}>
            {!admin && !checking && !HIDE_ADMIN_LINK && (
              <Link
                to="/admin/login"
                state={{ from: `${pathname}?preview=1` }}
                className={styles.link}
              >
                {t('preview.login')}
              </Link>
            )}
            <Button variant="darkOutline" onClick={() => setPreview({ enabled: false })}>
              {t('preview.exit')}
            </Button>
          </div>
        </div>
        {publish.isSuccess && !confirming && (
          <p className={styles.done} role="status">
            {t('preview.published')}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirming !== null}
        title={t('preview.confirmTitle', {
          resource: confirming ? t(`preview.resource.${confirming}`) : '',
        })}
        confirmLabel={publish.isPending ? t('preview.publishing') : t('preview.confirm')}
        cancelLabel={t('preview.cancel')}
        busy={publish.isPending}
        onConfirm={() => {
          if (!confirming) return
          publish.mutate(confirming, { onSuccess: () => setConfirming(null) })
        }}
        onCancel={() => setConfirming(null)}
      >
        <p>{t('preview.confirmBody')}</p>
        {publish.isError && <p className={styles.error}>{errorMessage(t, publish.error)}</p>}
      </ConfirmDialog>
    </div>
  )
}
