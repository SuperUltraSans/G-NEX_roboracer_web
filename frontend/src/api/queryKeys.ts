// 공개 쿼리 키가 앞에 오고 관리자 키는 그 뒤에 붙는다.
// ['schedule'] 을 무효화하면 ['schedule', 'admin'] 도 함께 무효화된다.
export const queryKeys = {
  settingsPublic: ['settings', 'public'] as const,
  settingsAdmin: ['settings', 'admin'] as const,
  schedule: ['schedule'] as const,
  scheduleAdmin: ['schedule', 'admin'] as const,
  rules: ['rules'] as const,
  rulesAdmin: ['rules', 'admin'] as const,
  teams: ['teams'] as const,
  teamsAdmin: ['teams', 'admin'] as const,
  leaderboard: ['qualifying', 'leaderboard'] as const,
  laps: ['qualifying', 'laps'] as const,
  bracket: ['bracket'] as const,
  bracketRounds: ['bracket', 'rounds'] as const,
  liveState: ['live', 'state'] as const,
  me: ['auth', 'me'] as const,
  users: ['users'] as const,
  audit: ['audit'] as const,
}

export const contentKeys = {
  schedule: queryKeys.schedule,
  rules: queryKeys.rules,
  settings: ['settings'] as const,
  teams: queryKeys.teams,
}
