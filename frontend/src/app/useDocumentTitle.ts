import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function useDocumentTitle(title?: string) {
  const { t } = useTranslation()
  const site = t('brand.siteName')
  useEffect(() => {
    document.title = title ? `${title} | ${site}` : site
  }, [title, site])
}
