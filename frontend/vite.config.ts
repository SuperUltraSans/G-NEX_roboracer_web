import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// 서브패스(예: /roboracer/) 아래에 배포할 때는 빌드 시 VITE_BASE_PATH 로 넘긴다.
// 개발 서버는 기본값 '/' 로 띄우고 /api, /ws 를 백엔드로 넘긴다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = normalizeBase(env.VITE_BASE_PATH)
  const backend = env.DEV_BACKEND ?? 'http://127.0.0.1:8000'
  const stripBase = (path: string) => path.slice(base.length - 1)

  return {
    base,
    plugins: [react()],
    server: {
      proxy: {
        [`${base}api`]: { target: backend, rewrite: stripBase },
        [`${base}ws`]: { target: backend, ws: true, rewrite: stripBase },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})

function normalizeBase(value: string | undefined): string {
  if (!value) return '/'
  const trimmed = value.replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
}
