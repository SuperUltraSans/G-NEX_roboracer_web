// mock 모드의 메모리 상태와 계산. 백엔드 services/leaderboard.py, bracket.py 의 규칙을 단순하게 따라 한다.
// 팀명은 명백한 가짜 이름(Mock Team NN)이고, 정해지지 않은 대회 정보는 '임시 ~'로 둔다.
import type {
  Bracket,
  Leaderboard,
  LeaderboardRow,
  LiveState,
  MatchStatus,
  Mission,
  Phase,
  QualifyingLapAdmin,
  Ranking,
  RuleSectionAdmin,
  ScheduleItemAdmin,
  TeamAdmin,
} from '../types'

const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const now = Date.now()
const created = iso(now - 72 * HOUR)

export const teams: TeamAdmin[] = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return {
    id: i + 1,
    name_ko: `Mock Team ${n}`,
    name_en: `Mock Team ${n}`,
    affiliation_ko: 'Mock University',
    affiliation_en: i % 3 === 0 ? '' : 'Mock University',
    is_active: true,
    version: 1,
    created_at: created,
    updated_at: created,
  }
})

// 지금 시각을 기준으로 지난 일정, 진행 중 일정, 다음 일정이 모두 보이게 한다
const hourMark = Math.floor(now / HOUR) * HOUR
const at = (hoursFromNow: number) => iso(hourMark + hoursFromNow * HOUR)

const scheduleSeed: [string, string, number, number | null][] = [
  ['임시 참가 신청 마감', 'Temporary registration deadline', -72, null],
  ['임시 등록과 차량 검사', 'Temporary check-in and inspection', -3, -1.5],
  ['임시 예선 세션', 'Temporary qualifying session', -1, 1],
  ['임시 점심', '', 1, 2],
  ['임시 본선 토너먼트', 'Temporary finals', 2, 4.5],
  ['임시 시상식', 'Temporary awards', 26, 27],
]

export const schedule: ScheduleItemAdmin[] = scheduleSeed.map(([ko, en, start, end], i) => ({
  id: i + 1,
  starts_at: at(start),
  ends_at: end === null ? null : at(end),
  title_ko: ko,
  title_en: en,
  location_ko: i === 0 ? null : '임시 장소',
  location_en: i === 0 ? null : '',
  description_ko: i === 2 ? '임시 일정 설명' : null,
  description_en: null,
  sort_order: i,
  is_published: true,
  version: 1,
  created_at: created,
  updated_at: created,
}))

export const rules: RuleSectionAdmin[] = [
  {
    id: 1,
    title_ko: '임시 타임 테이블',
    title_en: 'Temporary timetable',
    body_ko: [
      '### 임시 1일차',
      '',
      '| 순서 | 시간 | 내용 |',
      '| --- | --- | --- |',
      '| 1 | 10:00~13:00 | 임시 등록 |',
      '| 2 | 13:00~13:30 | 임시 운영 설명 |',
      '| 3 | 14:30~20:00 | 14:30~15:00 임시 연습 1 ',
      '15:00~16:00 임시 연습 2',
      '16:00~17:00 임시 연습 3 |',
      '',
      '### 임시 2일차',
      '',
      '| 순서 | 시간 | 내용 |',
      '| --- | --- | --- |',
      '| 1 | 8:00~9:00 | 임시 자유 연습 |',
      '| 2 | 9:00~9:30 | 임시 개회식 |',
    ].join('\n'),
    body_en: '',
    sort_order: 0,
  },
  {
    id: 2,
    title_ko: '임시 규칙',
    title_en: 'Temporary rules',
    body_ko: [
      '[임시 참고 링크](https://example.com)',
      '',
      '# ※ 임시 공지 사항',
      '',
      '---',
      '',
      '- 임시 공지 항목 1입니다. **굵은 글씨**와 `코드`가 들어 있습니다.',
      '- 임시 공지 항목 2',
      '    - 임시 하위 항목',
      '',
      '# **1. 임시 개요**',
      '',
      '임시 개요 문단입니다. 대회 규칙 문서는 길고 표가 많으므로 화면 폭에 맞춰 넓게 보여 줍니다. '.repeat(
        3,
      ),
      '',
      '# **2. 임시 차량 규격**',
      '',
      '| 항목 | 기준 | 비고 | 측정 방법 | 위반 시 | 확인 시점 | 담당 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 임시 크기 | 임시 기준값 | 임시 비고 문구가 조금 길게 들어갑니다 | 임시 측정 방법 | 임시 조치 | 임시 시점 | 임시 담당 |',
      '| 임시 무게 | 임시 기준값 | 임시 비고 | 임시 측정 방법 | 임시 조치 | 임시 시점 | 임시 담당 |',
      '',
      '### **2.1 임시 세부 규정**',
      '',
      '> 임시 인용 문단입니다.',
      '',
      '1. 임시 순서 1',
      '2. 임시 순서 2',
      '',
      '# **3. 임시 예선**',
      '',
      '### **3.1 임시 일반**',
      '',
      '임시 예선 일반 규정 문단입니다.',
    ].join('\n'),
    body_en: '',
    sort_order: 1,
  },
  {
    id: 3,
    title_ko: '임시 본선 방식',
    title_en: '',
    body_ko: '임시 본선 방식 본문',
    body_en: '',
    sort_order: 2,
  },
].map((rule) => ({
  ...rule,
  is_published: true,
  version: 1,
  created_at: created,
  updated_at: created,
}))

let lapId = 0
export const laps: QualifyingLapAdmin[] = []

export function addLap(
  teamId: number,
  mission: Mission,
  status: 'valid' | 'invalid',
  lapTimeMs: number | null,
  at: number,
) {
  const team = teams.find((item) => item.id === teamId)!
  const attempt = laps.filter((lap) => lap.team_id === teamId).length + 1
  lapId += 1
  laps.push({
    id: lapId,
    team_id: teamId,
    team: publicTeam(team),
    attempt_no: attempt,
    mission,
    lap_time_ms: lapTimeMs,
    status,
    void_reason: null,
    recorded_at: iso(at),
    recorded_by_username: 'mock-referee',
    version: 1,
    updated_at: iso(at),
  })
}

// 팀별 예선 진행 (v=유효, x=무효, 숫자=Q3 유효 랩 수). 11·12번 팀은 아직 기록이 없다
const RUNS: [string, string, number][] = [
  ['vvv', 'vvv', 2],
  ['vvv', 'vxvvv', 1],
  ['vxvvv', 'vvv', 2],
  ['vvv', 'vvv', 1],
  ['vvv', 'vvx', 0],
  ['vvv', 'vx', 0],
  ['vvxv', '', 0],
  ['vx', '', 0],
  ['vvx', '', 0],
  ['x', '', 0],
]
RUNS.forEach(([q1, q2, q3], index) => {
  const team = index + 1
  let minute = 40 - team * 3
  const add = (mission: Mission, status: 'valid' | 'invalid', ms: number | null) =>
    addLap(team, mission, status, ms, now - (minute -= 0.3) * 60_000)
  for (const mark of q1) add('Q1', mark === 'v' ? 'valid' : 'invalid', null)
  for (const mark of q2) add('Q2', mark === 'v' ? 'valid' : 'invalid', null)
  for (let lap = 0; lap < q3; lap += 1) {
    add('Q3', 'valid', 40_000 + ((team * 7919 + lap * 104_729) % 600) * 10)
  }
})

export function publicTeam(team: TeamAdmin) {
  return {
    id: team.id,
    name_ko: team.name_ko,
    name_en: team.name_en,
    affiliation_ko: team.affiliation_ko,
    affiliation_en: team.affiliation_en,
  }
}

const PASS_LAPS = 3

function maxStreak(list: QualifyingLapAdmin[]): number {
  let best = 0
  let current = 0
  for (const lap of list) {
    current = lap.status === 'valid' ? current + 1 : 0
    best = Math.max(best, current)
  }
  return best
}

function trailingStreak(list: QualifyingLapAdmin[]): number {
  let count = 0
  for (const lap of [...list].reverse()) {
    if (lap.status !== 'valid') break
    count += 1
  }
  return count
}

/** 백엔드 services/leaderboard.py 의 규칙 순위를 단순하게 따라 한다 (검사 순서·판정은 없다) */
export function leaderboard(): Leaderboard {
  const rows: LeaderboardRow[] = teams
    .filter((team) => team.is_active)
    .map((team) => {
      const own = laps.filter((lap) => lap.team_id === team.id && lap.status !== 'void')
      const of = (mission: Mission) => own.filter((lap) => lap.mission === mission)
      const q1 = maxStreak(of('Q1'))
      const q1Passed = q1 >= PASS_LAPS
      const q2 = q1Passed ? maxStreak(of('Q2')) : 0
      const q2Passed = q1Passed && q2 >= PASS_LAPS
      const times = of('Q3')
        .filter((lap) => lap.status === 'valid' && lap.lap_time_ms !== null)
        .map((lap) => lap.lap_time_ms as number)
      const q3 = q2Passed && times.length > 0 ? Math.min(...times) : null
      const passed = Number(q1Passed) + Number(q2Passed) + Number(q3 !== null)
      const current: Mission = !q1Passed ? 'Q1' : !q2Passed ? 'Q2' : 'Q3'
      return {
        rank: null,
        team: publicTeam(team),
        fa: passed === 3,
        fa_lost: false,
        missions_passed: passed,
        current_mission: current,
        current_streak: trailingStreak(of(current)),
        q1_laps: of('Q1').length > 0 ? Math.min(q1, PASS_LAPS) : null,
        q2_laps: q1Passed ? Math.min(q2, PASS_LAPS) : null,
        q3_best_ms: q3,
        rank_drops: 0,
        attempts: own.length,
        last_recorded_at: own.at(-1)?.recorded_at ?? null,
      }
    })
  const record = (row: LeaderboardRow) =>
    row.missions_passed === 3
      ? (row.q3_best_ms ?? 0)
      : row.missions_passed === 2
        ? 0
        : -((row.missions_passed === 1 ? row.q2_laps : row.q1_laps) ?? 0)
  const started = rows
    .filter((row) => row.attempts > 0)
    .sort(
      (a, b) =>
        Number(b.fa) - Number(a.fa) ||
        b.missions_passed - a.missions_passed ||
        record(a) - record(b) ||
        a.team.id - b.team.id,
    )
    .map((row, index) => ({ ...row, rank: index + 1 }))
  const waiting = rows.filter((row) => row.attempts === 0)
  return { scoring: 'rules', rows: [...started, ...waiting] }
}

// ---- 대진: 8강 → 4강 → 3·4위전, 결승 ----

interface Slot {
  id: number
  team_id: number | null
  seed_rank: number | null
  source_match_id: number | null
  source_rank: number | null
  result_rank: number | null
  result_text: string | null
}

interface Match {
  id: number
  round_id: number
  label: string
  sort_order: number
  status: MatchStatus
  version: number
  slots: Slot[]
}

export const rounds = [
  { id: 1, name_ko: '8강', name_en: 'Quarterfinals', sort_order: 0 },
  { id: 2, name_ko: '4강', name_en: 'Semifinals', sort_order: 1 },
  { id: 3, name_ko: '3·4위전', name_en: 'Third place', sort_order: 2 },
  { id: 4, name_ko: '결승', name_en: 'Final', sort_order: 3 },
].map((round) => ({ ...round, created_at: created, updated_at: created }))

let slotId = 0
const slot = (part: Partial<Slot>): Slot => ({
  id: (slotId += 1),
  team_id: null,
  seed_rank: null,
  source_match_id: null,
  source_rank: null,
  result_rank: null,
  result_text: null,
  ...part,
})
const match = (id: number, round: number, order: number, slots: Slot[]): Match => ({
  id,
  round_id: round,
  label: `M${id}`,
  sort_order: order,
  status: 'scheduled',
  version: 1,
  slots,
})

export const matches: Match[] = [
  match(1, 1, 0, [slot({ seed_rank: 1 }), slot({ seed_rank: 8 })]),
  match(2, 1, 1, [slot({ seed_rank: 4 }), slot({ seed_rank: 5 })]),
  match(3, 1, 2, [slot({ seed_rank: 2 }), slot({ seed_rank: 7 })]),
  match(4, 1, 3, [slot({ seed_rank: 3 }), slot({ seed_rank: 6 })]),
  match(5, 2, 0, [
    slot({ source_match_id: 1, source_rank: 1 }),
    slot({ source_match_id: 2, source_rank: 1 }),
  ]),
  match(6, 2, 1, [
    slot({ source_match_id: 3, source_rank: 1 }),
    slot({ source_match_id: 4, source_rank: 1 }),
  ]),
  match(7, 3, 0, [
    slot({ source_match_id: 5, source_rank: 2 }),
    slot({ source_match_id: 6, source_rank: 2 }),
  ]),
  match(8, 4, 0, [
    slot({ source_match_id: 5, source_rank: 1 }),
    slot({ source_match_id: 6, source_rank: 1 }),
  ]),
]

/** MOCK 랭킹: 운영진이 예선 기록 순서 그대로 저장했다고 본다 */
export function ranking(): Ranking {
  const entries = leaderboard()
    .rows.filter((row) => row.rank !== null)
    .map((row, index) => ({ rank: index + 1, team: row.team }))
  return { entries, updated_at: entries.length ? iso(now - HOUR) : null }
}

export function seedFromRanking() {
  const entries = ranking().entries
  for (const item of matches) {
    if (item.status !== 'scheduled') continue
    for (const s of item.slots) {
      if (s.seed_rank)
        s.team_id = entries.find((entry) => entry.rank === s.seed_rank)?.team.id ?? null
    }
  }
}

export function resetBracket() {
  for (const item of matches) {
    item.status = 'scheduled'
    item.version += 1
    for (const s of item.slots) {
      s.result_rank = null
      s.result_text = null
      if (s.source_match_id) s.team_id = null
    }
  }
  seedFromRanking()
}

/** 결과를 정하고 후속 슬롯을 채운다 */
export function finishMatch(target: Match, ranking: number[]) {
  target.slots.forEach((s, index) => {
    s.result_rank = ranking[index]
    s.result_text = null
  })
  target.status = 'finished'
  target.version += 1
  for (const item of matches) {
    for (const s of item.slots) {
      if (s.source_match_id === target.id) {
        s.team_id =
          target.slots.find((source) => source.result_rank === s.source_rank)?.team_id ?? null
        item.version += 1
      }
    }
  }
}

export function bracket(): Bracket {
  return {
    rounds: rounds.map((round) => ({
      id: round.id,
      name_ko: round.name_ko,
      name_en: round.name_en,
      sort_order: round.sort_order,
      matches: matches
        .filter((item) => item.round_id === round.id)
        .map((item) => ({
          id: item.id,
          round_id: item.round_id,
          label: item.label,
          sort_order: item.sort_order,
          status: item.status,
          scheduled_at: null,
          version: item.version,
          slots: item.slots.map((s, index) => {
            const team = teams.find((candidate) => candidate.id === s.team_id)
            return {
              id: s.id,
              slot_index: index,
              team: team ? publicTeam(team) : null,
              seed_rank: s.seed_rank,
              source_match_id: s.source_match_id,
              source_match_label: s.source_match_id ? `M${s.source_match_id}` : null,
              source_rank: s.source_rank,
              placeholder_ko: null,
              placeholder_en: null,
              result_rank: s.result_rank,
              result_text: s.result_text,
            }
          }),
        })),
    })),
  }
}

// ---- 진행 상태 ----

export const live: {
  phase: Phase
  onTrack: number | null
  matchId: number | null
  updated: string
} = {
  phase: 'qualifying',
  onTrack: 3,
  matchId: null,
  updated: iso(now),
}

export function liveState(): LiveState {
  const team = teams.find((item) => item.id === live.onTrack)
  const current = matches.find((item) => item.id === live.matchId)
  return {
    phase: live.phase,
    on_track_team: team ? publicTeam(team) : null,
    current_match: current ? { id: current.id, label: current.label } : null,
    message_ko: '임시 운영 공지',
    message_en: '',
    updated_at: live.updated,
  }
}

export const settings = {
  apply_form_url: 'https://forms.gle/mock',
  apply_open_at: iso(now - 24 * HOUR),
  apply_close_at: iso(now + 7 * 24 * HOUR),
  apply_close_date_only: false,
  pages: {
    schedule: { open: true, note_ko: null, note_en: null },
    rules: { open: true, note_ko: null, note_en: null },
    live: { open: true, note_ko: null, note_en: null },
  },
}

seedFromRanking()
