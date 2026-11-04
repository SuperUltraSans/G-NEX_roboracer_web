import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { Role, UserAdmin, UserCreate, UserUpdate } from '../../api/types'
import { Button } from '../../components/Button'
import { Checkbox, TextField } from '../../components/Field'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState, ErrorState, Loading } from '../../components/StateView'
import { useEventTimezone } from '../../features/content/hooks'
import { useLang } from '../../i18n'
import { formatDate } from '../../lib/time'
import { useCurrentUser } from './auth'
import { AdminPage, Section } from './ui/AdminPage'
import ui from './ui/admin.module.css'
import { useHelp } from './ui/help'
import { Choices } from './ui/Choices'
import { Switch } from './ui/Controls'
import { ErrorMessage, Message, Tag } from './ui/Feedback'
import { useAdminMutation } from './ui/mutation'

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/
const PASSWORD_MIN = 8
const ROLES: readonly Role[] = ['referee', 'admin']

function useUsers() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api.get<UserAdmin[]>('/api/admin/users'),
  })
}

export function UsersPage() {
  const { t } = useTranslation()
  const users = useUsers()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const help = useHelp('admin.users.help')
  return (
    <AdminPage
      title={t('admin.users.title')}
      lead={t('admin.users.lead')}
      help={help}
      actions={
        !creating && (
          <Button
            variant="primary"
            onClick={() => {
              setCreated(null)
              setCreating(true)
            }}
          >
            {t('admin.users.create')}
          </Button>
        )
      }
    >
      {created && <Message tone="success">{created}</Message>}
      {creating && (
        <CreateUserForm
          onDone={(message) => {
            setCreating(false)
            setCreated(message)
          }}
        />
      )}
      <Section id="user-list" title={t('admin.users.listTitle')}>
        {users.isPending && <Loading />}
        {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
        {users.data &&
          (users.data.length === 0 ? (
            <EmptyState>{t('admin.users.empty')}</EmptyState>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('admin.users.username')}</th>
                    <th scope="col">{t('admin.users.role')}</th>
                    <th scope="col">{t('admin.users.colStatus')}</th>
                    <th scope="col">{t('admin.users.colCreated')}</th>
                    <th scope="col" className={ui.actionsCell}>
                      <span className="visually-hidden">{t('admin.users.colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.map((user) => (
                    <UserRow key={user.id} user={user} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </Section>
    </AdminPage>
  )
}

function CreateUserForm({ onDone }: { onDone: (message: string | null) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('referee')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({})

  const create = useAdminMutation({
    mutationFn: (body: UserCreate) => api.post<UserAdmin>('/api/admin/users', body),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      onDone(t('admin.users.created', { name: user.username, role: t(`admin.role.${user.role}`) }))
    },
  })

  const touched = () => create.reset()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = username.trim()
    const next = {
      username: USERNAME.test(name) ? undefined : t('admin.users.usernameRule'),
      password:
        password.length >= PASSWORD_MIN
          ? undefined
          : t('admin.users.passwordRule', { min: PASSWORD_MIN }),
    }
    setErrors(next)
    if (next.username || next.password) return
    create.mutate({ username: name, password, role })
  }

  return (
    <form className={`${ui.editor} ${ui.narrow}`} onSubmit={submit} noValidate>
      <h2 className={ui.subTitle}>{t('admin.users.createTitle')}</h2>
      <TextField
        label={t('admin.users.username')}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={32}
        value={username}
        onChange={(event) => {
          setUsername(event.target.value)
          setErrors((prev) => ({ ...prev, username: undefined }))
          touched()
        }}
        error={errors.username}
        hint={t('admin.users.usernameHint')}
      />
      <Choices
        legend={t('admin.users.role')}
        value={role}
        onChange={(next) => {
          setRole(next)
          touched()
        }}
        options={ROLES.map((value) => ({ value, label: t(`admin.role.${value}`) }))}
        hint={t('admin.users.roleHint')}
      />
      <TextField
        label={t('admin.users.password')}
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value)
          setErrors((prev) => ({ ...prev, password: undefined }))
          touched()
        }}
        error={errors.password}
        hint={t('admin.users.passwordHint', { min: PASSWORD_MIN })}
      />
      <Checkbox
        label={t('admin.users.showPassword')}
        checked={showPassword}
        onChange={(event) => setShowPassword(event.target.checked)}
      />
      <ErrorMessage
        error={create.error}
        overrides={{ DUPLICATE: t('admin.users.duplicate', { name: username.trim() }) }}
      />
      <div className={ui.actions}>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? t('admin.common.saving') : t('admin.users.create')}
        </Button>
        <Button variant="secondary" onClick={() => onDone(null)}>
          {t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  )
}

type Dialog = 'role' | 'deactivate' | 'password' | null

function UserRow({ user }: { user: UserAdmin }) {
  const { t } = useTranslation()
  const lang = useLang()
  const timezone = useEventTimezone()
  const me = useCurrentUser()
  const queryClient = useQueryClient()
  const isMe = me.id === user.id
  const [dialog, setDialog] = useState<Dialog>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const nextRole: Role = user.role === 'admin' ? 'referee' : 'admin'

  const update = useAdminMutation({
    mutationFn: (body: UserUpdate) => api.patch<UserAdmin>(`/api/admin/users/${user.id}`, body),
    onSuccess: (_, body) => {
      setDialog(null)
      setPassword('')
      setNotice(body.password ? t('admin.users.passwordReset') : t('admin.common.saved'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      // 내 역할이 바뀌었으면 메뉴와 권한을 다시 정한다
      if (isMe) void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })

  const open = (next: Dialog) => {
    update.reset()
    setNotice(null)
    setPassword('')
    setDialog(next)
  }
  const close = () => {
    setDialog(null)
    update.reset()
  }

  const passwordTooShort = password.length < PASSWORD_MIN

  return (
    <>
      <tr data-off={user.is_active ? undefined : ''}>
        <td className={ui.strongCell}>
          {user.username} {isMe && <Tag>{t('admin.users.me')}</Tag>}
        </td>
        <td>{t(`admin.role.${user.role}`)}</td>
        <td>
          {/* 끄면 확인 뒤 비활성화(바로 로그아웃), 켜면 다시 사용 */}
          <Switch
            checked={user.is_active}
            label={t('admin.users.activeSwitch', { name: user.username })}
            onText={t('admin.users.active')}
            offText={t('admin.users.inactive')}
            disabled={update.isPending}
            onChange={(next) => {
              if (!next) return open('deactivate')
              setNotice(null)
              update.mutate({ is_active: true })
            }}
          />
        </td>
        <td className="num">{formatDate(user.created_at, timezone, lang)}</td>
        <td className={ui.actionsCell}>
          <div>
            <Button variant="secondary" className={ui.compact} onClick={() => open('role')}>
              {t(`admin.users.makeRole.${nextRole}`)}
            </Button>
            <Button variant="secondary" className={ui.compact} onClick={() => open('password')}>
              {t('admin.users.resetPassword')}
            </Button>
          </div>

          <ConfirmDialog
            open={dialog === 'role'}
            title={t('admin.users.roleTitle', {
              name: user.username,
              role: t(`admin.role.${nextRole}`),
            })}
            confirmLabel={update.isPending ? t('admin.common.saving') : t('admin.users.changeRole')}
            cancelLabel={t('admin.common.cancel')}
            busy={update.isPending}
            onConfirm={() => update.mutate({ role: nextRole })}
            onCancel={close}
          >
            <p>{t(`admin.users.roleBody.${nextRole}`)}</p>
            {isMe && nextRole === 'referee' && <Message>{t('admin.users.selfDemote')}</Message>}
            <ErrorMessage error={update.error} />
          </ConfirmDialog>

          <ConfirmDialog
            open={dialog === 'deactivate'}
            danger
            title={t('admin.users.deactivateTitle', { name: user.username })}
            confirmLabel={update.isPending ? t('admin.common.saving') : t('admin.users.deactivate')}
            cancelLabel={t('admin.common.cancel')}
            busy={update.isPending}
            onConfirm={() => update.mutate({ is_active: false })}
            onCancel={close}
          >
            <p>{t('admin.users.deactivateBody')}</p>
            {isMe && <Message>{t('admin.users.selfLogout')}</Message>}
            <ErrorMessage error={update.error} />
          </ConfirmDialog>

          <ConfirmDialog
            open={dialog === 'password'}
            danger
            title={t('admin.users.passwordTitle', { name: user.username })}
            confirmLabel={
              update.isPending ? t('admin.common.saving') : t('admin.users.resetPassword')
            }
            cancelLabel={t('admin.common.cancel')}
            busy={update.isPending}
            confirmDisabled={passwordTooShort}
            onConfirm={() => update.mutate({ password })}
            onCancel={close}
          >
            <TextField
              label={t('admin.users.newPassword')}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              hint={t('admin.users.passwordHint', { min: PASSWORD_MIN })}
            />
            <Checkbox
              label={t('admin.users.showPassword')}
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            <p>{t('admin.users.passwordBody')}</p>
            {isMe && <Message>{t('admin.users.selfLogout')}</Message>}
            <ErrorMessage error={update.error} />
          </ConfirmDialog>
        </td>
      </tr>
      {(notice || (dialog === null && update.error)) && (
        <tr data-editor="">
          <td colSpan={5}>
            {notice && <Message tone="success">{notice}</Message>}
            {dialog === null && <ErrorMessage error={update.error} />}
          </td>
        </tr>
      )}
    </>
  )
}
