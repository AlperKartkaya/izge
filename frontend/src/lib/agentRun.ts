import type { AgentRunStageRead } from './types'

export function latestAgentStages(stages: AgentRunStageRead[]): AgentRunStageRead[] {
  const positions = new Map<string, number>()
  const latest: AgentRunStageRead[] = []
  for (const stage of stages) {
    const position = positions.get(stage.key)
    if (position === undefined) {
      positions.set(stage.key, latest.length)
      latest.push(stage)
    } else {
      latest[position] = stage
    }
  }
  return latest
}

export function safeHttpUrl(value?: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
