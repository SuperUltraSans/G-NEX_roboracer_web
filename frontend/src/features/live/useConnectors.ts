import { useLayoutEffect, useState } from 'react'
import type { WinnerLink } from './bracketLayout'

export interface Connector {
  key: string
  /** SVG path: 앞 경기 블록 오른쪽 가운데 → 가운데에서 꺾어 → 받는 칸 왼쪽 */
  d: string
  done: boolean
}

/** 가로 선이 이보다 짧으면(좁은 화면 등에서 열이 붙으면) 그리지 않는다 */
const MIN_RUN = 16

/** 대진 블록의 실제 위치를 재서 화살표 경로를 만든다. 블록 크기나 위치가 바뀌면 다시 잰다. */
export function useConnectors(board: HTMLElement | null, links: WinnerLink[]): Connector[] {
  const [connectors, setConnectors] = useState<Connector[]>([])

  useLayoutEffect(() => {
    if (!board) return
    const measure = () => {
      const box = board.getBoundingClientRect()
      const next: Connector[] = []
      for (const link of links) {
        const from = board.querySelector(`[data-match-id="${link.from}"]`)
        const to = board.querySelector(`[data-slot-id="${link.slot}"]`)
        if (!from || !to) continue
        const a = from.getBoundingClientRect()
        const b = to.getBoundingClientRect()
        const x1 = Math.round(a.right - box.left)
        const x2 = Math.round(b.left - box.left)
        if (x2 - x1 < MIN_RUN) continue
        const y1 = Math.round(a.top + a.height / 2 - box.top)
        const y2 = Math.round(b.top + b.height / 2 - box.top)
        const xm = Math.round((x1 + x2) / 2)
        next.push({
          key: `${link.from}-${link.slot}`,
          d: `M${x1} ${y1}H${xm}V${y2}H${x2}`,
          done: link.done,
        })
      }
      setConnectors((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(board)
    board.querySelectorAll('[data-match-id]').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [board, links])

  return connectors
}
