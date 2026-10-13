import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import styles from './Field.module.css'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export function TextField({ label, hint, error, className, ...rest }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={[styles.control, className ?? ''].join(' ')}
          {...rest}
        />
      )}
    </Field>
  )
}

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export function TextArea({ label, hint, error, className, ...rest }: AreaProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={[styles.control, styles.area, className ?? ''].join(' ')}
          {...rest}
        />
      )}
    </Field>
  )
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export function SelectField({ label, hint, error, className, children, ...rest }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={[styles.control, className ?? ''].join(' ')}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  )
}

export function Checkbox({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  )
}
