import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '../app/useDocumentTitle'
import { ButtonLink } from '../components/Button'
import { Page } from '../components/Page'

export function NotFoundPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('notFound.title'))
  return (
    <Page title={t('notFound.title')} lead={t('notFound.body')}>
      <ButtonLink to="/" variant="secondary">
        {t('notFound.home')}
      </ButtonLink>
    </Page>
  )
}
