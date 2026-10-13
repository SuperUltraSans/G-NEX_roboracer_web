import type { ReactNode } from 'react'

/**
 * 문장 안의 특정 구절을 줄바꿈 없이 한 덩어리로 묶는다.
 * 'G-NEX' 처럼 하이픈이 든 이름은 브라우저가 하이픈 뒤에서 줄을 바꾸기 때문이다.
 */
export function keepTogether(text: string, phrases: string[], className: string): ReactNode[] {
  const pattern = new RegExp(`(${phrases.map(escape).join('|')})`, 'g')
  return text.split(pattern).map((part, index) =>
    phrases.includes(part) ? (
      <span key={index} className={className}>
        {part}
      </span>
    ) : (
      part
    ),
  )
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
