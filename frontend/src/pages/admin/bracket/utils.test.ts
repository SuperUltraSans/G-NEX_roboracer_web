import { describe, expect, it } from 'vitest'
import type { Bracket, BracketMatch, BracketSlot, TeamPublic } from '../../../api/types'
import { findSlot, swapPreview } from './utils'

const team = (id: number): TeamPublic => ({
  id,
  name_ko: `팀${id}`,
  name_en: `Team ${id}`,
  affiliation_ko: null,
  affiliation_en: null,
})

const slot = (id: number, index: number, fill: Partial<BracketSlot>): BracketSlot => ({
  id,
  slot_index: index,
  team: null,
  seed_rank: null,
  source_match_id: null,
  source_match_label: null,
  source_rank: null,
  placeholder_ko: null,
  placeholder_en: null,
  result_rank: null,
  result_text: null,
  ...fill,
})

const match = (id: number, slots: BracketSlot[]): BracketMatch => ({
  id,
  round_id: 1,
  label: `Race ${id}`,
  sort_order: id,
  status: 'scheduled',
  scheduled_at: null,
  version: 1,
  slots,
})

const bracket: Bracket = {
  rounds: [
    {
      id: 1,
      name_ko: '8강',
      name_en: '',
      sort_order: 1,
      matches: [
        // 칸 순서와 배열 순서가 달라도 칸 순서로 보여 준다
        match(3, [
          slot(32, 1, { source_match_id: 1, source_match_label: 'Race 1', source_rank: 1 }),
          slot(31, 0, { team: team(1), seed_rank: 1 }),
        ]),
        match(5, [
          slot(51, 0, { team: team(2), seed_rank: 2 }),
          slot(52, 1, { team: team(7), seed_rank: 7, placeholder_ko: '와일드카드' }),
        ]),
      ],
    },
  ],
}

describe('swapPreview', () => {
  it('팀과 함께 채우는 방법(시드·앞 경기·자리표시)을 옮긴다', () => {
    const [race3, race5] = swapPreview(bracket, 32, 52)
    expect(race3.match.label).toBe('Race 3')
    expect(race3.before.map((s) => s.id)).toEqual([31, 32])
    expect(race3.after[1]).toMatchObject({
      id: 32,
      slot_index: 1,
      team: team(7),
      seed_rank: 7,
      source_match_id: null,
      source_rank: null,
      placeholder_ko: '와일드카드',
    })
    expect(race3.changed).toEqual([32])
    expect(race5.after[1]).toMatchObject({
      id: 52,
      team: null,
      seed_rank: null,
      source_match_id: 1,
      source_match_label: 'Race 1',
      source_rank: 1,
      placeholder_ko: null,
    })
    // 원래 대진은 건드리지 않는다
    expect(findSlot(bracket, 52)?.slot.team).toEqual(team(7))
  })

  it('같은 매치 안이면 그 매치 하나만, 칸 순서만 바뀐다', () => {
    const changes = swapPreview(bracket, 51, 52)
    expect(changes).toHaveLength(1)
    expect(changes[0].after.map((s) => s.team?.id)).toEqual([7, 2])
    expect(changes[0].changed).toEqual([51, 52])
  })

  it('같은 칸이거나 없는 칸이면 바꿀 것이 없다', () => {
    expect(swapPreview(bracket, 31, 31)).toEqual([])
    expect(swapPreview(bracket, 31, 999)).toEqual([])
    expect(swapPreview(undefined, 31, 32)).toEqual([])
  })
})
