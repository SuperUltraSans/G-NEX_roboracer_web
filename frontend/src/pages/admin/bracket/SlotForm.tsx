import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'
import { queryKeys } from '../../../api/queryKeys'
import type {
  Bracket,
  BracketMatch,
  BracketSlot,
  BracketSlotUpdate,
  TeamPublic,
} from '../../../api/types'
import { SelectField, TextField } from '../../../components/Field'
import { useLang } from '../../../i18n'
import ui from '../ui/admin.module.css'
import { Choices } from '../ui/Choices'
import { ErrorMessage, Message, SaveButton } from '../ui/Feedback'
import { teamOption } from '../ui/format'
import { useAdminMutation } from '../ui/mutation'
import { useForm } from '../ui/useForm'
import styles from './Bracket.module.css'
import { flatMatches, replaceMatch, roundName, slotTitle } from './utils'

type SlotKind = 'team' | 'seed' | 'source' | 'none'

interface SlotValues {
  kind: SlotKind
  teamId: string
  seedRank: string
  sourceMatchId: string
  sourceRank: string
  placeholderKo: string
  placeholderEn: string
}

function kindOf(slot: BracketSlot): SlotKind {
  if (slot.source_match_id) return 'source'
  if (slot.seed_rank) return 'seed'
  if (slot.team) return 'team'
  return 'none'
}

function toValues(slot: BracketSlot): SlotValues {
  return {
    kind: kindOf(slot),
    teamId: slot.team ? String(slot.team.id) : '',
    seedRank: slot.seed_rank ? String(slot.seed_rank) : '',
    sourceMatchId: slot.source_match_id ? String(slot.source_match_id) : '',
    sourceRank: slot.source_rank ? String(slot.source_rank) : '1',
    placeholderKo: slot.placeholder_ko ?? '',
    placeholderEn: slot.placeholder_en ?? '',
  }
}

/**
 * 보낼 본문. 슬롯 PATCH 는 보낸 필드만 바꾸므로 다른 방식의 필드는 null 로 지운다.
 * 이전 매치 결과로 채우는 슬롯은 team_id 를 보내지 않아야 서버가 결과대로 팀을 채운다.
 */
function toBody(slot: BracketSlot, values: SlotValues): BracketSlotUpdate {
  const placeholders = {
    placeholder_ko: values.placeholderKo.trim() || null,
    placeholder_en: values.placeholderEn.trim() || null,
  }
  switch (values.kind) {
    case 'team':
      return {
        team_id: Number(values.teamId),
        seed_rank: null,
        source_match_id: null,
        source_rank: null,
        ...placeholders,
      }
    case 'seed': {
      const seed = Number(values.seedRank)
      const keepTeam = kindOf(slot) === 'seed' && slot.seed_rank === seed
      return {
        ...(keepTeam ? {} : { team_id: null }),
        seed_rank: seed,
        source_match_id: null,
        source_rank: null,
        ...placeholders,
      }
    }
    case 'source':
      return {
        seed_rank: null,
        source_match_id: Number(values.sourceMatchId),
        source_rank: Number(values.sourceRank),
        ...placeholders,
      }
    case 'none':
      return {
        team_id: null,
        seed_rank: null,
        source_match_id: null,
        source_rank: null,
        ...placeholders,
      }
  }
}

/** 슬롯 하나를 채우는 방법: 팀 직접 지정 / 예선 순위 / 이전 매치 결과 / 미정(자리표시만) */
export function SlotForm({
  slot,
  index,
  match,
  bracket,
  teams,
}: {
  slot: BracketSlot
  index: number
  match: BracketMatch
  bracket: Bracket
  teams: TeamPublic[]
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const queryClient = useQueryClient()
  const { values, set, saved, setSaved } = useForm(() => toValues(slot))
  const [error, setError] = useState<string | null>(null)

  const sources = flatMatches(bracket).filter((ref) => ref.match.id !== match.id)
  const source = sources.find((ref) => String(ref.match.id) === values.sourceMatchId)?.match
  const rankCount = source?.slots.length ?? 2

  const save = useAdminMutation({
    mutationFn: (body: BracketSlotUpdate) =>
      api.patch<BracketMatch>(`/api/admin/bracket/slots/${slot.id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<Bracket>(queryKeys.bracket, (old) =>
        old ? replaceMatch(old, updated) : old,
      )
      setSaved(true)
    },
  })

  const update = <K extends keyof SlotValues>(key: K, value: SlotValues[K]) => {
    set(key, value)
    setError(null)
    save.reset()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    let problem: string | null = null
    // 비활성화된 팀은 선택 상자에 없으므로 다시 고르게 한다
    const activeTeam = teams.some((team) => String(team.id) === values.teamId)
    if (values.kind === 'team' && !activeTeam) problem = t('admin.bracket.slotTeamRequired')
    if (values.kind === 'seed') {
      const seed = Number(values.seedRank)
      if (!Number.isInteger(seed) || seed < 1) problem = t('admin.bracket.slotSeedRequired')
    }
    if (values.kind === 'source' && !values.sourceMatchId) {
      problem = t('admin.bracket.slotSourceRequired')
    }
    setError(problem)
    if (problem) return
    save.mutate(toBody(slot, values))
  }

  return (
    <form className={styles.slotForm} onSubmit={submit} noValidate>
      <h4 className={ui.subTitle}>
        {t('admin.bracket.slotN', { n: index + 1 })}{' '}
        <span className={ui.meta}>{slotTitle(t, slot, lang, bracket)}</span>
      </h4>
      <Choices
        legend={t('admin.bracket.slotKind')}
        value={values.kind}
        onChange={(kind) => update('kind', kind)}
        options={[
          { value: 'team', label: t('admin.bracket.kind.team') },
          { value: 'seed', label: t('admin.bracket.kind.seed') },
          { value: 'source', label: t('admin.bracket.kind.source') },
          { value: 'none', label: t('admin.bracket.kind.none') },
        ]}
      />
      {values.kind === 'team' && (
        <SelectField
          label={t('admin.bracket.slotTeam')}
          value={values.teamId}
          onChange={(event) => update('teamId', event.target.value)}
        >
          <option value="">{t('admin.common.choose')}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {teamOption(t, team, lang)}
            </option>
          ))}
        </SelectField>
      )}
      {values.kind === 'seed' && (
        <TextField
          label={t('admin.bracket.slotSeed')}
          type="number"
          inputMode="numeric"
          min={1}
          value={values.seedRank}
          onChange={(event) => update('seedRank', event.target.value)}
          hint={t('admin.bracket.slotSeedHint')}
        />
      )}
      {values.kind === 'source' && (
        <div className={ui.fields}>
          <SelectField
            label={t('admin.bracket.slotSourceMatch')}
            value={values.sourceMatchId}
            onChange={(event) => update('sourceMatchId', event.target.value)}
          >
            <option value="">{t('admin.common.choose')}</option>
            {sources.map(({ match: option, round }) => (
              <option key={option.id} value={option.id}>
                {t('admin.bracket.matchInRound', {
                  label: option.label,
                  round: roundName(round, lang),
                })}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('admin.bracket.slotSourceRank')}
            value={values.sourceRank}
            onChange={(event) => update('sourceRank', event.target.value)}
          >
            {Array.from({ length: rankCount }, (_, i) => i + 1).map((rank) => (
              <option key={rank} value={rank}>
                {rankCount === 2
                  ? t(rank === 1 ? 'admin.bracket.winner' : 'admin.bracket.loser')
                  : t('admin.bracket.rankN', { rank })}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      <div className={ui.pair}>
        <TextField
          label={t('admin.bracket.placeholderKo')}
          value={values.placeholderKo}
          maxLength={200}
          onChange={(event) => update('placeholderKo', event.target.value)}
          hint={t('admin.bracket.placeholderHint')}
        />
        <TextField
          label={t('admin.bracket.placeholderEn')}
          lang="en"
          value={values.placeholderEn}
          maxLength={200}
          onChange={(event) => update('placeholderEn', event.target.value)}
          hint={t('admin.common.enFallback')}
        />
      </div>
      {error && <Message tone="error">{error}</Message>}
      <ErrorMessage error={save.error} />
      <div className={ui.actions}>
        <SaveButton pending={save.isPending} saved={saved} />
      </div>
    </form>
  )
}
