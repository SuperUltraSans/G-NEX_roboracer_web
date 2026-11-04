import { createContext, useContext } from 'react'

export interface PreviewMode {
  /** 관리자가 미리보기를 켜고 보고 있다: 공개 API 대신 미리보기(초안) API 를 쓴다 */
  active: boolean
  /** 페이지를 닫아 두었어도 실제 화면을 보인다 (미리보기는 늘 내용을 보여 준다) */
  showClosed: boolean
  /** 규칙 그림을 미리보기 주소로 받는다 (미리보기, 관리자 화면) — 규칙 페이지가 닫혀 있어도 보이게 */
  draftFiles: boolean
}

export const PreviewContext = createContext<PreviewMode>({
  active: false,
  showClosed: false,
  draftFiles: false,
})

export function usePreviewMode(): PreviewMode {
  return useContext(PreviewContext)
}
