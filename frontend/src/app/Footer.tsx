import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import styles from './Footer.module.css'

export function Footer() {
  const { t } = useTranslation()
  return (
    <footer className={styles.footer} data-surface="dark">
      <div className={styles.inner}>
        <dl className={styles.facts}>
          <div>
            <dt>{t('footer.hostLabel')}</dt>
            <dd>{t('footer.host')}</dd>
          </div>
          <div>
            <dt>{t('footer.contactLabel')}</dt>
            <dd>
              {t('footer.contact')}
              <span className={styles.contactLine}>
                <span>
                  {t('footer.phoneLabel')}{' '}
                  <a href={`tel:${t('footer.phone').replaceAll('-', '')}`}>{t('footer.phone')}</a>
                </span>
                <span>
                  {t('footer.emailLabel')}{' '}
                  <a href={`mailto:${t('footer.email')}`}>{t('footer.email')}</a>
                </span>
              </span>
            </dd>
          </div>
        </dl>
        <Link to="/admin" className={styles.admin}>
          {t('footer.admin')}
        </Link>
      </div>
    </footer>
  )
}
