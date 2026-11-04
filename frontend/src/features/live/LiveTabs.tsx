import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './LiveTabs.module.css'

export type LiveTab = 'mapping' | 'practice' | 'qualifying' | 'bracket'

const TABS: LiveTab[] = ['mapping', 'practice', 'qualifying', 'bracket']

interface Props {
  selected: LiveTab
  onSelect: (tab: LiveTab) => void
  /** 지금 진행 중인 쪽에 "진행 중" 표시를 붙인다 */
  live: Record<LiveTab, boolean>
  /** 탭 줄 오른쪽 끝에 둘 것 (큰 화면 전환 링크) */
  end?: ReactNode
  children: ReactNode
}

/**
 * 맵핑 / 연습 / 예선 리더보드 / 본선 대진 탭. 화살표 키로 옮기면 바로 그 탭을 연다.
 * 탭을 옮기면 고른 탭의 바탕이 미끄러져 가고, 새 내용이 옮긴 방향에서 들어온다(사용자가 고를 때만).
 */
export function LiveTabs({ selected, onSelect, live, end, children }: Props) {
  const { t } = useTranslation()
  const refs = useRef<Record<LiveTab, HTMLButtonElement | null>>({
    mapping: null,
    practice: null,
    qualifying: null,
    bracket: null,
  })
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  // 처음 열 때나 실시간 갱신, 진행 단계에 따른 자동 전환 때는 움직이지 않고, 사용자가 탭을 고를 때만 내용 전환을 보인다
  const [motion, setMotion] = useState<'left' | 'right' | null>(null)

  const select = (next: LiveTab) => {
    if (next === selected) return
    setMotion(TABS.indexOf(next) > TABS.indexOf(selected) ? 'right' : 'left')
    onSelect(next)
  }

  // 고른 탭의 바탕을 그 탭 자리로 옮긴다. 상태 대신 CSS 변수로 바로 써서 다시 그리지 않는다
  useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    const place = () => {
      const tab = refs.current[selected]
      if (!tab) return
      indicator.style.setProperty('--x', `${tab.offsetLeft}px`)
      indicator.style.setProperty('--y', `${tab.offsetTop}px`)
      indicator.style.setProperty('--w', `${tab.offsetWidth}px`)
      indicator.style.setProperty('--h', `${tab.offsetHeight}px`)
    }
    place()
    // 첫 위치를 잡은 뒤부터 움직임을 켠다 (처음 그릴 때 왼쪽 끝에서 미끄러져 오지 않게)
    const frame = requestAnimationFrame(() => {
      indicator.dataset.ready = ''
    })
    // 글꼴이 늦게 오거나 "진행 중" 표시가 붙었다 떨어지면 탭 폭이 바뀐다
    const observer = new ResizeObserver(place)
    observer.observe(list)
    Object.values(refs.current).forEach((tab) => tab && observer.observe(tab))
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [selected])

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(selected)
    const next =
      event.key === 'ArrowRight'
        ? TABS[(index + 1) % TABS.length]
        : event.key === 'ArrowLeft'
          ? TABS[(index - 1 + TABS.length) % TABS.length]
          : event.key === 'Home'
            ? TABS[0]
            : event.key === 'End'
              ? TABS[TABS.length - 1]
              : null
    if (!next) return
    event.preventDefault()
    select(next)
    refs.current[next]?.focus()
  }

  return (
    <>
      <div className={styles.bar}>
        <div ref={listRef} className={styles.tabs} role="tablist" aria-label={t('live.tabs.label')}>
          {TABS.map((tab) => (
            <button
              key={tab}
              ref={(element) => {
                refs.current[tab] = element
              }}
              type="button"
              role="tab"
              id={`live-tab-${tab}`}
              aria-selected={selected === tab}
              aria-controls={`live-panel-${tab}`}
              tabIndex={selected === tab ? 0 : -1}
              className={styles.tab}
              onClick={() => select(tab)}
              onKeyDown={move}
            >
              {t(`live.tabs.${tab}`)}
              {live[tab] && <span className={styles.live}>{t('live.tabs.live')}</span>}
            </button>
          ))}
          <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
        </div>
        {end}
      </div>
      <section
        id={`live-panel-${selected}`}
        role="tabpanel"
        aria-labelledby={`live-tab-${selected}`}
        tabIndex={0}
        className={styles.panel}
      >
        <div
          key={selected}
          className={styles.content}
          data-motion={motion ?? undefined}
          // 움직임이 끝나면 방향을 지운다. 큰 화면에서 진행 단계에 따라 탭이 저절로 바뀔 때
          // 예전에 누른 방향으로 다시 움직이지 않게 한다 (안쪽 요소의 애니메이션은 무시)
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setMotion(null)
          }}
        >
          {children}
        </div>
      </section>
    </>
  )
}
