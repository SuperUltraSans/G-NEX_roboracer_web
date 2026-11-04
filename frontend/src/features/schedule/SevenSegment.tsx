// 전자시계처럼 보이는 7획 숫자. 켜지지 않은 획도 옅게 그려 액정 느낌을 낸다.
// 글자로 읽히지 않으므로(aria-hidden) 쓰는 쪽에서 읽을 수 있는 시각을 따로 둔다.
import styles from './SevenSegment.module.css'

const W = 52
const H = 92
const T = 9 // 획 두께
const GAP = 1.6

type Segment = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g'

function horizontal(y: number): string {
  const x1 = T / 2 + GAP
  const x2 = W - T / 2 - GAP
  const h = T / 2
  return `${x1},${y} ${x1 + h},${y - h} ${x2 - h},${y - h} ${x2},${y} ${x2 - h},${y + h} ${x1 + h},${y + h}`
}

function vertical(x: number, y1: number, y2: number): string {
  const h = T / 2
  const top = y1 + GAP
  const bottom = y2 - GAP
  return `${x},${top} ${x + h},${top + h} ${x + h},${bottom - h} ${x},${bottom} ${x - h},${bottom - h} ${x - h},${top + h}`
}

const LEFT = T / 2
const RIGHT = W - T / 2
const TOP = T / 2
const MIDDLE = H / 2
const BOTTOM = H - T / 2

const SEGMENTS: Record<Segment, string> = {
  a: horizontal(TOP),
  b: vertical(RIGHT, TOP, MIDDLE),
  c: vertical(RIGHT, MIDDLE, BOTTOM),
  d: horizontal(BOTTOM),
  e: vertical(LEFT, MIDDLE, BOTTOM),
  f: vertical(LEFT, TOP, MIDDLE),
  g: horizontal(MIDDLE),
}

const DIGITS: Record<string, Segment[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
}

function Digit({ value }: { value: string }) {
  const lit = new Set(DIGITS[value] ?? [])
  return (
    <svg className={styles.digit} viewBox={`0 0 ${W} ${H}`}>
      {(Object.keys(SEGMENTS) as Segment[]).map((segment) => (
        <polygon
          key={segment}
          points={SEGMENTS[segment]}
          className={lit.has(segment) ? styles.on : styles.off}
        />
      ))}
    </svg>
  )
}

function Colon() {
  return (
    <svg className={styles.colon} viewBox={`0 0 16 ${H}`}>
      <rect x="3" y={H * 0.28} width="10" height="10" className={styles.on} />
      <rect x="3" y={H * 0.62} width="10" height="10" className={styles.on} />
    </svg>
  )
}

/** "15:49:23" 같은 글을 7획 숫자로 */
export function SevenSegment({ text }: { text: string }) {
  return (
    <span className={styles.display} aria-hidden="true">
      {[...text].map((char, index) =>
        char === ':' ? <Colon key={index} /> : <Digit key={index} value={char} />,
      )}
    </span>
  )
}
