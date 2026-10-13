// Notion 등에서 내보낸 Markdown 은 표 칸 안의 줄바꿈을 그대로 넣어 GFM 표가 중간에서 끊긴다.
// 표 안에서 '|' 로 끝나지 않은 행은 다음 줄들을 <br> 로 이어 붙여 한 행으로 만든다.
// (서버도 업로드 때 같은 정리를 한다. 이미 저장된 문서도 바로 제대로 보이도록 화면에서 한 번 더 한다)

const FENCE = /^\s*(`{3,}|~{3,})/
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

export function normalizeTableCells(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let fence: string | null = null
  let inTable = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fenceMatch = FENCE.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null
      }
      out.push(line)
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      inTable = false
      out.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!inTable) {
      const next = lines[i + 1]
      if (
        trimmed.startsWith('|') &&
        next !== undefined &&
        next.includes('-') &&
        DELIMITER.test(next)
      ) {
        inTable = true
        out.push(line, next)
        i += 1
        continue
      }
      out.push(line)
      continue
    }

    if (!trimmed.startsWith('|')) {
      inTable = false
      out.push(line)
      continue
    }

    let row = line.trimEnd()
    while (!row.endsWith('|') && i + 1 < lines.length) {
      const continuation = lines[i + 1].trim()
      if (continuation === '' || continuation.startsWith('|')) break
      row = `${row}<br>${continuation}`
      i += 1
    }
    out.push(row)
  }
  return out.join('\n')
}
