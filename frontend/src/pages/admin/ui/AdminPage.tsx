import type { ReactNode } from 'react'
import { useDocumentTitle } from '../../../app/useDocumentTitle'
import styles from './admin.module.css'

/** 관리자 화면 한 장: 제목, 안내문, 본문 */
export function AdminPage({
  title,
  lead,
  children,
}: {
  title: string
  lead?: ReactNode
  children: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {lead && <p className={styles.lead}>{lead}</p>}
      </header>
      {children}
    </div>
  )
}

export function Section({
  title,
  actions,
  children,
  id,
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  id?: string
}) {
  return (
    <section className={styles.section} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id={id ? `${id}-title` : undefined}>
          {title}
        </h2>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {children}
    </section>
  )
}
