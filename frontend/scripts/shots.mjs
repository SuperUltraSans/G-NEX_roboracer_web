// 디자인 자기 점검용 스크린샷
//   VITE_USE_MOCK=true npx vite --port 5180 &   (또는 실제 백엔드에 붙은 개발 서버)
//   SHOTS_URL=http://localhost:5180 SHOTS_ROUND=round1 npm run shots
// 결과: ../design-review/<라운드>/<페이지>-<폭>-<언어>.png, 가로 넘침은 콘솔에 출력한다.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const baseUrl = (process.env.SHOTS_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const round = process.env.SHOTS_ROUND ?? 'round1'
const pages = (process.env.SHOTS_PAGES ?? 'home,schedule,rules,apply,live,admin-qualifying').split(
  ',',
)
const sizes = [
  [1440, 900],
  [768, 1024],
  [390, 844],
]
const langs = ['ko', 'en']
const paths = {
  home: '/',
  schedule: '/schedule',
  rules: '/rules',
  apply: '/apply',
  live: '/live',
  'admin-qualifying': '/admin/qualifying',
}

const browser = await chromium.launch()
const problems = []
{
  const outDir = path.join(root, '..', 'design-review', round)
  await mkdir(outDir, { recursive: true })
  for (const name of pages) {
    for (const [width, height] of sizes) {
      for (const lang of langs) {
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: width < 500 ? 2 : 1,
        })
        await context.addInitScript((value) => {
          try {
            localStorage.setItem('rr.lang', value)
          } catch {
            // 저장소가 막혀도 계속한다
          }
        }, lang)
        const page = await context.newPage()
        await page.goto(`${baseUrl}${paths[name]}`, { waitUntil: 'networkidle' })
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(1500)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        if (overflow > 0) problems.push(`${name} ${width} ${lang}: 가로 넘침 ${overflow}px`)
        await page.screenshot({
          path: path.join(outDir, `${name}-${width}-${lang}.png`),
          fullPage: true,
        })
        await context.close()
      }
    }
  }
}
await browser.close()
console.log(problems.length ? problems.join('\n') : '가로 넘침 없음')
console.log(`저장: design-review/${round}/`)
