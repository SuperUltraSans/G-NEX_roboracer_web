export type Lang = 'ko' | 'en'

type LocalizedFields<K extends string> = Partial<Record<`${K}_ko` | `${K}_en`, string | null>>

// DB 콘텐츠는 title_ko/title_en 같은 언어별 컬럼 쌍이다. 영어 값이 비어 있으면 한국어로 대체한다.
export function pickLocalized<K extends string>(
  obj: LocalizedFields<K> | null | undefined,
  field: K,
  lang: Lang,
): string | null {
  if (!obj) return null
  const preferred = obj[`${field}_${lang}`]
  if (preferred && preferred.trim()) return preferred
  const fallback = obj[`${field}_ko`]
  return fallback && fallback.trim() ? fallback : null
}
