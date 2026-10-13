import type { QueryKey } from '@tanstack/react-query'
import { useState } from 'react'
import { useReloadItem } from './mutation'
import { useForm } from './useForm'

interface Versioned {
  id: number
  version: number
}

/**
 * version 이 있는 항목의 편집 폼 (doc/Instruction.md 4.5).
 * - 열었을 때의 version 을 base 로 기억하고 그 값으로 저장한다.
 * - 더 새 version 이 목록에 들어오면 stale (다른 사람이 수정함).
 * - 409 를 받으면 목록을 다시 가져와 최신 값으로 폼을 채운다.
 */
export function useEditor<T extends Versioned, V extends object>({
  item,
  toValues,
  queryKey,
}: {
  item: T | undefined
  toValues: (item: T | undefined) => V
  queryKey: QueryKey
}) {
  const [base, setBase] = useState<T | undefined>(item)
  const form = useForm<V>(() => toValues(item))
  const [conflict, setConflict] = useState(false)
  const reloadItem = useReloadItem<T>(queryKey)

  const load = (latest: T) => {
    setBase(latest)
    form.reset(toValues(latest))
    setConflict(false)
  }

  const set = <K extends keyof V>(key: K, value: V[K]) => {
    form.set(key, value)
    setConflict(false)
  }

  /** 저장 성공: 응답을 새 기준으로 삼고 "저장됨"을 보인다 */
  const saved = (latest: T) => {
    setBase(latest)
    form.reset(toValues(latest))
    form.setSaved(true)
  }

  const handleConflict = async () => {
    if (!base) return
    const latest = await reloadItem(base.id)
    if (latest) {
      setBase(latest)
      form.reset(toValues(latest))
    }
    setConflict(true)
  }

  return {
    base,
    values: form.values,
    isSaved: form.saved,
    set,
    load,
    saved,
    conflict,
    handleConflict,
    stale: Boolean(item && base && item.version > base.version),
  }
}
