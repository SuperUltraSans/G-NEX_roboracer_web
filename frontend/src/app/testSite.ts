// 테스트 사이트(운영 DB 복사본으로 예선·본선을 연습하는 곳)로 빌드했는지. 운영 사이트에서는 false.
export const TEST_SITE = import.meta.env.VITE_TEST_SITE === 'true'
// 테스트 띠의 '실제 사이트' 링크 (비우면 링크를 숨긴다)
export const REAL_SITE_URL: string = import.meta.env.VITE_REAL_SITE_URL ?? ''
