// 목록 줄에서 쓰는 작은 조작: 아이콘 버튼, 켜고 끄는 스위치, 접는 도움말
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './admin.module.css'
import { Icon, type IconName } from './Icon'

/** 아이콘만 있는 작은 버튼. 이름은 화면 읽기 프로그램과 마우스를 올렸을 때 보인다 */
export function IconButton({
  icon,
  label,
  tone,
  ...rest
}: {
  icon: IconName
  label: string
  tone?: 'danger'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'>) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      data-tone={tone}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}

/** 켜고 끄는 스위치. 지금 상태를 글로도 보인다 (예: 공개 / 비공개) */
export function Switch({
  checked,
  onChange,
  label,
  onText,
  offText,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** 무엇을 켜고 끄는지 (화면 읽기 프로그램용 이름) */
  label: string
  onText: string
  offText: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={styles.switch}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      <span className={styles.switchText}>{checked ? onText : offText}</span>
    </button>
  )
}

/** 길게 설명할 것은 접어 둔다 */
export function Help({ children, title }: { children: ReactNode; title?: string }) {
  const { t } = useTranslation()
  return (
    <details className={styles.help}>
      <summary>{title ?? t('admin.common.help')}</summary>
      <div className={styles.helpBody}>{children}</div>
    </details>
  )
}
