import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useLanguage } from '../lib/i18n'
import type { AgentModelCatalogRead, AgentModelProfileId, AgentRequestOptions } from '../lib/types'

interface StoredControls {
  modelProfile?: AgentModelProfileId
  efforts?: Partial<Record<AgentModelProfileId, string>>
  allowExternalTools?: boolean
  requestReviewer?: boolean
}
const profileIds: AgentModelProfileId[] = ['ollama', 'onprem', 'glm', 'deepseek', 'codex']

function storageKey(userId: string) { return `izge-agent-controls:${userId}` }
function readStored(userId: string): StoredControls {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey(userId)) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const value = parsed as StoredControls
    return {
      modelProfile: profileIds.includes(value.modelProfile as AgentModelProfileId) ? value.modelProfile : undefined,
      efforts: value.efforts && typeof value.efforts === 'object' && !Array.isArray(value.efforts) ? value.efforts : {},
      allowExternalTools: value.allowExternalTools === true,
      requestReviewer: value.requestReviewer === true,
    }
  } catch { return {} }
}

export function useAgentControls(token: string | undefined, userId: string | undefined) {
  const { language } = useLanguage()
  const stored = useMemo(() => userId ? readStored(userId) : {}, [userId])
  const [catalog, setCatalog] = useState<AgentModelCatalogRead | null>(null)
  const [modelProfile, setModelProfile] = useState<AgentModelProfileId | ''>(stored.modelProfile ?? '')
  const [efforts, setEfforts] = useState<Partial<Record<AgentModelProfileId, string>>>(stored.efforts ?? {})
  const [allowExternalTools, setAllowExternalTools] = useState(stored.allowExternalTools ?? false)
  const [requestReviewer, setRequestReviewer] = useState(stored.requestReviewer ?? false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api.getAgentModels(token).then((next) => {
      if (cancelled) return
      setCatalog(next)
      setModelProfile((current) => {
        const selected = next.profiles.find((profile) => profile.id === current && profile.enabled)
        if (selected) return selected.id
        return (next.profiles.find((profile) => profile.id === next.default_profile && profile.enabled) ?? next.profiles.find((profile) => profile.enabled))?.id ?? ''
      })
      setLoadError(false)
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [language, token])

  useEffect(() => {
    if (!userId || !catalog || !modelProfile) return
    try { globalThis.localStorage?.setItem(storageKey(userId), JSON.stringify({ modelProfile, efforts, allowExternalTools, requestReviewer })) } catch { /* Private browsing can disable storage. */ }
  }, [allowExternalTools, catalog, efforts, modelProfile, requestReviewer, userId])

  const selected = catalog?.profiles.find((profile) => profile.id === modelProfile) ?? null
  const reasoningEffort = selected?.supported_efforts.includes(efforts[selected.id] ?? '') ? efforts[selected.id] : undefined
  const webSearchAvailable = selected?.native_web_search === true || catalog?.tools.web_search === true
  const externalToolsAvailable = webSearchAvailable || catalog?.tools.mcp === true
  const effectiveExternalTools = allowExternalTools && externalToolsAvailable
  const requestOptions: AgentRequestOptions = {
    ...(selected ? { model_profile: selected.id } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    allow_external_tools: effectiveExternalTools,
    request_reviewer: requestReviewer,
  }

  return {
    catalog, selected, modelProfile, reasoningEffort, allowExternalTools: effectiveExternalTools, webSearchAvailable, requestReviewer, loadError, requestOptions,
    setModelProfile,
    setReasoningEffort: (effort: string) => selected && setEfforts((current) => ({ ...current, [selected.id]: effort })),
    setAllowExternalTools, setRequestReviewer,
  }
}
