import type { TFunction } from 'i18next'
import type { TeamPublic } from '../../../api/types'
import { pickLocalized, type Lang } from '../../../lib/localized'
import { MONITOR_USERNAME } from '../../monitor/url'

export function teamName(team: TeamPublic, lang: Lang): string {
  return pickLocalized(team, 'name', lang) ?? ''
}

/** 선택 목록용 한 줄 표기: "#7 팀이름" (팀 ID 와 이름) */
export function teamOption(t: TFunction, team: TeamPublic, lang: Lang): string {
  return t('admin.common.teamOption', { id: team.id, name: teamName(team, lang) })
}

/** 기록·변경을 남긴 사람. 모니터링 관리 주소로 들어온 기록은 시스템 계정 이름 대신 알아보기 쉽게 보인다 */
export function actorName(t: TFunction, username: string | null): string {
  if (!username) return t('admin.audit.bySystem')
  if (username === MONITOR_USERNAME) return t('admin.audit.byMonitor')
  return username
}

/** 대회 시간대 기준 HH:mm:ss (같은 분에 여러 기록이 들어올 수 있어 초까지 보인다) */
export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso))
}

/** 팀 이름(또는 소속)으로 거른다. 숫자를 넣으면 팀 ID 가 같은 팀을 맨 앞에 둔다. */
export function filterTeams<T extends TeamPublic>(teams: readonly T[], query: string): T[] {
  const q = query.trim().replace(/^#/, '').toLowerCase()
  if (!q) return [...teams]
  const matches = teams.filter(
    (team) =>
      String(team.id) === q ||
      [team.name_ko, team.name_en, team.affiliation_ko ?? '', team.affiliation_en ?? '']
        .join('\n')
        .toLowerCase()
        .includes(q),
  )
  return matches.sort((a, b) => Number(String(b.id) === q) - Number(String(a.id) === q))
}
