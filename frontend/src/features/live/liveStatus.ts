import { createContext, useContext } from 'react'
import type { ConnectionStatus } from './types'

export const LiveStatusContext = createContext<ConnectionStatus>('connecting')

export function useLiveStatus(): ConnectionStatus {
  return useContext(LiveStatusContext)
}
