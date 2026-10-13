import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import styles from './admin.module.css'
import { ErrorMessage } from './Feedback'
import { useAdminMutation } from './mutation'

interface ContentItem {
  id: number
  version: number
  is_published: boolean
}

/**
 * 일정·규칙 목록의 한 줄 동작: 수정, 공개 전환, 순서 변경, 삭제(확인).
 * 동작마다 자기 오류를 그 줄 아래에 보인다.
 */
export function ContentRowActions<T extends ContentItem>({
  item,
  basePath,
  adminKey,
  publicKey,
  onEdit,
  orderUp,
  orderDown,
  deleteTitle,
  deleteBody,
}: {
  item: T
  basePath: string
  adminKey: QueryKey
  publicKey: QueryKey
  onEdit: () => void
  /** 위로 옮겼을 때의 전체 id 순서. 옮길 수 없으면 null */
  orderUp: number[] | null
  orderDown: number[] | null
  deleteTitle: ReactNode
  deleteBody: ReactNode
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: publicKey, exact: true }),
    ])

  const publish = useAdminMutation({
    mutationFn: () =>
      api.patch<T>(`${basePath}/${item.id}`, {
        version: item.version,
        is_published: !item.is_published,
      }),
    onSettled: refresh,
  })

  const reorder = useAdminMutation({
    mutationFn: (ids: number[]) => api.put<T[]>(`${basePath}/order`, { ids }),
    onSuccess: (list) => queryClient.setQueryData(adminKey, list),
    onSettled: () => queryClient.invalidateQueries({ queryKey: publicKey, exact: true }),
  })

  const remove = useAdminMutation({
    mutationFn: () => api.delete(`${basePath}/${item.id}`),
    onSuccess: () => setDeleting(false),
    onSettled: refresh,
  })

  const busy = publish.isPending || reorder.isPending || remove.isPending

  return (
    <>
      <div className={styles.actions}>
        <Button variant="secondary" className={styles.compact} onClick={onEdit} disabled={busy}>
          {t('admin.common.edit')}
        </Button>
        <Button
          variant="secondary"
          className={styles.compact}
          onClick={() => {
            reorder.reset()
            publish.mutate()
          }}
          disabled={busy}
        >
          {item.is_published ? t('admin.common.unpublish') : t('admin.common.publish')}
        </Button>
        {(orderUp || orderDown) && (
          <>
            <Button
              variant="secondary"
              className={styles.compact}
              disabled={!orderUp || busy}
              onClick={() => orderUp && reorder.mutate(orderUp)}
            >
              {t('admin.common.moveUp')}
            </Button>
            <Button
              variant="secondary"
              className={styles.compact}
              disabled={!orderDown || busy}
              onClick={() => orderDown && reorder.mutate(orderDown)}
            >
              {t('admin.common.moveDown')}
            </Button>
          </>
        )}
        <Button
          variant="danger"
          className={styles.compact}
          onClick={() => setDeleting(true)}
          disabled={busy}
        >
          {t('admin.common.delete')}
        </Button>
      </div>
      <ErrorMessage error={publish.error ?? reorder.error} />
      <ConfirmDialog
        open={deleting}
        danger
        title={deleteTitle}
        confirmLabel={remove.isPending ? t('admin.common.deleting') : t('admin.common.delete')}
        cancelLabel={t('admin.common.cancel')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setDeleting(false)
          remove.reset()
        }}
      >
        <p>{deleteBody}</p>
        <ErrorMessage error={remove.error} />
      </ConfirmDialog>
    </>
  )
}
