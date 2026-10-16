import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Button, ButtonAnchor } from '../components/Button'
import { Page } from '../components/Page'
import { ErrorState, Loading } from '../components/StateView'
import { applyState } from '../features/apply/applyState'
import { usePublicSettings } from '../features/content/hooks'
import { useLang } from '../i18n'
import { formatDate, formatDateTime } from '../lib/time'
import { useNow } from '../lib/useNow'
import styles from './ApplyPage.module.css'

export function ApplyPage() {
  const { t } = useTranslation()
  const lang = useLang()
  const now = useNow()
  const settings = usePublicSettings()
  useDocumentTitle(t('apply.title'))

  return (
    <Page title={t('apply.title')}>
      <dl className={styles.info}>
        {(['eligibility', 'team', 'method'] as const).map((key) => (
          <div key={key}>
            <dt>{t(`apply.info.${key}.label`)}</dt>
            <dd>{t(`apply.info.${key}.value`)}</dd>
          </div>
        ))}
      </dl>
      {settings.isPending && <Loading />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data &&
        (() => {
          const data = settings.data
          const state = applyState(data, now)
          const timezone = data.event_timezone
          const when = (iso: string) => formatDateTime(iso, timezone, lang)
          // 마감 시각이 미정이면 날짜만 보인다
          const closeWhen = (iso: string) =>
            data.apply_close_date_only ? formatDate(iso, timezone, lang) : when(iso)
          const formUrl = state === 'open' ? data.apply_form_url : null
          return (
            <div className={styles.panel} data-state={state}>
              <div className={styles.main}>
                {/* 접수 상태와 접수 기간을 나란히, 같은 크기로 첫눈에 보이게 */}
                <dl className={styles.facts}>
                  <div>
                    <dt>{t('apply.statusLabel')}</dt>
                    <dd className={styles.statusValue}>{t(`apply.status.${state}`)}</dd>
                  </div>
                  <div>
                    <dt>{t('apply.periodLabel')}</dt>
                    <dd className={styles.periodValue}>
                      {data.apply_open_at || data.apply_close_at ? (
                        <>
                          {data.apply_open_at && (
                            <span className="num">
                              {t('apply.from', { time: when(data.apply_open_at) })}
                            </span>
                          )}{' '}
                          {data.apply_close_at && (
                            <span className="num">
                              {t('apply.to', { time: closeWhen(data.apply_close_at) })}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className={styles.periodUnset}>{t('apply.periodUnset')}</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {state === 'open' && data.apply_form_url ? (
                  <ButtonAnchor
                    variant="primary"
                    href={data.apply_form_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.cta}
                  >
                    {t('apply.button.open')}
                    <span className="visually-hidden"> ({t('common.opensInNewTab')})</span>
                  </ButtonAnchor>
                ) : (
                  <Button variant="primary" disabled className={styles.cta}>
                    {state === 'upcoming' && data.apply_open_at
                      ? t('apply.button.upcoming', { time: when(data.apply_open_at) })
                      : t(`apply.button.${state === 'closed' ? 'closed' : 'notReady'}`)}
                  </Button>
                )}
              </div>
              {formUrl && (
                <div className={styles.qr}>
                  <QRCodeSVG
                    value={formUrl}
                    size={136}
                    marginSize={2}
                    fgColor="currentColor"
                    bgColor="transparent"
                    title={t('apply.qrTitle')}
                  />
                </div>
              )}
            </div>
          )
        })()}
    </Page>
  )
}
