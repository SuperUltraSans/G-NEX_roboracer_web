// 공개 쿼리 키가 앞에 오고 관리자 키는 그 뒤에 붙는다.
// ['schedule'] 을 무효화하면 ['schedule', 'admin'] 도 함께 무효화된다.
export const queryKeys = {
  settingsPublic: ['settings', 'public'] as const,
  settingsAdmin: ['settings', 'admin'] as const,
  // 미리보기(게시하지 않은 초안). 공개 키 앞부분을 같이 써서 콘텐츠가 바뀌면 함께 다시 받는다
  settingsPreview: ['settings', 'preview'] as const,
  schedulePreview: ['schedule', 'preview'] as const,
  rulesPreview: ['rules', 'preview'] as const,
  publish: ['publish'] as const,
  schedule: ['schedule'] as const,
  scheduleAdmin: ['schedule', 'admin'] as const,
  rules: ['rules'] as const,
  rulesAdmin: ['rules', 'admin'] as const,
  teams: ['teams'] as const,
  teamsAdmin: ['teams', 'admin'] as const,
  leaderboard: ['qualifying', 'leaderboard'] as const,
  laps: ['qualifying', 'laps'] as const,
  qualifyingEvents: ['qualifying', 'events'] as const,
  inspection: ['qualifying', 'inspection'] as const,
  bracket: ['bracket'] as const,
  results: ['results'] as const,
  bracketRounds: ['bracket', 'rounds'] as const,
  liveState: ['live', 'state'] as const,
  ranking: ['ranking'] as const,
  monitorAccess: ['monitor', 'access'] as const,
  me: ['auth', 'me'] as const,
  users: ['users'] as const,
  audit: ['audit'] as const,
}

export const contentKeys = {
  schedule: queryKeys.schedule,
  rules: queryKeys.rules,
  settings: ['settings'] as const,
  teams: queryKeys.teams,
  ranking: queryKeys.ranking,
}
