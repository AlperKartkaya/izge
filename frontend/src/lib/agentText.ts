export type AgentInlineToken =
  | { kind: 'text' | 'bold' | 'mention'; value: string }
  | { kind: 'source'; value: string; sourceIndex: number }

export function tokenizeAgentText(value: string, sourceCount = Infinity): AgentInlineToken[] {
  const tokens: AgentInlineToken[] = []
  const matcher = /(\*\*([^*\n]+)\*\*|\[(\d+)\]|@[iİı]zge\b)/giu
  let cursor = 0
  for (const match of value.matchAll(matcher)) {
    if (match.index > cursor) tokens.push({ kind: 'text', value: value.slice(cursor, match.index) })
    if (match[2]) tokens.push({ kind: 'bold', value: match[2] })
    else if (match[3]) {
      const sourceIndex = Number(match[3]) - 1
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
  const match = value.match(/(^|\s)@[\p{L}]*$/u)
  if (!match || match.index === undefined) return `${value}${value && !value.endsWith(' ') ? ' ' : ''}@izge `
  return `${value.slice(0, match.index)}${match[1]}@izge `
}
