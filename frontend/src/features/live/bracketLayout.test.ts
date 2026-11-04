import { describe, expect, it } from 'vitest'
import type { BracketRound, BracketSlot } from '../../api/types'
import { isPlacementRound, splitRounds, winnerLinks } from './bracketLayout'

let nextId = 1
const slot = (source: { seed?: number; match?: number; rank?: number }): BracketSlot => ({
  id: nextId++,
  slot_index: 0,
  team: null,
  seed_rank: source.seed ?? null,
  source_match_id: source.match ?? null,
  source_match_label: source.match ? `Race ${source.match}` : null,
  source_rank: source.rank ?? null,
  placeholder_ko: null,
  placeholder_en: null,
  result_rank: null,
  result_text: null,
})
const round = (id: number, sortOrder: number, slots: BracketSlot[][]): BracketRound => ({
  id,
  name_ko: `라운드 ${id}`,
  name_en: '',
  sort_order: sortOrder,
  matches: slots.map((matchSlots, index) => ({
    id: id * 100 + index,
    round_id: id,
    label: `Race ${id * 100 + index}`,
    sort_order: index + 1,
    status: 'scheduled',
    scheduled_at: null,
    version: 1,
    slots: matchSlots,
  })),
})

describe('isPlacementRound', () => {
  it('is true only when every slot takes a loser', () => {
    expect(
      isPlacementRound(round(1, 1, [[slot({ match: 7, rank: 2 }), slot({ match: 8, rank: 2 })]])),
    ).toBe(true)
    expect(
      isPlacementRound(round(2, 1, [[slot({ match: 7, rank: 1 }), slot({ match: 8, rank: 1 })]])),
    ).toBe(false)
    expect(isPlacementRound(round(3, 1, [[slot({ seed: 1 }), slot({ match: 2, rank: 1 })]]))).toBe(
      false,
    )
    expect(isPlacementRound(round(4, 1, [[slot({ match: 3, rank: 2 }), slot({ seed: 9 })]]))).toBe(
      false,
    )
  })

  it('treats an empty round as part of the main bracket', () => {
    expect(isPlacementRound(round(5, 1, []))).toBe(false)
  })
})

describe('splitRounds', () => {
  it('keeps sort order within the main bracket and the placement matches', () => {
    const final = round(4, 4, [[slot({ match: 7, rank: 1 }), slot({ match: 8, rank: 1 })]])
    const third = round(5, 5, [[slot({ match: 7, rank: 2 }), slot({ match: 8, rank: 2 })]])
    const fifth = round(6, 6, [
      [slot({ match: 3, rank: 2 }), slot({ match: 4, rank: 2 })],
      [slot({ match: 5, rank: 2 }), slot({ match: 6, rank: 2 })],
    ])
    const playIn = round(1, 1, [[slot({ seed: 8 }), slot({ seed: 9 })]])
    const { main, placement } = splitRounds([fifth, final, third, playIn])
    expect(main.map((r) => r.id)).toEqual([1, 4])
    expect(placement.map((r) => r.id)).toEqual([5, 6])
  })
})

describe('winnerLinks', () => {
  it('links only winners within the given rounds and marks finished sources', () => {
    const qf = round(2, 2, [[slot({ seed: 1 }), slot({ seed: 8 })]])
    qf.matches[0].status = 'finished'
    const sf = round(3, 3, [
      [slot({ match: qf.matches[0].id, rank: 1 }), slot({ match: 999, rank: 1 })],
    ])
    const third = round(4, 4, [[slot({ match: qf.matches[0].id, rank: 2 }), slot({ seed: 3 })]])
    expect(winnerLinks([qf, sf, third])).toEqual([
      { from: qf.matches[0].id, slot: sf.matches[0].slots[0].id, done: true },
    ])
  })
})
