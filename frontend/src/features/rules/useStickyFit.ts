import { useEffect, useState } from 'react'

/** 옆에 고정한 목차가 화면 아래로 넘어가지 않게 둘 아래쪽 여백(px) */
const BOTTOM_GAP = 24
/** 목차가 이보다 낮아지지는 않게 한다(px) */
const MIN_HEIGHT = 160

/**
 * 옆에 고정(sticky)한 목차의 높이를 지금 화면에 실제로 보이는 공간에 맞춘다.
 *
 * CSS 만으로는 고정된 뒤의 높이(화면 높이 - 머리 막대)로만 정할 수 있어서, 페이지 맨 위처럼 목차가
 * 제목 아래에서 시작할 때는 아래가 화면 밖으로 넘어가 마지막 항목이 잘리고, 페이지 맨 아래에서는
 * 위가 화면 위로 밀려 첫 항목이 가려졌다. 스크롤·크기 변경 때마다 목차가 놓일 위치(고정 위치와
 * 본래 위치 중 아래쪽)부터 화면 아래(또는 본문 영역 끝)까지로 높이를 다시 정한다.
 */
export function useStickyFit(
  element: HTMLElement | null,
  area: HTMLElement | null,
): number | undefined {
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!element || !area) return
    let frame = 0
    const update = () => {
      frame = 0
      const style = getComputedStyle(element)
      // 좁은 화면에서는 목차를 고정하지 않으므로 높이도 정하지 않는다
      if (style.position !== 'sticky') return setMaxHeight(undefined)
      const stickyTop = parseFloat(style.top) || 0
      const box = area.getBoundingClientRect()
      const top = Math.max(box.top, stickyTop)
      const bottom = Math.min(window.innerHeight - BOTTOM_GAP, box.bottom)
      setMaxHeight(Math.max(MIN_HEIGHT, Math.floor(bottom - top)))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // 본문(규칙)이 늦게 그려지며 영역 높이가 바뀌어도 다시 맞춘다
    const observer = new ResizeObserver(schedule)
    observer.observe(area)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [element, area])

  return maxHeight
}
