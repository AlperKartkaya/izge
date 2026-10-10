// A safe display subset: source HTML remains text, never injected into the page.
export type MarkdownBlock =
  | { kind: 'paragraph' | 'quote' | 'code'; text: string }
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'list'; items: string[]; ordered: boolean }
  | { kind: 'table'; headers: string[]; rows: string[][] }

function cells(line: string) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()) }

export function markdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: MarkdownBlock[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (/^\s*```/.test(line)) {
      const content: string[] = []; i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) content.push(lines[i++])
      if (i < lines.length) i++
      blocks.push({ kind: 'code', text: content.join('\n') }); continue
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/)
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line); const rows: string[][] = []; i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      blocks.push({ kind: 'table', headers, rows }); continue
    }
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/)
    if (item) {
      const ordered = Boolean(item[2]); const items: string[] = []
      while (i < lines.length) {
        const next = lines[i].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/)
        if (!next || Boolean(next[2]) !== ordered) break
        items.push(next[3]); i++
      }
      blocks.push({ kind: 'list', ordered, items }); continue
    }
    if (/^\s*>\s?/.test(line)) { blocks.push({ kind: 'quote', text: line.replace(/^\s*>\s?/, '') }); i++; continue }
    blocks.push({ kind: 'paragraph', text: line }); i++
  }
  return blocks
}
