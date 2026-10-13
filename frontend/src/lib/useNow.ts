import { useEffect, useState } from 'react'

/** 주기적으로 갱신되는 현재 시각 (일정 강조, 접수 상태 전환용) */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
