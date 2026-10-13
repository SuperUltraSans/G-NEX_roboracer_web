/** 목록에서 index 의 항목을 한 칸 옮긴 전체 id 순서 */
export function movedIds(ids: number[], index: number, direction: -1 | 1): number[] | null {
  const target = index + direction
  if (target < 0 || target >= ids.length) return null
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
