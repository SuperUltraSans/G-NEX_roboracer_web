import type { ReactNode } from 'react'
import { useDocumentTitle } from '../../../app/useDocumentTitle'
import styles from './admin.module.css'
import { Help } from './Controls'

/** 관리자 화면 한 장: 제목, 안내문, (오른쪽) 주요 버튼, 본문 */
export function AdminPage({
  title,
  lead,
  help,
  actions,
  children,
}: {
  title: string
  /** 한 줄 설명 */
  lead?: ReactNode
  /** 더 긴 설명은 '도움말' 아래에 접어 둔다 (문단마다 한 줄) */
  help?: readonly string[]
  actions?: ReactNode
  children: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
          {help && help.length > 0 && (
            <Help>
              {help.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </Help>
          )}
        </div>
        {actions && <div className={styles.pageActions}>{actions}</div>}
      </header>
      {children}
    </div>
  )
}

/** 대시보드·설정에서 쓰는 테두리 상자: 제목, 설명, 본문, 아래쪽 버튼 */
export function Card({
  id,
  title,
  description,
  footer,
  children,
  wide,
}: {
  /** 주소의 #id 로 바로 가는 상자 */
  id?: string
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  wide?: boolean
}) {
  return (
    <section
      id={id}
      className={styles.card}
      data-wide={wide ? '' : undefined}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <h2 className={styles.cardTitle} id={id ? `${id}-title` : undefined}>
        {title}
      </h2>
      {description && <p className={styles.cardDescription}>{description}</p>}
      {children}
      {footer && <div className={styles.cardFooter}>{footer}</div>}
    </section>
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
