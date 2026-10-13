import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'

/**
 * 관리자 변경 요청. 세션이 만료되어 401 UNAUTHENTICATED 를 받으면 로그인 정보를 지워서
 * 인증 가드가 로그인 화면으로 보내게 한다 (돌아올 주소는 가드가 기억한다).
 */
export function useAdminMutation<TData = unknown, TVariables = void>(
  options: UseMutationOptions<TData, Error, TVariables>,
) {
  const queryClient = useQueryClient()
  const { onError } = options
  return useMutation<TData, Error, TVariables>({
    ...options,
    onError: (error, variables, result, context) => {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
        queryClient.setQueryData(queryKeys.me, null)
      }
      return onError?.(error, variables, result, context)
    },
  })
}

/**
 * 409 VERSION_CONFLICT 를 받았을 때 목록을 다시 가져온 뒤 해당 항목의 최신 값을 돌려준다.
 * 편집 폼은 이 값으로 다시 채운다.
 */
export function useReloadItem<T extends { id: number }>(queryKey: QueryKey) {
  const queryClient = useQueryClient()
  return useCallback(
    async (id: number): Promise<T | undefined> => {
      await queryClient.invalidateQueries({ queryKey, exact: true })
      return queryClient.getQueryData<T[]>(queryKey)?.find((item) => item.id === id)
    },
    [queryClient, queryKey],
  )
}
