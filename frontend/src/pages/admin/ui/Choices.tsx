import { useId, type ReactNode } from 'react'
import styles from './admin.module.css'

export interface ChoiceOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

/** 라디오 버튼 묶음. 휴대폰에서 한 번에 누를 수 있게 선택지를 크게 늘어놓는다. */
export function Choices<T extends string>({
  legend,
  value,
  options,
  onChange,
  hint,
  name,
}: {
  legend: ReactNode
  value: T
  options: readonly ChoiceOption<T>[]
  onChange: (value: T) => void
  hint?: ReactNode
  name?: string
}) {
  const autoName = useId()
  const hintId = `${autoName}-hint`
  return (
    <fieldset className={styles.choices} aria-describedby={hint ? hintId : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.choiceList}>
        {options.map((option) => (
          <label key={option.value} className={styles.choice}>
            <input
              type="radio"
              name={name ?? autoName}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint && (
        <p id={hintId} className={styles.choiceHint}>
          {hint}
        </p>
      )}
    </fieldset>
  )
}
