// 대회가 끝나 관리자 기능을 프록시에서 잠갔을 때 빌드 값으로 운영진 로그인 링크를 숨긴다
export const HIDE_ADMIN_LINK = import.meta.env.VITE_HIDE_ADMIN_LINK === 'true'
