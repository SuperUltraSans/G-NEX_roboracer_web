import type { TFunction } from 'i18next'
import type { TeamPublic } from '../../../api/types'
import { pickLocalized, type Lang } from '../../../lib/localized'

export function teamName(team: TeamPublic, lang: Lang): string {
  return pickLocalized(team, 'name', lang) ?? ''
}

/** 선택 목록용 한 줄 표기: "7번 팀이름" */
export function teamOption(t: TFunction, team: TeamPublic, lang: Lang): string {
  return t('admin.common.teamOption', { car: team.car_number, name: teamName(team, lang) })
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

/** 차량 번호나 팀 이름으로 거른다. 숫자만 입력하면 번호 앞자리로 찾고, 정확히 같은 번호를 맨 앞에 둔다. */
export function filterTeams<T extends TeamPublic>(teams: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...teams]
  if (/^\d+$/.test(q)) {
    const matches = teams.filter((team) => String(team.car_number).startsWith(q))
    return matches.sort(
      (a, b) => Number(String(b.car_number) === q) - Number(String(a.car_number) === q),
    )
  }
  return teams.filter((team) =>
    [team.name_ko, team.name_en, team.affiliation_ko ?? '', team.affiliation_en ?? '']
      .join('\n')
      .toLowerCase()
      .includes(q),
  )
}
