import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type { TeamAdmin, TeamCreate, TeamUpdate } from '../../../api/types'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { TextField } from '../../../components/Field'
import { EmptyState, ErrorState, Loading } from '../../../components/StateView'
import { useLang } from '../../../i18n'
import { AdminPage } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { ErrorMessage, Message, SaveButton, StaleNotice, Tag } from '../ui/Feedback'
import { isConflict } from '../ui/errors'
import { teamOption } from '../ui/format'
import { useAdminMutation } from '../ui/mutation'
import { useEditor } from '../ui/useEditor'
import styles from './Teams.module.css'

const BASE = '/api/admin/teams'

export function TeamsPage() {
  const { t } = useTranslation()
  const teams = useQuery({
    queryKey: queryKeys.teamsAdmin,
    queryFn: () => api.get<TeamAdmin[]>(BASE),
  })
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const active = teams.data?.filter((team) => team.is_active).length ?? 0

  return (
    <AdminPage title={t('admin.teams.title')} lead={t('admin.teams.lead')}>
      {teams.isPending && <Loading />}
      {teams.isError && <ErrorState error={teams.error} onRetry={() => teams.refetch()} />}
      {teams.data && (
        <>
          {notice && <Message tone="success">{notice}</Message>}
          {creating ? (
            <TeamForm
              onDone={(message) => {
                setCreating(false)
                setNotice(message)
              }}
            />
          ) : (
            <div className={ui.actions}>
              <Button
                variant="primary"
                onClick={() => {
                  setNotice(null)
                  setCreating(true)
                }}
              >
                {t('admin.teams.add')}
              </Button>
              <span className={ui.meta}>
                {t('admin.teams.count', { active, total: teams.data.length })}
              </span>
            </div>
          )}
          {teams.data.length === 0 ? (
            <EmptyState>{t('admin.teams.empty')}</EmptyState>
          ) : (
            <ul className={ui.list}>
              {teams.data.map((team) => (
                <TeamRow key={team.id} team={team} />
              ))}
            </ul>
          )}
        </>
      )}
    </AdminPage>
  )
}

function TeamRow({ team }: { team: TeamAdmin }) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  const toggle = useAdminMutation({
    mutationFn: (isActive: boolean) =>
      api.patch<TeamAdmin>(`${BASE}/${team.id}`, {
        version: team.version,
        is_active: isActive,
      } satisfies TeamUpdate),
    onSuccess: () => setDeactivating(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
  })

  return (
    <li className={`${ui.row} ${team.is_active ? '' : styles.inactive}`}>
      <div className={ui.rowHead}>
        <span className={`num ${styles.car}`}>{team.car_number}</span>
        <span className={ui.rowTitle}>{team.name_ko}</span>
        {team.name_en && team.name_en !== team.name_ko && (
          <span className={ui.meta} lang="en">
            {team.name_en}
          </span>
        )}
        {!team.is_active && <Tag tone="off">{t('admin.teams.inactive')}</Tag>}
      </div>
      {(team.affiliation_ko || team.affiliation_en) && (
        <p className={ui.meta}>
          {[team.affiliation_ko, team.affiliation_en]
            .filter((value, index, all) => value && all.indexOf(value) === index)
            .join(' / ')}
        </p>
      )}
      {editing ? (
        <TeamForm team={team} onDone={() => setEditing(false)} />
      ) : (
        <div className={ui.actions}>
          <Button
            variant="secondary"
            className={ui.compact}
            onClick={() => {
              toggle.reset()
              setEditing(true)
            }}
          >
            {t('admin.common.edit')}
          </Button>
          {team.is_active ? (
            <Button variant="danger" className={ui.compact} onClick={() => setDeactivating(true)}>
              {t('admin.teams.deactivate')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              className={ui.compact}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(true)}
            >
              {toggle.isPending ? t('admin.common.saving') : t('admin.teams.reactivate')}
            </Button>
          )}
        </div>
      )}
      {!deactivating && <ErrorMessage error={toggle.error} />}
      <ConfirmDialog
        open={deactivating}
        danger
        title={t('admin.teams.deactivateTitle', { team: teamOption(t, team, lang) })}
        confirmLabel={toggle.isPending ? t('admin.common.saving') : t('admin.teams.deactivate')}
        cancelLabel={t('admin.common.cancel')}
        busy={toggle.isPending}
        onConfirm={() => toggle.mutate(false)}
        onCancel={() => {
          setDeactivating(false)
          toggle.reset()
        }}
      >
        <p>{t('admin.teams.deactivateBody')}</p>
        <ErrorMessage error={toggle.error} />
      </ConfirmDialog>
    </li>
  )
}

interface TeamValues {
  carNumber: string
  nameKo: string
  nameEn: string
  affiliationKo: string
  affiliationEn: string
}

function TeamForm({
  team,
  onDone,
}: {
  team?: TeamAdmin
  onDone: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<{ carNumber?: string; nameKo?: string }>({})

  const editor = useEditor<TeamAdmin, TeamValues>({
    item: team,
    queryKey: queryKeys.teamsAdmin,
    toValues: (source) => ({
      carNumber: source ? String(source.car_number) : '',
      nameKo: source?.name_ko ?? '',
      nameEn: source?.name_en ?? '',
      affiliationKo: source?.affiliation_ko ?? '',
      affiliationEn: source?.affiliation_en ?? '',
    }),
  })
  const { values, set, base } = editor

  const save = useAdminMutation({
    mutationFn: (body: TeamCreate) =>
      base
        ? api.patch<TeamAdmin>(`${BASE}/${base.id}`, {
            ...body,
            version: base.version,
          } satisfies TeamUpdate)
        : api.post<TeamAdmin>(BASE, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams })
      if (base) editor.saved(saved)
      else onDone(t('admin.teams.added', { car: saved.car_number, name: saved.name_ko }))
    },
    onError: (error) => {
      if (isConflict(error)) void editor.handleConflict()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const car = Number(values.carNumber)
    const next = {
      carNumber:
        values.carNumber.trim() !== '' && Number.isInteger(car) && car >= 0 && car <= 9999
          ? undefined
          : t('admin.teams.carNumberRange'),
      nameKo: values.nameKo.trim() ? undefined : t('admin.common.koRequired'),
    }
    setErrors(next)
    if (next.carNumber || next.nameKo) return
    save.mutate({
      car_number: car,
      name_ko: values.nameKo.trim(),
      name_en: values.nameEn.trim(),
      affiliation_ko: values.affiliationKo.trim() || null,
      affiliation_en: values.affiliationEn.trim() || null,
    })
  }

  return (
    <form className={ui.editor} onSubmit={submit} noValidate>
      {editor.stale && !save.isPending && (
        <StaleNotice onReload={() => team && editor.load(team)} />
      )}
      {editor.conflict && <Message tone="error">{t('admin.error.versionConflict')}</Message>}
      <TextField
        label={t('admin.teams.carNumber')}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        className={styles.carInput}
        value={values.carNumber}
        onChange={(event) => set('carNumber', event.target.value)}
        error={errors.carNumber}
        hint={t('admin.teams.carNumberHint')}
        required
      />
      <div className={ui.pair}>
        <TextField
          label={t('admin.teams.nameKo')}
          value={values.nameKo}
          maxLength={200}
          onChange={(event) => set('nameKo', event.target.value)}
          error={errors.nameKo}
          required
        />
        <TextField
          label={t('admin.teams.nameEn')}
          lang="en"
          value={values.nameEn}
          maxLength={200}
          onChange={(event) => set('nameEn', event.target.value)}
          hint={t('admin.common.enFallback')}
        />
      </div>
      <div className={ui.pair}>
        <TextField
          label={t('admin.teams.affiliationKo')}
          value={values.affiliationKo}
          maxLength={200}
          onChange={(event) => set('affiliationKo', event.target.value)}
        />
        <TextField
          label={t('admin.teams.affiliationEn')}
          lang="en"
          value={values.affiliationEn}
          maxLength={200}
          onChange={(event) => set('affiliationEn', event.target.value)}
        />
      </div>
      <p className={ui.meta}>{t('admin.teams.privacy')}</p>
      <ErrorMessage
        error={isConflict(save.error) ? null : save.error}
        overrides={{
          DUPLICATE: t('admin.teams.duplicate', { car: values.carNumber.trim() }),
        }}
      />
      <div className={ui.actions}>
        {base ? (
          <SaveButton pending={save.isPending} saved={editor.isSaved} />
        ) : (
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t('admin.common.saving') : t('admin.teams.add')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => onDone(null)}>
          {base ? t('admin.common.close') : t('admin.common.cancel')}
        </Button>
      </div>
    </form>
  )
}
