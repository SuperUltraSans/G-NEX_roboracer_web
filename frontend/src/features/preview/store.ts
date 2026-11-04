import { useSyncExternalStore } from 'react'

/**
 * 미리보기(게시하지 않은 일정·규칙·사이트 설정을 공개 화면 모습으로 보기)를 켰는지.
 * 이 탭에만 둔다(sessionStorage). 저장소를 못 쓰면 메모리에만 두고, 새로고침하면 꺼진다.
 */
export interface PreviewSettings {
  enabled: boolean
}

const KEY = 'rr-preview'
const OFF: PreviewSettings = { enabled: false }

function read(): PreviewSettings {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as unknown
    if (raw && typeof raw === 'object') {
      const value = raw as Partial<PreviewSettings>
      return { enabled: value.enabled === true }
    }
  } catch {
    // 저장소를 못 쓰면 꺼진 것으로 본다
  }
  return OFF
}

let current: PreviewSettings = read()
const listeners = new Set<() => void>()

export function setPreview(patch: Partial<PreviewSettings>): void {
  current = { ...current, ...patch }
  if (!current.enabled) current = OFF
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // 메모리에만 둔다
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePreviewSettings(): PreviewSettings {
  return useSyncExternalStore(subscribe, () => current)
}
