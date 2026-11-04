import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { TEST_SITE } from './testSite'

export function useDocumentTitle(title?: string) {
  const { t } = useTranslation()
  const site = t('brand.siteName')
  const prefix = TEST_SITE ? `${t('testSite.titlePrefix')} ` : ''
  useEffect(() => {
    document.title = prefix + (title ? `${title} | ${site}` : site)
  }, [title, site, prefix])
}
