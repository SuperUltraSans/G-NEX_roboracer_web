import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { contentKeys, queryKeys } from '../../api/queryKeys'
import type { PublishResource, PublishState } from '../../api/types'

/** 일정·규칙·사이트 설정마다 게시하지 않은 변경이 있는지 (관리자만) */
export function usePublishStates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.publish,
    queryFn: () => api.get<PublishState[]>('/api/admin/publish'),
    enabled,
  })
}

/** 게시: 고친 내용을 공개 사이트에 올린다 */
export function usePublish() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (resource: PublishResource) =>
      api.post<PublishState>(`/api/admin/publish/${resource}`),
    onSuccess: (_, resource) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.publish })
      // 공개본과 미리보기를 함께 다시 받는다 (['schedule'] 은 ['schedule', 'preview'] 도 포함)
      void queryClient.invalidateQueries({ queryKey: contentKeys[resource] })
    },
  })
}
