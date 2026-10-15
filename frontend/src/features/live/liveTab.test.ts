import { describe, expect, it } from 'vitest'
import { keepManual, phaseTab, type ManualTab } from './liveTab'

describe('phaseTab', () => {
  it('본선 중이거나 끝났는데 대진이 있으면 본선 대진, 그 밖에는 예선 리더보드', () => {
    expect(phaseTab('bracket', false)).toBe('bracket')
    expect(phaseTab('finished', true)).toBe('bracket')
    expect(phaseTab('finished', false)).toBe('qualifying')
    expect(phaseTab('qualifying', true)).toBe('qualifying')
    expect(phaseTab('break', true)).toBe('qualifying')
    expect(phaseTab(undefined, true)).toBe('qualifying')
  })
})

describe('keepManual', () => {
  const manual: ManualTab = { tab: 'qualifying', auto: 'bracket' }

  it('진행 단계 탭이 그대로인 동안은 손으로 고른 탭을 유지한다', () => {
    expect(keepManual(manual, 'bracket')).toBe(manual)
    expect(keepManual(null, 'bracket')).toBeNull()
  })

  it('진행 단계 탭이 바뀌면 버리고, 단계가 되돌아와도 되살아나지 않는다', () => {
    // 본선 중에 예선 탭을 고름 → 운영진이 예선으로 → 다시 본선으로
    const afterQualifying = keepManual(manual, 'qualifying')
    expect(afterQualifying).toBeNull()
    expect(keepManual(afterQualifying, 'bracket')).toBeNull()
  })
})
