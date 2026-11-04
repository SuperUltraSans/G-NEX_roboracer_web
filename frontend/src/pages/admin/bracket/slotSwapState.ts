import { createContext, useContext, type DragEvent } from 'react'

/** drag: 마우스로 끄는 중, pick: 옮기기 버튼으로 골라 두고 바꿀 칸을 누르기를 기다리는 중 */
export type Moving = { slotId: number; by: 'drag' | 'pick' }

export interface SlotSwap {
  moving: Moving | null
  /** 끌어서 올려 둔 칸 */
  over: number | null
  /** 방금 자리를 바꾼 칸 (다음 동작 전까지 표시) */
  swapped: number[]
  start: (slotId: number, by: Moving['by']) => void
  hover: (slotId: number | null) => void
  cancel: () => void
  /** 옮기는 칸을 이 칸과 바꾸겠다고 고른다 → 확인 창 */
  drop: (targetId: number) => void
}

export const SlotSwapContext = createContext<SlotSwap | null>(null)

/** 관리자 화면 대진 구성에서만 있다 (결과 입력 화면에서는 null) */
export function useSlotSwap(): SlotSwap | null {
  return useContext(SlotSwapContext)
}

/** 칸 하나에 붙이는 끌어 놓기 이벤트. 끝난 매치의 칸은 끌 수도 놓을 수도 없다 */
export function slotDragProps(swap: SlotSwap, slotId: number) {
  const target = swap.moving?.by === 'drag' && swap.moving.slotId !== slotId
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(slotId))
      swap.start(slotId, 'drag')
    },
    onDragEnd: () => {
      if (swap.moving?.by === 'drag') swap.cancel()
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!target) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (swap.over !== slotId) swap.hover(slotId)
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (swap.over === slotId && !event.currentTarget.contains(event.relatedTarget as Node)) {
        swap.hover(null)
      }
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!target) return
      event.preventDefault()
      swap.drop(slotId)
    },
  }
}
