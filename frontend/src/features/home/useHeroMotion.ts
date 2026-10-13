import { useEffect, useState, type RefObject } from 'react'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 스크롤에 따라 히어로 텍스트가 살짝 올라가며 옅어진다. --hero-scroll(0~1)만 갱신한다. */
export function useHeroScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current
    if (!element || reducedMotion()) return
    let frame = 0
    const update = () => {
      frame = 0
      const progress = Math.min(1, Math.max(0, window.scrollY / element.offsetHeight))
      element.style.setProperty('--hero-scroll', progress.toFixed(3))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [ref])
}

// 로드 연출은 페이지를 처음 열 때 한 번만 재생한다. 다른 탭에서 돌아왔을 때는 다시 재생하지 않는다.
let introPlayed = false

export function useIntroOnce(): boolean {
  const [play] = useState(() => !introPlayed && !reducedMotion())
  useEffect(() => {
    introPlayed = true
  }, [])
  return play
}
