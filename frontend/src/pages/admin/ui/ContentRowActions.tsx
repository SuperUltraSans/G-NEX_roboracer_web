import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import styles from './admin.module.css'
import { IconButton, Switch } from './Controls'
import { ErrorMessage } from './Feedback'
import { Icon } from './Icon'
import { useAdminMutation } from './mutation'

interface ContentItem {
  id: number
  version: number
  is_published: boolean
}

/**
 * 일정·규칙 목록의 한 줄 동작: 공개 스위치, 수정, 순서(↑↓), 삭제(확인).
 * 자주 쓰는 '수정'만 글자 버튼이고, 나머지는 작은 아이콘 버튼(이름은 툴팁)이다.
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
      <div className={styles.rowActions}>
        <Switch
          checked={item.is_published}
          label={t('admin.common.publishedLabel')}
          onText={t('admin.common.published')}
          offText={t('admin.common.unpublished')}
          disabled={busy}
          onChange={() => {
            reorder.reset()
            publish.mutate()
          }}
        />
        <Button variant="secondary" className={styles.compact} onClick={onEdit} disabled={busy}>
          <Icon name="edit" /> {t('admin.common.edit')}
        </Button>
        {(orderUp || orderDown) && (
          <span className={styles.iconGroup}>
            <IconButton
              icon="up"
              label={t('admin.common.moveUp')}
              disabled={!orderUp || busy}
              onClick={() => orderUp && reorder.mutate(orderUp)}
            />
            <IconButton
              icon="down"
              label={t('admin.common.moveDown')}
              disabled={!orderDown || busy}
              onClick={() => orderDown && reorder.mutate(orderDown)}
            />
          </span>
        )}
        <IconButton
          icon="trash"
          tone="danger"
          label={t('admin.common.delete')}
          disabled={busy}
          onClick={() => setDeleting(true)}
        />
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
