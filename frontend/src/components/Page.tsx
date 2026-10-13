import type { ReactNode } from 'react'
import styles from './Page.module.css'

/** 히어로가 없는 공개 페이지의 공통 틀: 제목, 선택적 안내문, 본문 */
export function Page({
  title,
  lead,
  aside,
  wide,
  children,
}: {
  title: ReactNode
  lead?: ReactNode
  aside?: ReactNode
  /** 문서처럼 폭이 넓을수록 좋은 페이지 (규칙) */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={wide ? `${styles.page} ${styles.wide}` : styles.page}>
      <header className={styles.header}>
        <h1 className={`display ${styles.title}`}>{title}</h1>
        {lead && <p className={styles.lead}>{lead}</p>}
        {aside}
      </header>
      {children}
    </div>
  )
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.container, className ?? ''].join(' ')}>{children}</div>
}
