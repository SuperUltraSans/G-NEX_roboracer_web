import { describe, expect, it } from 'vitest'
import { normalizeTableCells } from './normalizeTables'

describe('normalizeTableCells', () => {
  it('joins a multi-line cell into one row with <br>', () => {
    const input = [
      '| 순서 | 시간 | 내용 |',
      '| --- | --- | --- |',
      '| 3 | 13:30~14:30 | 더미 순서 |',
      '| 4 | 14:30~20:00 | 14:30~15:00 더미 연습 ',
      '15:00~16:00 더미 A조',
      '16:00~17:00 더미 B조 |',
      '',
      '다음 문단',
    ].join('\n')
    expect(normalizeTableCells(input)).toBe(
      [
        '| 순서 | 시간 | 내용 |',
        '| --- | --- | --- |',
        '| 3 | 13:30~14:30 | 더미 순서 |',
        '| 4 | 14:30~20:00 | 14:30~15:00 더미 연습<br>15:00~16:00 더미 A조<br>16:00~17:00 더미 B조 |',
        '',
        '다음 문단',
      ].join('\n'),
    )
  })

  it('leaves well-formed tables, plain text and code fences alone', () => {
    const input = [
      '문단 | 파이프가 있지만 표가 아님',
      '```',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2',
      '3 |',
      '```',
      '| a | b |',
      '|:--|--:|',
      '| 1 | 2 |',
    ].join('\n')
    expect(normalizeTableCells(input)).toBe(input)
  })
})
