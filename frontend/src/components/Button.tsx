import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import styles from './Button.module.css'

export type ButtonVariant =
  'primary' | 'secondary' | 'quiet' | 'danger' | 'darkPrimary' | 'darkOutline'

interface Common {
  variant?: ButtonVariant
  block?: boolean
  children: ReactNode
}

function classes(variant: ButtonVariant, block: boolean | undefined, extra?: string) {
  return [styles.button, styles[variant], block ? styles.block : '', extra ?? ''].join(' ').trim()
}

export function Button({
  variant = 'secondary',
  block,
  className,
  type = 'button',
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={classes(variant, block, className)} {...rest} />
}

export function ButtonLink({
  variant = 'secondary',
  block,
  className,
  ...rest
}: Common & LinkProps) {
  return <Link className={classes(variant, block, className)} {...rest} />
}

export function ButtonAnchor({
  variant = 'secondary',
  block,
  className,
  ...rest
}: Common & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={classes(variant, block, className)} {...rest} />
}
