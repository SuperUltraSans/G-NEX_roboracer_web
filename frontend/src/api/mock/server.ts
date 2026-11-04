// VITE_USE_MOCK=true 일 때 client.ts 가 fetch 대신 이 함수를 부른다.
// 공개 GET 과 관리자 GET 은 fixture 로 답하고, 변경 요청은 모두 읽기 전용 오류로 거절한다.
import { ApiError } from '../client'
import {
  bracket,
  laps,
  leaderboard,
  liveState,
  publicTeam,
  ranking,
  rounds,
  rules,
  schedule,
  settings,
  teams,
} from './state'

const TIMEZONE = 'Asia/Seoul'

const publicSchedule = () =>
  schedule
    .filter((item) => item.is_published)
    .map(({ is_published: _p, version: _v, created_at: _c, ...item }) => item)

const publicRules = () =>
  rules
    .filter((item) => item.is_published)
    .map(({ is_published: _p, version: _v, created_at: _c, ...item }) => item)

// 백엔드 app/services/rules_document.py 의 render 와 같은 형식 (MOCK 화면의 내려받기용)
const DOCUMENT_TITLES = { ko: '대회 규칙', en: 'Rules' } as const

const rulesDocument = (query: URLSearchParams) => {
  const lang = query.get('lang')
  if (lang !== 'ko' && lang !== 'en') {
    throw new ApiError(422, 'VALIDATION_ERROR', "lang: Input should be 'ko' or 'en'")
  }
  const blocks = [`# ${DOCUMENT_TITLES[lang]}`]
  for (const rule of [...rules].sort((a, b) => a.sort_order - b.sort_order)) {
    const title = lang === 'ko' ? rule.title_ko : rule.title_en || rule.title_ko
    const hidden = lang === 'ko' && !rule.is_published ? '\n<!-- hidden -->' : ''
    const body = (lang === 'ko' ? rule.body_ko : rule.body_en).trim()
    blocks.push(`## ${title}${hidden}${body ? `\n\n${body}` : ''}`)
  }
  return { lang, filename: `rules.${lang}.md`, markdown: `${blocks.join('\n\n')}\n` }
}

const routes: Record<string, (query: URLSearchParams) => unknown> = {
  '/api/health': () => ({ status: 'ok' }),
  '/api/settings/public': () => ({ ...settings, event_timezone: TIMEZONE }),
  '/api/schedule': publicSchedule,
  '/api/rules': publicRules,
  '/api/teams': () => teams.filter((team) => team.is_active).map(publicTeam),
  '/api/qualifying/leaderboard': leaderboard,
  '/api/bracket': bracket,
  '/api/results': () => ({ entries: [] }),
  '/api/live/state': liveState,
  '/api/admin/auth/me': () => ({ id: 1, username: 'mock-admin', role: 'admin' }),
  '/api/admin/settings': () => ({ ...settings, monitor_key: 'mock-monitor-key' }),
  // MOCK 에는 초안이 따로 없으므로 미리보기는 공개 화면과 같고, 게시할 것도 없다
  '/api/admin/preview/settings': () => ({ ...settings, event_timezone: TIMEZONE }),
  '/api/admin/preview/schedule': publicSchedule,
  '/api/admin/preview/rules': publicRules,
  '/api/admin/publish': () =>
    (['schedule', 'rules', 'settings'] as const).map((resource) => ({
      resource,
      pending: false,
      published_at: rounds[0].created_at,
      published_by: 'mock-admin',
    })),
  '/api/admin/ranking': ranking,
  '/api/admin/monitor/access': () => ({ via: 'session', username: 'mock-admin' }),
  '/api/admin/schedule': () => schedule,
  '/api/admin/rules': () => rules,
  '/api/admin/rules/document': rulesDocument,
  '/api/admin/teams': () => teams,
  '/api/admin/qualifying/laps': (query) => {
    const limit = Number(query.get('limit') ?? 20)
    const teamId = query.get('team_id')
    return [...laps]
      .filter((lap) => !teamId || lap.team_id === Number(teamId))
      .reverse()
      .slice(0, limit)
  },
  '/api/admin/qualifying/events': () => [],
  '/api/admin/qualifying/inspection': () =>
    teams
      .filter((team) => team.is_active)
      .map((team) => ({ team: publicTeam(team), inspected_at: null, order: null })),
  '/api/admin/bracket/rounds': () => rounds,
  '/api/admin/users': () => [
    {
      id: 1,
      username: 'mock-admin',
      role: 'admin',
      is_active: true,
      created_at: rounds[0].created_at,
      updated_at: rounds[0].created_at,
    },
    {
      id: 2,
      username: 'mock-referee',
      role: 'referee',
      is_active: true,
      created_at: rounds[0].created_at,
      updated_at: rounds[0].created_at,
    },
  ],
  '/api/admin/audit': (query) => ({
    items: [],
    total: 0,
    limit: Number(query.get('limit') ?? 50),
    offset: Number(query.get('offset') ?? 0),
  }),
}

export async function mockRequest<T>(method: string, path: string, _body?: unknown): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120))
  if (method !== 'GET') {
    throw new ApiError(403, 'MOCK_READONLY', 'MOCK 모드에서는 저장할 수 없습니다')
  }
  const url = new URL(path, 'http://mock.local')
  const handler = routes[url.pathname]
  if (!handler) throw new ApiError(404, 'NOT_FOUND', `${url.pathname} 없음`)
  // 화면이 캐시 객체를 고쳐도 mock 상태가 바뀌지 않도록 복사해서 준다
  return structuredClone(handler(url.searchParams)) as T
}
