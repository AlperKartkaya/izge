export type AgentInlineToken =
  | { kind: 'text' | 'bold' | 'mention' | 'code'; value: string }
  | { kind: 'link'; value: string; href: string }
  | { kind: 'source'; value: string; sourceIndex: number }

export function tokenizeAgentText(value: string, sourceCount = Infinity): AgentInlineToken[] {
  const tokens: AgentInlineToken[] = []
  const matcher = /(`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\[(\d+)\]|@[iİı]zge\b)/giu
  let cursor = 0
  for (const match of value.matchAll(matcher)) {
    if (match.index > cursor) tokens.push({ kind: 'text', value: value.slice(cursor, match.index) })
    if (match[2]) tokens.push({ kind: 'code', value: match[2] })
    else if (match[3] && match[4]) tokens.push({ kind: 'link', value: match[3], href: match[4] })
    else if (match[5]) tokens.push({ kind: 'bold', value: match[5] })
    else if (match[6]) {
      const sourceIndex = Number(match[6]) - 1
      tokens.push(sourceIndex >= 0 && sourceIndex < sourceCount
        ? { kind: 'source', value: match[0], sourceIndex }
        : { kind: 'text', value: match[0] })
    }
    else tokens.push({ kind: 'mention', value: match[0] })
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) tokens.push({ kind: 'text', value: value.slice(cursor) })
  return tokens
}

export function insertIzgeMention(value: string) {
  return insertIzgeMentionAtCaret(value, value.length).value
}

export function insertIzgeMentionAtCaret(value: string, selectionStart: number, selectionEnd = selectionStart) {
  const beforeCaret = value.slice(0, selectionStart)
  const match = beforeCaret.match(/(^|\s)@[\p{L}]*$/u)
  if (!match || match.index === undefined) {
    const prefix = value.slice(0, selectionStart)
    const suffix = value.slice(selectionEnd)
    const mention = `${prefix && !/\s$/u.test(prefix) ? ' ' : ''}@izge `
    return { value: `${prefix}${mention}${suffix}`, caret: prefix.length + mention.length }
  }

  const tokenStart = match.index + match[1].length
  const tokenEnd = selectionEnd + (value.slice(selectionEnd).match(/^[\p{L}]*/u)?.[0].length ?? 0)
  const suffix = value.slice(tokenEnd).replace(/^ /u, '')
  const nextValue = `${value.slice(0, tokenStart)}@izge ${suffix}`
  return { value: nextValue, caret: tokenStart + '@izge '.length }
}

export function buildIzgeFollowUp(question: string) {
  return `@izge ${question.trim()} `
}

export function focusComposerAtEnd(element: HTMLTextAreaElement | null) {
  window.requestAnimationFrame(() => {
    if (!element) return
    element.focus()
    const end = element.value.length
    element.setSelectionRange(end, end)
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}
