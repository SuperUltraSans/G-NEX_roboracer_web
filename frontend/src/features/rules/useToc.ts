import { useEffect, useState } from 'react'

export interface TocEntry {
  id: string
  text: string
  level: 1 | 2 | 3
}

const SELECTOR = '[data-toc-section], [data-toc]'

/** 섹션 제목은 자기 단계(장 1, 절 2), 본문의 큰 제목은 그 섹션보다 한 단계 아래 */
function tocLevel(element: HTMLElement): TocEntry['level'] {
  const own = Number(element.dataset.level)
  if (element.hasAttribute('data-toc-section')) return own === 2 ? 2 : 1
  const section = Number(element.closest<HTMLElement>('[data-level]')?.dataset.level ?? 1)
  return section >= 2 ? 3 : 2
}

function collect(root: HTMLElement): TocEntry[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)]
    .filter((element) => element.id)
    .map((element) => ({
      id: element.id,
      text: element.textContent?.trim() ?? '',
      level: tocLevel(element),
    }))
}

/**
 * 렌더된 문서에서 목차를 만든다. 본문은 뷰어가 늦게 불러와 그리므로 DOM 변화를 지켜본다.
 * 장 제목이 1단계, 절 제목이 2단계(장이 없으면 1단계), 본문의 큰 제목(data-toc)이 그 아래 단계다.
 */
export function useToc(root: HTMLElement | null): TocEntry[] {
  const [entries, setEntries] = useState<TocEntry[]>([])

  useEffect(() => {
    if (!root) return
    let frame = 0
    const update = () => {
      frame = 0
      const next = collect(root)
      setEntries((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [root])

  return entries
}

/** 지금 화면 위쪽에 걸린 목차 항목 id (읽는 위치 표시) */
export function useActiveHeading(entries: TocEntry[]): string | null {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (entries.length === 0) return
    const headerHeight = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h'),
      10,
    )
    let frame = 0
    const update = () => {
      frame = 0
      const offset = (headerHeight || 0) + 24
      let current: string | null = null
      for (const entry of entries) {
        const element = document.getElementById(entry.id)
        if (element && element.getBoundingClientRect().top - offset <= 0) current = entry.id
      }
      setActive(current ?? entries[0].id)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [entries])

  return active
}
