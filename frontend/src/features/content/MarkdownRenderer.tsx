import MarkdownPreview from '@uiw/react-markdown-preview/nohighlight'
import type { Element, ElementContent, Root } from 'hast'
import { useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultUrlTransform, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import styles from './Markdown.module.css'
import { normalizeTableCells } from './normalizeTables'
import { ruleFileUrl, ruleLinkUrl } from './ruleFiles'

// 문서 본문의 제목은 섹션 제목(h2) 아래 단계로 그린다. 본문 '#'(h1)이 목차에 들어가는 큰 제목이다.
const HEADING_SHIFT: Record<string, string> = {
  h1: 'h3',
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
  h5: 'h6',
  h6: 'h6',
}

// GitHub 기준 허용 목록에 GitHub 알림 블록(> [!NOTE] 등)의 클래스만 더한다. 스크립트, 이벤트 속성 등은 지운다.
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', /^markdown-alert/]],
    p: [...(defaultSchema.attributes?.p ?? []), ['className', 'markdown-alert-title']],
  },
}

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

function isExternal(href: unknown): boolean {
  if (typeof href !== 'string') return false
  try {
    return new URL(href, window.location.href).origin !== window.location.origin
  } catch {
    return false
  }
}

/**
 * sanitize 다음에 도는 마지막 단계: 제목 단계 조정, 목차용 id, 라이브러리가 넣었다가
 * sanitize 로 아이콘이 빠진 빈 앵커 정리, 외부 링크는 새 탭.
 */
function rehypeViewer(options: { idPrefix: string }) {
  return (tree: Root) => {
    let headings = 0
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== 'element') continue
        const level = HEADING_SHIFT[child.tagName]
        if (level) {
          headings += 1
          child.tagName = level
          child.children = child.children.filter(
            (item) => !(item.type === 'element' && item.tagName === 'a' && !textOf(item).trim()),
          )
          child.properties = { ...child.properties, id: `${options.idPrefix}-${headings}` }
          if (level === 'h3') child.properties.dataToc = ''
        }
        if (child.tagName === 'a' && isExternal(child.properties.href)) {
          child.properties = {
            ...child.properties,
            target: '_blank',
            rel: ['noopener', 'noreferrer'],
          }
        }
        walk(child)
      }
    }
    walk(tree)
  }
}

function urlTransform(url: string, key: string, node: Readonly<Element>): string {
  const safe = defaultUrlTransform(url)
  if (key === 'src' && node.tagName === 'img') return ruleFileUrl(safe)
  if (key === 'href' && node.tagName === 'a') return ruleLinkUrl(safe)
  return safe
}

/** 그림을 못 불러오면 깨진 아이콘 대신 설명 문구를 보여 준다 */
function RuleImage({ node: _node, alt, src, ...rest }: ComponentProps<'img'> & ExtraProps) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  if (failed || !src) {
    return (
      <span className={styles.missingImage}>
        {t('rules.imageMissing')}
        {alt ? `: ${alt}` : ''}
      </span>
    )
  }
  return <img src={src} alt={alt ?? ''} loading="lazy" onError={() => setFailed(true)} {...rest} />
}

const components = {
  // 경로가 바뀌면(미리보기에서 고칠 때) 실패 상태를 처음부터 다시 본다
  img: (props: ComponentProps<'img'> & ExtraProps) => (
    <RuleImage key={String(props.src)} {...props} />
  ),
}

interface Props {
  children: string
  /** 목차 링크용 제목 id 앞부분. 한 화면에 문서가 여러 개면 서로 달라야 한다 */
  idPrefix?: string
}

/**
 * Markdown 뷰어 (@uiw/react-markdown-preview). 표, 그림, 표 칸의 <br> 같은 HTML 을 그리되
 * rehype-sanitize 로 위험한 태그와 속성은 지운다.
 */
export default function MarkdownRenderer({ children, idPrefix = 'md' }: Props) {
  return (
    <MarkdownPreview
      source={normalizeTableCells(children)}
      className={styles.viewer}
      wrapperElement={{ 'data-color-mode': 'light' }}
      skipHtml={false}
      disableCopy
      urlTransform={urlTransform}
      components={components}
      // 라이브러리는 rehype-raw 를 맨 뒤에 붙인다. sanitize 와 마무리 단계는 그보다 뒤에 둔다
      pluginsFilter={(type, plugins) =>
        type === 'rehype'
          ? [...plugins, [rehypeSanitize, schema], [rehypeViewer, { idPrefix }]]
          : // 시간표의 '10:00~13:00' 같은 물결표가 취소선이 되지 않게 '~한 개' 취소선은 끈다 ('~~' 는 그대로)
            plugins.map((plugin) =>
              plugin === remarkGfm ? [remarkGfm, { singleTilde: false }] : plugin,
            )
      }
    />
  )
}
