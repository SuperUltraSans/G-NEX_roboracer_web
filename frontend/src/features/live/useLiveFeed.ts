import { useEffect, useRef, useState } from 'react'
import { USE_MOCK, liveSocketUrl } from '../../api/client'
import type { ConnectionStatus, LiveMessage } from './types'

const PING_INTERVAL_MS = 25_000
const SILENCE_LIMIT_MS = 60_000
const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000
// 이 횟수만큼 연달아 실패하면 "재연결 중" 대신 "끊김"으로 보여 준다 (재시도는 계속한다)
const ATTEMPTS_BEFORE_CLOSED = 4

interface Handlers {
  onMessage: (message: LiveMessage) => void
  onReconnect: () => void
}

/** 공개 실시간 피드에 한 번 연결하고 끊기면 지수 백오프로 다시 연결한다. */
export function useLiveFeed(handlers: Handlers): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (USE_MOCK) {
      let stop: (() => void) | undefined
      let cancelled = false
      void import('../../api/mock/live').then(({ startMockFeed }) => {
        if (cancelled) return
        setStatus('open')
        stop = startMockFeed((message) => handlersRef.current.onMessage(message))
      })
      return () => {
        cancelled = true
        stop?.()
      }
    }

    let socket: WebSocket | null = null
    let pingTimer: number | undefined
    let silenceTimer: number | undefined
    let retryTimer: number | undefined
    let attempt = 0
    let connectedBefore = false
    let disposed = false

    const clearTimers = () => {
      window.clearInterval(pingTimer)
      window.clearTimeout(silenceTimer)
    }

    const watchSilence = () => {
      window.clearTimeout(silenceTimer)
      silenceTimer = window.setTimeout(() => socket?.close(), SILENCE_LIMIT_MS)
    }

    const scheduleRetry = () => {
      const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** attempt)
      const delay = ceiling / 2 + Math.random() * (ceiling / 2)
      attempt += 1
      setStatus(attempt >= ATTEMPTS_BEFORE_CLOSED ? 'closed' : 'reconnecting')
      retryTimer = window.setTimeout(connect, delay)
    }

    function connect() {
      if (disposed) return
      const current = new WebSocket(liveSocketUrl())
      socket = current

      current.onopen = () => {
        attempt = 0
        setStatus('open')
        if (connectedBefore) handlersRef.current.onReconnect()
        connectedBefore = true
        pingTimer = window.setInterval(() => {
          if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'ping' }))
        }, PING_INTERVAL_MS)
        watchSilence()
      }

      current.onmessage = (event) => {
        watchSilence()
        let message: LiveMessage
        try {
          message = JSON.parse(String(event.data)) as LiveMessage
        } catch {
          return
        }
        handlersRef.current.onMessage(message)
      }

      current.onerror = () => current.close()

      current.onclose = () => {
        clearTimers()
        if (disposed || socket !== current) return
        scheduleRetry()
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimers()
      window.clearTimeout(retryTimer)
      socket?.close()
    }
  }, [])

  return status
}
