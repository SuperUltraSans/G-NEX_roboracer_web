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
import { AdminPage, Section } from '../ui/AdminPage'
import ui from '../ui/admin.module.css'
import { useHelp } from '../ui/help'
import { Switch } from '../ui/Controls'
import { ErrorMessage, Message, SaveButton, StaleNotice } from '../ui/Feedback'
import { Icon } from '../ui/Icon'
import { isConflict } from '../ui/errors'
import { teamOption } from '../ui/format'
import { useAdminMutation } from '../ui/mutation'
import { useEditor } from '../ui/useEditor'

const BASE = '/api/admin/teams'

/** 참가(활성) 팀 최대 수. 백엔드 schemas/competition.py MAX_ACTIVE_TEAMS 와 같은 값 */
export const MAX_ACTIVE_TEAMS = 15

export function TeamsPage() {
  const { t } = useTranslation()
  const teams = useQuery({
    queryKey: queryKeys.teamsAdmin,
    queryFn: () => api.get<TeamAdmin[]>(BASE),
  })
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const active = teams.data?.filter((team) => team.is_active).length ?? 0
  const full = active >= MAX_ACTIVE_TEAMS
  const help = useHelp('admin.teams.help')

  return (
    <AdminPage
      title={t('admin.teams.title')}
      lead={t('admin.teams.lead', { max: MAX_ACTIVE_TEAMS })}
      help={help}
      actions={
        !creating && (
          <Button
            variant="primary"
            disabled={full}
            onClick={() => {
              setNotice(null)
              setEditingId(null)
              setCreating(true)
            }}
          >
            {t('admin.teams.add')}
          </Button>
        )
      }
    >
      {teams.isPending && <Loading />}
      {teams.isError && <ErrorState error={teams.error} onRetry={() => teams.refetch()} />}
      {teams.data && (
        <>
          {notice && <Message tone="success">{notice}</Message>}
          {full && <Message>{t('admin.teams.full', { max: MAX_ACTIVE_TEAMS })}</Message>}
          {creating && (
            <TeamForm
              onDone={(message) => {
                setCreating(false)
                setNotice(message)
              }}
            />
          )}
          {teams.data.length === 0 ? (
            <EmptyState>{t('admin.teams.empty')}</EmptyState>
          ) : (
            <Section
              id="team-list"
              title={t('admin.teams.listTitle')}
              actions={
                <span className={ui.meta}>
                  {t('admin.teams.count', {
                    active,
                    max: MAX_ACTIVE_TEAMS,
                    total: teams.data.length,
                  })}
                </span>
              }
            >
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.teams.colId')}</th>
                      <th scope="col">{t('admin.teams.colName')}</th>
                      <th scope="col">{t('admin.teams.colNameEn')}</th>
                      <th scope="col">{t('admin.teams.colAffiliation')}</th>
                      <th scope="col">{t('admin.teams.colStatus')}</th>
                      <th scope="col" className={ui.actionsCell}>
                        <span className="visually-hidden">{t('admin.teams.colActions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.data.map((team) => (
                      <TeamRow
                        full={full}
                        key={team.id}
                        team={team}
                        editing={editingId === team.id}
                        onEdit={(on) => {
                          setNotice(null)
                          setCreating(false)
                          setEditingId(on ? team.id : null)
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </AdminPage>
  )
}

function TeamRow({
  team,
  full,
  editing,
  onEdit,
}: {
  team: TeamAdmin
  /** 참가 팀이 가득 차 다시 활성화할 수 없다 */
  full: boolean
  editing: boolean
  onEdit: (on: boolean) => void
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
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
  const affiliation = [team.affiliation_ko, team.affiliation_en]
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(' / ')

  return (
    <>
      <tr data-off={team.is_active ? undefined : ''}>
        <td className={ui.idCell}>#{team.id}</td>
        <td className={ui.strongCell}>{team.name_ko}</td>
        <td lang="en">{team.name_en && team.name_en !== team.name_ko ? team.name_en : ''}</td>
        <td>{affiliation}</td>
        <td>
          {/* 참가 스위치: 끄면 확인 뒤 비활성화(기권), 켜면 다시 참가 (15팀이 차 있으면 막힘) */}
          <Switch
            checked={team.is_active}
            label={t('admin.teams.activeSwitch', { team: teamOption(t, team, lang) })}
            onText={t('admin.teams.active')}
            offText={t('admin.teams.inactive')}
            disabled={toggle.isPending || (!team.is_active && full)}
            onChange={(next) => (next ? toggle.mutate(true) : setDeactivating(true))}
          />
        </td>
        <td className={ui.actionsCell}>
          <div>
            <Button
              variant="secondary"
              className={ui.compact}
              aria-expanded={editing}
              onClick={() => {
                toggle.reset()
                onEdit(!editing)
              }}
            >
              <Icon name="edit" /> {editing ? t('admin.common.close') : t('admin.common.edit')}
            </Button>
          </div>
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
        </td>
      </tr>
      {editing && (
        <tr data-editor="">
          <td colSpan={6}>
            <TeamForm team={team} onDone={() => onEdit(false)} />
          </td>
        </tr>
      )}
    </>
  )
}

interface TeamValues {
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
  const [errors, setErrors] = useState<{ nameKo?: string }>({})

  const editor = useEditor<TeamAdmin, TeamValues>({
    item: team,
    queryKey: queryKeys.teamsAdmin,
    toValues: (source) => ({
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
      else onDone(t('admin.teams.added', { id: saved.id, name: saved.name_ko }))
    },
    onError: (error) => {
      if (isConflict(error)) void editor.handleConflict()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = {
      nameKo: values.nameKo.trim() ? undefined : t('admin.common.koRequired'),
    }
    setErrors(next)
    if (next.nameKo) return
    save.mutate({
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
      <div className={ui.pair}>
        <TextField
          label={t('admin.teams.nameKo')}
          value={values.nameKo}
          maxLength={200}
          onChange={(event) => set('nameKo', event.target.value)}
          error={errors.nameKo}
          hint={t('admin.teams.nameHint')}
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
          DUPLICATE: t('admin.teams.duplicate', { name: values.nameKo.trim() }),
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
