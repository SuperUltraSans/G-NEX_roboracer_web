import type { Phase } from '../../api/types'
import type { LiveTab } from './LiveTabs'

/** 진행 단계에 맞는 탭: 맵핑 중이면 맵핑, 연습 중이면 연습, 본선 중이거나 끝났는데 대진이 있으면 본선 대진 */
export function phaseTab(phase: Phase | undefined, hasBracket: boolean): LiveTab {
  if (phase === 'mapping') return 'mapping'
  if (phase === 'practice' || phase === 'free_practice') return 'practice'
  return phase === 'bracket' || (phase === 'finished' && hasBracket) ? 'bracket' : 'qualifying'
}

/** 큰 화면에서 손으로 고른 탭과, 고를 때의 진행 단계 탭 */
export interface ManualTab {
  tab: LiveTab
  auto: LiveTab
}

/**
 * 큰 화면에서 손으로 고른 탭이 아직 유효한지. 진행 단계 탭이 고를 때와 달라지면 버린다(null).
 * 버린 뒤로는 다시 진행 단계를 따라간다(프로젝터에서 한 번 누른 탭에 계속 묶이지 않게).
 */
export function keepManual(manual: ManualTab | null, auto: LiveTab): ManualTab | null {
  return manual && manual.auto === auto ? manual : null
}
