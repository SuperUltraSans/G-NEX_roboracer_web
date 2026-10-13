import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import type { Lang } from '../lib/localized'
import { readStorage, writeStorage } from '../lib/storage'
import adminEn from './locales/admin.en.json'
import adminKo from './locales/admin.ko.json'
import en from './locales/en.json'
import ko from './locales/ko.json'

const STORAGE_KEY = 'rr.lang'

// 저장값 → 브라우저 언어가 ko로 시작하면 ko → 그 외 en (doc/Instruction.md 4.1)
function initialLang(): Lang {
  const stored = readStorage('local', STORAGE_KEY)
  if (stored === 'ko' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

void i18n.use(initReactI18next).init({
  // 관리자 문구는 별도 파일로 두고 admin.* 아래에 합친다
  resources: {
    ko: { translation: { ...ko, admin: adminKo } },
    en: { translation: { ...en, admin: adminEn } },
  },
  lng: initialLang(),
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
  returnNull: false,
})

document.documentElement.lang = i18n.language

i18n.on('languageChanged', (lang) => {
  document.documentElement.lang = lang
  writeStorage('local', STORAGE_KEY, lang)
})

export function useLang(): Lang {
  const { i18n: instance } = useTranslation()
  return instance.language === 'en' ? 'en' : 'ko'
}

export function setLang(lang: Lang) {
  void i18n.changeLanguage(lang)
}

export default i18n
