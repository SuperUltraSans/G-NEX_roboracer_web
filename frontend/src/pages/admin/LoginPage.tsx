import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { api } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'
import type { LoginRequest, UserOut } from '../../api/types'
import { useDocumentTitle } from '../../app/useDocumentTitle'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { Loading } from '../../components/StateView'
import { MockNotice, TopBar } from './AdminLayout'
import { useMe } from './auth'
import styles from './LoginPage.module.css'
import { ErrorMessage } from './ui/Feedback'
import { hasCode } from './ui/errors'

function focusField(form: HTMLFormElement | null, name: string) {
  const field = form?.elements.namedItem(name)
  if (field instanceof HTMLElement) field.focus()
}

/** 로그인 뒤 돌아갈 주소. 이 사이트 안의 경로만 받는다. */
function returnTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  // 이 사이트 안의 경로로만 돌아간다 (관리자 화면, 모니터링 관리, 미리보기 중인 공개 화면)
  const allowed = typeof from === 'string' && /^\/(?![/\\])/.test(from)
  if (allowed && !from.startsWith('/admin/login')) {
    return from
  }
  return '/admin'
}

export function LoginPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('admin.login.title'))
  const me = useMe()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const target = returnTarget(location.state)
  const formRef = useRef<HTMLFormElement>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [missing, setMissing] = useState<{ username?: boolean; password?: boolean }>({})

  const login = useMutation({
    mutationFn: (body: LoginRequest) => api.post<UserOut>('/api/admin/auth/login', body),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user)
      navigate(target, { replace: true })
    },
    onError: (error) => {
      if (hasCode(error, 'INVALID_CREDENTIALS')) {
        setPassword('')
        focusField(formRef.current, 'password')
      }
    },
  })

  if (me.data) return <Navigate to={target} replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = { username: !username.trim(), password: !password }
    setMissing(next)
    if (next.username || next.password) return
    login.mutate({ username: username.trim(), password })
  }

  return (
    <div className={styles.shell}>
      <TopBar />
      <MockNotice />
      <main className={styles.main} id="admin-main">
        <div className={styles.column}>
          <h1 className={styles.title}>{t('admin.login.title')}</h1>
          <p className={styles.lead}>{t('admin.login.lead')}</p>
          {me.isPending ? (
            <Loading />
          ) : (
            <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
              <TextField
                label={t('admin.login.username')}
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                error={missing.username ? t('admin.login.usernameRequired') : undefined}
              />
              <TextField
                label={t('admin.login.password')}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={missing.password ? t('admin.login.passwordRequired') : undefined}
              />
              <ErrorMessage
                error={login.error}
                overrides={{ UNAUTHENTICATED: t('admin.error.invalidCredentials') }}
              />
              <Button type="submit" variant="primary" block disabled={login.isPending}>
                {login.isPending ? t('admin.login.submitting') : t('admin.login.submit')}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
