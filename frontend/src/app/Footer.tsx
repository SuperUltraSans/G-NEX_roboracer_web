import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import styles from './Footer.module.css'

export function Footer({ wide = false }: { wide?: boolean }) {
  const { t } = useTranslation()
  return (
    <footer className={styles.footer} data-surface="dark">
      <div className={wide ? `${styles.inner} ${styles.wide}` : styles.inner}>
        <dl className={styles.facts}>
          <div>
            <dt>{t('footer.hostLabel')}</dt>
            <dd>{t('footer.host')}</dd>
          </div>
          <div>
            <dt>{t('footer.contactLabel')}</dt>
            <dd>{t('footer.contact')}</dd>
          </div>
        </dl>
        <Link to="/admin" className={styles.admin}>
          {t('footer.admin')}
        </Link>
      </div>
    </footer>
  )
}
