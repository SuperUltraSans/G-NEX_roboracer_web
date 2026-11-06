import manifest from '../../../public/hero/manifest.json'
import styles from './HeroMedia.module.css'

interface Variant {
  prefix: string
  widths: number[]
  formats: string[]
  aspect: number
}

const MIME: Record<string, string> = { avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg' }
const PORTRAIT_MEDIA = '(max-width: 767px) and (orientation: portrait)'
const base = `${import.meta.env.BASE_URL}hero/`

function srcSet(variant: Variant, format: string) {
  return variant.widths
    .map((width) => `${base}${variant.prefix}-${width}.${format} ${width}w`)
    .join(', ')
}

/**
 * 히어로 배경. 변환된 이미지(npm run build:hero)가 있으면 avif/webp/jpg 반응형으로,
 * 없으면 남색 바탕 위 얇은 시안 원호 플레이스홀더를 그린다.
 */
export function HeroMedia() {
  const landscape = manifest.landscape as Variant | null
  const portrait = manifest.portrait as Variant | null

  if (!landscape) {
    return (
      <div className={styles.placeholder} aria-hidden="true">
        <svg viewBox="0 0 100 100" className={styles.arc}>
          <circle cx="50" cy="50" r="40" pathLength="100" />
        </svg>
      </div>
    )
  }

  const fallbackWidth = landscape.widths.includes(1920) ? 1920 : landscape.widths[0]
  return (
    <picture className={styles.picture}>
      {portrait &&
        portrait.formats.map((format) => (
          <source
            key={`p-${format}`}
            media={PORTRAIT_MEDIA}
            type={MIME[format]}
            srcSet={srcSet(portrait, format)}
            sizes="100vw"
          />
        ))}
      {landscape.formats
        .filter((format) => format !== 'jpg')
        .map((format) => (
          <source
            key={format}
            type={MIME[format]}
            srcSet={srcSet(landscape, format)}
            sizes="100vw"
          />
        ))}
      <img
        className={styles.image}
        src={`${base}${landscape.prefix}-${fallbackWidth}.jpg`}
        srcSet={srcSet(landscape, 'jpg')}
        sizes="100vw"
        alt=""
        fetchPriority="high"
        decoding="async"
      />
    </picture>
  )
}
