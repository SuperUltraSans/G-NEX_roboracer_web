import { apiUrl } from '../../api/client'

/**
 * 규칙 문서의 그림 경로를 서버의 규칙 파일 주소로 바꾼다.
 * 서버는 업로드한 패키지(zip)의 그림을 패키지 루트 기준 절대경로(/images/a.png)로 저장하고
 * /api/rules/files/ 아래에서 제공한다. 상대경로(a.png)도 패키지 루트 기준으로 본다.
 */
export function ruleFileUrl(src: string): string {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) {
    return src
  }
  return apiUrl(`/api/rules/files/${src.replace(/^\.?\//, '')}`)
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif)$/i

/** 문서 안의 링크가 패키지의 그림을 가리키면 그림 주소로 바꾼다 (/images/a.png 같은 링크가 사이트 페이지로 가지 않게) */
export function ruleLinkUrl(href: string): string {
  const path = href.split(/[?#]/)[0]
  return IMAGE_EXTENSION.test(path) ? ruleFileUrl(href) : href
}
