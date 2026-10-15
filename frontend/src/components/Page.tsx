import type { ReactNode } from 'react'
import styles from './Page.module.css'

/** 히어로가 없는 공개 페이지의 공통 틀: 제목, 선택적 안내문, 본문 */
export function Page({
  title,
  lead,
  aside,
  children,
}: {
  title: ReactNode
  lead?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
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
