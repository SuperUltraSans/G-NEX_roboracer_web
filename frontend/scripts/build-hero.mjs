// 히어로 원본 이미지를 반응형 avif/webp/jpg 로 변환한다 (doc/Design.md 6.8).
//   npm run build:hero
// 입력: assets-src/hero/hero-source.png (필수), hero-mobile-source.png (선택, 세로형)
// 출력: public/hero/hero-{폭}.{avif,webp,jpg}, hero-mobile-{폭}.*, manifest.json
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// 밴딩 점검 결과에 따라 조정한다. 바꾸면 doc/DECISIONS.md 에 기록한다.
const QUALITY = { avif: 62, webp: 88, jpg: 86 }
const WIDTHS = { landscape: [2560, 1920, 1280, 828], portrait: [1080, 750] }
const MIN_RECOMMENDED_WIDTH = 1920

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcDir = path.join(root, 'assets-src/hero')
const outDir = path.join(root, 'public/hero')
const sources = {
  landscape: { file: 'hero-source.png', prefix: 'hero' },
  portrait: { file: 'hero-mobile-source.png', prefix: 'hero-mobile' },
}

async function clean() {
  await mkdir(outDir, { recursive: true })
  for (const name of await readdir(outDir)) {
    if (name !== '.gitkeep') await rm(path.join(outDir, name))
  }
}

async function encode(input, width, format, file) {
  const pipeline = sharp(input).resize({ width, withoutEnlargement: true })
  if (format === 'avif') pipeline.avif({ quality: QUALITY.avif, effort: 6 })
  if (format === 'webp') pipeline.webp({ quality: QUALITY.webp, effort: 6 })
  if (format === 'jpg') pipeline.jpeg({ quality: QUALITY.jpg, mozjpeg: true, progressive: true })
  await pipeline.toFile(file)
  return (await stat(file)).size
}

async function build(kind) {
  const { file, prefix } = sources[kind]
  const input = path.join(srcDir, file)
  if (!existsSync(input)) return null

  const meta = await sharp(input).metadata()
  if (kind === 'landscape' && meta.width < MIN_RECOMMENDED_WIDTH) {
    console.warn(
      `! ${file} 폭이 ${meta.width}px 로 ${MIN_RECOMMENDED_WIDTH}px 보다 좁습니다. ` +
        '업스케일 여부를 사용자에게 확인하고 doc/DECISIONS.md 에 기록하세요.',
    )
  }
  // 업스케일하지 않는다. 목록보다 원본이 작으면 원본 폭을 가장 큰 크기로 쓴다.
  const widths = WIDTHS[kind].filter((width) => width <= meta.width)
  if (!widths.includes(meta.width) && meta.width < WIDTHS[kind][0]) widths.unshift(meta.width)

  for (const width of widths) {
    for (const format of ['avif', 'webp', 'jpg']) {
      const name = `${prefix}-${width}.${format}`
      const size = await encode(input, width, format, path.join(outDir, name))
      console.log(`  ${name.padEnd(26)} ${(size / 1024).toFixed(0).padStart(5)} KB`)
    }
  }
  return {
    prefix,
    widths,
    formats: ['avif', 'webp', 'jpg'],
    aspect: Number((meta.width / meta.height).toFixed(4)),
  }
}

await clean()
const manifest = { landscape: await build('landscape'), portrait: await build('portrait') }
if (!manifest.landscape) {
  console.log(
    `원본(${path.join('assets-src/hero', sources.landscape.file)})이 없어 플레이스홀더를 씁니다.`,
  )
}
await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log('public/hero/manifest.json 작성')
