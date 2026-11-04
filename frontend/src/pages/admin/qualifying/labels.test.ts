import { describe, expect, it } from 'vitest'
import type { LeaderboardRow, TeamPublic } from '../../../api/types'
import { byRunOrder, parseInspectionOrders } from './labels'

const team = (id: number): TeamPublic => ({
  id,
  name_ko: `팀 ${id}`,
  name_en: `Team ${id}`,
  affiliation_ko: null,
  affiliation_en: null,
})
const row = (id: number, run_order: number | null) =>
  ({ team: team(id), run_order }) as unknown as LeaderboardRow

describe('byRunOrder', () => {
  it('예선 출전 순서대로, 순서가 없는 팀은 뒤에 팀 번호 순으로', () => {
    const teams = [1, 2, 3, 4, 5].map(team)
    const rows = [row(1, 3), row(2, null), row(3, 1), row(5, 2)]
    expect(byRunOrder(teams, rows).map((t) => t.id)).toEqual([3, 5, 1, 2, 4])
  })

  it('리더보드가 없으면 팀 번호 순', () => {
    expect(byRunOrder([3, 1, 2].map(team), undefined).map((t) => t.id)).toEqual([1, 2, 3])
  })
})

describe('parseInspectionOrders', () => {
  it('빈 칸은 빼고, 범위 밖·정수 아닌 칸과 같은 번호를 찾는다', () => {
    const check = parseInspectionOrders(
      [
        [1, '2'],
        [2, ' '],
        [3, '2'],
        [4, '1.5'],
        [5, '16'],
        [6, '1'],
      ],
      15,
    )
    expect([...check.orders]).toEqual([
      [1, 2],
      [3, 2],
      [6, 1],
    ])
    expect([...check.bad]).toEqual([4, 5])
    expect([...check.taken]).toEqual([1, 3])
    expect(check.takenNumbers).toEqual([2])
  })
})
