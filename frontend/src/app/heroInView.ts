import { createContext, useContext, useEffect, type RefObject } from 'react'

// 소개 페이지의 히어로가 화면에 보이는 동안 헤더를 투명하게 둔다 (doc/Design.md 6.5).
export const HeroInViewContext = createContext<{
  heroInView: boolean
  setHeroInView: (value: boolean) => void
}>({ heroInView: false, setHeroInView: () => {} })

export function useHeroInView(): boolean {
  return useContext(HeroInViewContext).heroInView
}

export function useObserveHero(ref: RefObject<HTMLElement | null>) {
  const { setHeroInView } = useContext(HeroInViewContext)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const headerHeight = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h'),
      10,
    )
    const observer = new IntersectionObserver(([entry]) => setHeroInView(entry.isIntersecting), {
      rootMargin: `-${headerHeight || 0}px 0px 0px 0px`,
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      setHeroInView(false)
    }
  }, [ref, setHeroInView])
}
