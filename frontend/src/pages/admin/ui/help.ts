import { useTranslation } from 'react-i18next'

/** 번역 파일의 문단 목록(배열)을 읽는다. 페이지 '도움말'에 쓴다 */
export function useHelp(key: string): string[] {
  const { t } = useTranslation()
  const value: unknown = t(key, { returnObjects: true })
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}
