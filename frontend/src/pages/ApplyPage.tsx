import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { Button, ButtonAnchor } from '../components/Button'
import { Page } from '../components/Page'
import { ErrorState, Loading } from '../components/StateView'
import { applyState } from '../features/apply/applyState'
import { usePublicSettings } from '../features/content/hooks'
import { useLang } from '../i18n'
import { formatDateTime } from '../lib/time'
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
      <p className={styles.body}>{t('apply.body')}</p>
      {settings.isPending && <Loading />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data &&
        (() => {
          const data = settings.data
          const state = applyState(data, now)
          const timezone = data.event_timezone
          const when = (iso: string) => formatDateTime(iso, timezone, lang)
          return (
            <div className={styles.panel} data-state={state}>
              <p className={styles.status}>
                <span className={styles.statusLabel}>{t('apply.statusLabel')}</span>
                <span className={styles.statusValue}>{t(`apply.status.${state}`)}</span>
              </p>
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
              <dl className={styles.period}>
                <dt>{t('apply.periodLabel')}</dt>
                <dd>
                  {data.apply_open_at || data.apply_close_at ? (
                    <>
                      {data.apply_open_at && (
                        <span className="num">
                          {t('apply.from', { time: when(data.apply_open_at) })}
                        </span>
                      )}{' '}
                      {data.apply_close_at && (
                        <span className="num">
                          {t('apply.to', { time: when(data.apply_close_at) })}
                        </span>
                      )}
                    </>
                  ) : (
                    t('apply.periodUnset')
                  )}
                </dd>
              </dl>
            </div>
          )
        })()}
    </Page>
  )
}
