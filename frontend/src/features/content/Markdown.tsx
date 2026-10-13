import { lazy, Suspense } from 'react'

// Markdown 뷰어는 규칙 페이지와 관리자 미리보기에서만 쓰므로 따로 불러온다
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'))

export function Markdown({ children, idPrefix }: { children: string; idPrefix?: string }) {
  return (
    <Suspense fallback={<div style={{ whiteSpace: 'pre-wrap' }}>{children}</div>}>
      <MarkdownRenderer idPrefix={idPrefix}>{children}</MarkdownRenderer>
    </Suspense>
  )
}
