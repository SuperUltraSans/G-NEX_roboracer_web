import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import MarkdownRenderer from './MarkdownRenderer'

const html = (markdown: string) =>
  renderToStaticMarkup(createElement(MarkdownRenderer, { children: markdown }))

describe('MarkdownRenderer', () => {
  it('괄호·따옴표로 끝나는 굵게 뒤에 조사가 붙어도 굵게 한다', () => {
    expect(html('임시 **항목(예시)**을 확인')).toContain('<strong>항목(예시)</strong>을')
    expect(html('임시 **“따옴표”**는 확인')).toContain('<strong>“따옴표”</strong>는')
    expect(html('평소처럼 **굵게** 쓴 글')).toContain('<strong>굵게</strong>')
  })

  it('물결표 하나는 취소선으로 바꾸지 않는다', () => {
    expect(html('10:00~13:00 임시')).not.toContain('<del>')
  })
})
