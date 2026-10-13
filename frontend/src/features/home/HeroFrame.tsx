import { useRef, type ReactNode } from 'react'
import { useObserveHero } from '../../app/heroInView'
import styles from './HeroFrame.module.css'
import { HeroMedia } from './HeroMedia'
import { useHeroScroll } from './useHeroMotion'

interface Props {
  className?: string
  stageClassName?: string
  overlay?: ReactNode
  children: ReactNode
}

/** 히어로 틀: 배경, 스크림, 하단 페이드, 스크롤 연출 */
export function HeroFrame({ className, stageClassName, overlay, children }: Props) {
  const ref = useRef<HTMLElement>(null)
  useObserveHero(ref)
  useHeroScroll(ref)

  return (
    <section
      ref={ref}
      className={[styles.hero, className ?? ''].join(' ')}
      data-surface="dark"
      aria-labelledby="hero-title"
    >
      <HeroMedia />
      <div className={styles.scrim} />
      <div className={styles.fade} />
      {overlay}
      <div className={[styles.stage, stageClassName ?? ''].join(' ')}>
        <div className={styles.frame}>
          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </section>
  )
}
