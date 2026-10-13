import { useCallback, useState } from 'react'

/**
 * 편집 폼 상태. saved 는 마지막 저장 이후 값을 바꾸지 않았는지를 뜻한다.
 * "저장" 버튼은 saved 일 때 "저장됨"을 보여준다 (doc/Design.md 7.1).
 */
export function useForm<T extends object>(initial: T | (() => T)) {
  const [values, setValues] = useState<T>(initial)
  const [saved, setSaved] = useState(false)

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }, [])

  const reset = useCallback((next: T) => {
    setValues(next)
    setSaved(false)
  }, [])

  return { values, set, reset, saved, setSaved }
}
