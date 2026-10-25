import { getLanguage, translate } from './language.ts'
import type { DemoRunEvent } from './browserDemo.ts'
import type { AgentRunRead, AgentSourceRead } from './types.ts'

interface CannedRun {
  kind: string
  thread_title: string
  question: string
  answer: string
  sources: AgentSourceRead[]
  follow_ups: string[]
}

interface StaticDemoSnapshot {
  demo_config: unknown
  personas: Record<string, Record<string, unknown>>
  colleagues: unknown[]
  team_chat: Record<string, { workspace_id: string; generated_at: string; messages: Array<Record<string, unknown>> }>
  tasks: unknown
  artifacts: Array<Record<string, unknown>>
  artifact_details: Record<string, unknown>
  artifact_signals: Record<string, unknown>
  artifact_texts: Record<string, string>
  signals: unknown[]
  signal_details: Record<string, unknown>
  contradictions: unknown[]
  assumptions_stale: unknown[]
  next_actions: unknown[]
  graph_summary: unknown
  graph_timeline: unknown
  graph_temporal: unknown
  neighborhoods: Record<string, unknown>
  memory_details: Record<string, unknown>
  filesystem: unknown
  orchestration: unknown
  orchestration_runs: unknown
  orchestration_jobs: unknown
  readiness: unknown
  scenario_templates: unknown[]
  scenario_runs: unknown
  models: unknown
  canned_runs: Record<string, CannedRun>
}

const PERSONA_STORAGE_KEY = 'izge-static-demo-persona'

let staticModeActive =
  import.meta.env?.VITE_STATIC_DEMO === 'true' ||
  Boolean(globalThis.location?.hostname?.endsWith('.github.io'))

let snapshotPromise: Promise<StaticDemoSnapshot> | null = null
let cachedSnapshot: StaticDemoSnapshot | null = null

export class NonJsonApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function isStaticDemoActive(): boolean {
  return staticModeActive
}

export function shouldFallbackToStaticDemo(error: unknown, isJsonError = false): boolean {
  if (error instanceof TypeError) {
    staticModeActive = true
    return true
  }
  if (!isJsonError && error instanceof Error && 'status' in error && [404, 405, 502, 503, 504].includes(Number((error as { status?: number }).status))) {
    staticModeActive = true
    return true
  }
  return false
}

async function loadSnapshot(): Promise<StaticDemoSnapshot> {
  if (cachedSnapshot) return cachedSnapshot
  if (!snapshotPromise) {
    const base = import.meta.env?.BASE_URL || '/'
    const url = `${base.endsWith('/') ? base : `${base}/`}demo-snapshot.json`
    snapshotPromise = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Demo verisi yüklenemedi.')
        const data = (await res.json()) as StaticDemoSnapshot
        cachedSnapshot = data
        return data
      })
      .catch((err) => {
        snapshotPromise = null
        throw err
      })
  }
  return snapshotPromise
}

export function staticDemoPreviewUrl(artifactId: string): string | undefined {
  if (!staticModeActive || !cachedSnapshot) return undefined
  const text = cachedSnapshot.artifact_texts[artifactId]
  return typeof text === 'string' ? `data:text/plain;charset=utf-8,${encodeURIComponent(text)}` : undefined
}

function getSavedPersona(): 'kerem' | 'selin' | null {
  try {
    const value = globalThis.localStorage?.getItem(PERSONA_STORAGE_KEY)
    return value === 'kerem' || value === 'selin' ? value : null
  } catch {
    return null
  }
}

function setSavedPersona(persona: 'kerem' | 'selin' | null) {
  try {
    if (persona) globalThis.localStorage?.setItem(PERSONA_STORAGE_KEY, persona)
    else globalThis.localStorage?.removeItem(PERSONA_STORAGE_KEY)
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

function selectCannedRun(snapshot: StaticDemoSnapshot, payload: Record<string, unknown>, lang: 'en' | 'tr'): CannedRun {
  const c = snapshot.canned_runs
  const raw = String(payload.message ?? '').toLowerCase()
  const kind = String(payload.kind ?? 'ask')
  const localSources = Array.isArray(payload.local_sources) ? (payload.local_sources as Array<{ artifact_id: string; title: string; text: string }>) : []

  if (localSources.length > 0) {
    const matchedLocal = localSources.filter((s) =>
      raw.split(/\s+/).some((w) => w.length > 3 && (s.title.toLowerCase().includes(w) || s.text.toLowerCase().includes(w))),
    )
    const chosen = matchedLocal.length ? matchedLocal : localSources
    if (raw.includes('zeyilname') || raw.includes('kvkk') || chosen.some((s) => s.title.toLowerCase().includes('zeyilname') || s.text.toLowerCase().includes('kvkk'))) {
      const koruSources = c.koru_tender?.sources.slice(0, 2) ?? []
      const sources: AgentSourceRead[] = [
        ...chosen.map((s) => ({ artifact_id: s.artifact_id, title: s.title, quote: s.text.slice(0, 240) })),
        ...koruSources,
      ]
      return {
        kind,
        thread_title: 'Koru ihalesi · Zeyilname kontrolü',
        question: String(payload.message ?? ''),
        answer:
          'Eklenen zeyilname kaydına göre Koru ihalesi paketine **KVKK Veri İşleyen Taahhütnamesi** zorunluluğu eklenmiştir [1]. Mevcut teklif kontrol listesinde beş ana belge hazır görünse de bu yeni taahhütname pakette yer almamaktadır [2]. Son başvuru (12 Ekim 17:00) öncesinde Ece ve Derya’nın KVKK ekini imzaya sunması gerekir.',
        sources,
        follow_ups: ['KVKK Veri İşleyen Taahhütnamesi taslağını kim hazırlayacak?', 'Koru kontrol listesine yeni zeyilname maddesi eklendi mi?'],
      }
    }
  }

  if (kind === 'evening_review') return c.evening_review
  if (/fatura|ek iş|18 saat|36\.?000|sözleşme|ticari|ücret|invoice|contract|unbilled|delivery|extra hours|atlas/.test(raw)) {
    if (lang === 'en') {
      return {
        kind,
        thread_title: 'Atlas September unbilled hours',
        question: String(payload.message ?? ''),
        answer: [
          'Yes — **18 hours of out-of-scope work** delivered for Atlas Logistics in September were not reflected on the September invoice (`36,000 TL + VAT`).',
          '',
          '- **Delivery record:** Deniz and Kerem logged **18 hours** of bulk address correction, verification, and historical cleanup (22–25 Sep) confirmed by Atlas [1].',
          '- **Contract rate:** Out-of-scope work is billed at **2,000 TL / hour + VAT** (`18 × 2,000 TL = 36,000 TL + VAT`) outside the 24h maintenance retainer [2].',
          '- **September invoice:** Invoice `PUS-2026-0918` only billed the fixed monthly maintenance fee; the 18 extra hours were omitted [3].',
          '',
          '**Next step:** Ece should forward the delivery proof to commercial control and Selin should approve the **36,000 TL + VAT** invoice annex [1] [2] [3].',
        ].join('\n'),
        sources: [
          {
            artifact_id: 'art_aff9d5f4206b401cb244351a5f44d533',
            title: 'Atlas Delivery Log — September Extra Hours',
            quote: c.unbilled_work.sources[0]?.quote ?? '',
          },
          {
            artifact_id: 'art_b85426d8d97c42e0b3c5d463ddeddbca',
            title: 'Atlas Service Agreement',
            quote: c.unbilled_work.sources[4]?.quote ?? '',
          },
          {
            artifact_id: 'art_25fa2bd3b9f3488988a15b395fe79ce7',
            title: 'September Invoice — PUS-2026-0918',
            quote: snapshot.artifact_texts.art_25fa2bd3b9f3488988a15b395fe79ce7 ?? '',
          },
          {
            artifact_id: 'art_656b3bd78d35412eb8e70b4265d86dd9',
            title: 'Atlas Timeout Root Cause Note',
            quote: snapshot.artifact_texts.art_656b3bd78d35412eb8e70b4265d86dd9 ?? '',
          },
          ...c.unbilled_work.sources.slice(1, 4),
          ...c.unbilled_work.sources.slice(5),
        ],
        follow_ups: [
          'Draft the commercial reconciliation note for the 18 extra hours',
          'Are there any untracked feature requests from Atlas?',
        ],
      }
    }
    return c.unbilled_work
  }
  if (/koru|ihale|şartname|teklif|zeyilname|paket|tender|checklist/.test(raw)) return c.koru_tender
  if (/excel|talep|kayıtsız|unutulan|hallederiz|burcu|request/.test(raw)) return c.untracked_requests
  if (/staging|vpn|mert|operasyon|pool|zaman aşımı|timeout|atl-427|kök neden|destek|yenileme/.test(raw)) return c.daily_work_summary
  if (/günlük.*şirket|durum raporu|tüm kayıt/.test(raw)) return c.daily_company_summary
  if (/bugün.*iş|açık risk|öncelik|tara|ne yapmam/.test(raw)) return c.daily_work_summary
  if (/gizli|hassas|secret|confidential/.test(raw)) return c.confidential
  if (/rakip|avantaj|sektör|competitor/.test(raw)) return c.competitors
  if (/ne yapabilirsin|yardımcı|kimsin|merhaba|selam|nbr|nasılsın|how are you/.test(raw)) return c.capabilities
  return c.daily_company_summary
}

function buildRunRecord(snapshot: StaticDemoSnapshot, payload: Record<string, unknown>, runId = crypto.randomUUID()): AgentRunRead {
  const lang = payload.response_language === 'en' ? 'en' : getLanguage()
  const matched = selectCannedRun(snapshot, payload, lang)
  const date = new Date().toISOString()
  const topSourceTitles = matched.sources.slice(0, 3).map((s) => s.title).join(' · ')
  const stages: AgentRunRead['stages'] = [
    {
      sequence: 1,
      key: 'plan',
      label: lang === 'en' ? 'Planning how to answer your question' : 'Sorunuzu nasıl yanıtlayacağını planlıyor',
      status: 'completed',
      created_at: date,
      summary: lang === 'en' ? '10 company records and the current conversation were selected for review.' : '10 şirket kaydı ve mevcut konuşma inceleme için seçildi.',
    },
    {
      sequence: 2,
      key: 'retrieve',
      label: lang === 'en' ? 'Reviewing 10 company records' : '10 şirket kaydı inceleniyor',
      status: 'completed',
      created_at: date,
      summary: topSourceTitles || null,
    },
    {
      sequence: 3,
      key: 'cross_check',
      label: lang === 'en' ? 'Cross-checking related records and signals' : 'İlişkili kayıtlar ve sinyaller karşılaştırılıyor',
      status: 'completed',
      created_at: date,
      summary: lang === 'en' ? '3 linked records and 2 active signals were cross-checked.' : '3 bağlantılı kayıt ve 2 aktif sinyal karşılaştırıldı.',
    },
    {
      sequence: 4,
      key: 'verify',
      label: lang === 'en' ? `Checking ${matched.sources.length} sources` : `${matched.sources.length} kaynak doğrulanıyor`,
      status: 'completed',
      created_at: date,
      summary: topSourceTitles || null,
    },
    {
      sequence: 5,
      key: 'write',
      label: lang === 'en' ? 'Writing the answer' : 'Yanıt hazırlanıyor',
      status: 'completed',
      created_at: date,
      summary: lang === 'en' ? `Grounded response prepared with ${matched.sources.length} cited sources.` : `${matched.sources.length} kaynaklı kanıta dayalı yanıt hazırlandı.`,
    },
  ]
  return {
    run_id: runId,
    kind: (payload.kind === 'evening_review' ? 'evening_review' : 'ask') as AgentRunRead['kind'],
    thread_id: String(payload.thread_id ?? 'izge-colleague'),
    thread_title: matched.thread_title || String(payload.thread_title ?? 'İzge'),
    thread_kind: (payload.thread_kind ?? 'direct') as AgentRunRead['thread_kind'],
    participant_user_ids: [],
    status: 'completed',
    question: String(payload.message ?? ''),
    answer: matched.answer,
    error: null,
    sources: matched.sources,
    follow_ups: matched.follow_ups,
    stages,
    created_at: date,
    updated_at: date,
  }
}

export async function staticDemoStream(
  _path: string,
  options: RequestInit,
  onEvent: (event: DemoRunEvent) => void | Promise<void>,
): Promise<void> {
  const snapshot = await loadSnapshot()
  const payload = typeof options.body === 'string' ? (JSON.parse(options.body) as Record<string, unknown>) : {}
  const runId = crypto.randomUUID()
  const finished = buildRunRecord(snapshot, payload, runId)
  await onEvent({ type: 'accepted', data: { run_id: runId, status: 'running' } })
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  for (const stage of finished.stages) {
    await onEvent({ type: 'stage', data: { stage_key: stage.key, label: stage.label, summary: stage.summary ?? undefined, status: 'running', sequence: stage.sequence } })
    await delay(110)
    await onEvent({ type: 'stage', data: { stage_key: stage.key, label: stage.label, summary: stage.summary ?? undefined, status: 'completed', sequence: stage.sequence } })
  }
  for (const source of finished.sources) {
    await onEvent({ type: 'source', data: { source } })
  }
  const answer = finished.answer ?? ''
  const step = Math.max(18, Math.ceil(answer.length / 26))
  for (let index = 0; index < answer.length; index += step) {
    await onEvent({ type: 'delta', data: { text: answer.slice(index, index + step) } })
    await delay(20)
  }
  await onEvent({ type: 'result', data: { run: finished } })
}

export async function staticDemoRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const snapshot = await loadSnapshot()
  const url = new URL(path, 'http://demo.local')
  const route = url.pathname
  const method = options.method ?? 'GET'
  const payload = typeof options.body === 'string' ? (JSON.parse(options.body) as Record<string, unknown>) : {}

  if (route === '/auth/demo') return snapshot.demo_config
  if (route === '/auth/demo/sign-in' && method === 'POST') {
    const persona = payload.persona === 'selin' ? 'selin' : 'kerem'
    setSavedPersona(persona)
    return {
      access_token: `static-demo-${persona}`,
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      user: snapshot.personas[persona],
    }
  }
  if (route === '/auth/sign-out' && method === 'POST') {
    setSavedPersona(null)
    return { status: 'signed_out' }
  }
  if (route === '/auth/sign-in' && method === 'POST') {
    throw new NonJsonApiError(translate('Incorrect email or password.', 'E-posta veya parola hatalı.'), 401)
  }
  if (route === '/users/me') {
    const persona = getSavedPersona()
    if (!persona || !snapshot.personas[persona]) {
      throw new NonJsonApiError(translate('Session expired', 'Oturum süresi doldu'), 401)
    }
    return snapshot.personas[persona]
  }
  if (route === '/users/colleagues') return snapshot.colleagues
  if (route === '/work/models') return snapshot.models
  if (route === '/team-chat') {
    const persona = getSavedPersona() ?? 'selin'
    const thread = snapshot.team_chat[persona] ?? snapshot.team_chat.selin
    const threadId = url.searchParams.get('thread_id')
    const limit = Number(url.searchParams.get('limit') ?? 80)
    const messages = thread.messages.filter((m) => {
      if (!threadId) return true
      const meta = (m.message_metadata ?? {}) as Record<string, unknown>
      return String(meta.thread_id ?? 'company-general') === threadId
    })
    return { ...thread, messages: messages.slice(-limit) }
  }
  if (route === '/work/tasks') return snapshot.tasks
  if (route === '/artifacts') return snapshot.artifacts
  if (route.startsWith('/artifacts/')) {
    const parts = route.split('/')
    const artifactId = parts[2]
    if (route.endsWith('/signals')) return snapshot.artifact_signals[artifactId] ?? { artifact_id: artifactId, signals: [], contradictions: [], assumption_drift: [], next_actions: [] }
    if (snapshot.artifact_details[artifactId]) return snapshot.artifact_details[artifactId]
  }
  if (route === '/signals') return snapshot.signals
  if (route.startsWith('/signals/')) {
    const signalId = route.split('/')[2]
    if (snapshot.signal_details[signalId]) return snapshot.signal_details[signalId]
  }
  if (route === '/contradictions') return snapshot.contradictions
  if (route === '/assumptions/stale') return snapshot.assumptions_stale
  if (route === '/next-actions') return snapshot.next_actions
  if (route === '/graph/summary') return snapshot.graph_summary
  if (route === '/graph/timeline') return snapshot.graph_timeline
  if (route === '/graph/temporal') return snapshot.graph_temporal
  if (route.startsWith('/graph/neighborhood/')) {
    const key = route.slice('/graph/neighborhood/'.length)
    if (snapshot.neighborhoods[key]) return snapshot.neighborhoods[key]
  }
  if (route.startsWith('/memory/')) {
    const key = route.slice('/memory/'.length)
    if (snapshot.memory_details[key]) return snapshot.memory_details[key]
  }
  if (route === '/evidence-substrate/filesystem') return snapshot.filesystem
  if (route === '/evidence-substrate/orchestration') return snapshot.orchestration
  if (route === '/evidence-substrate/orchestration/runs') return snapshot.orchestration_runs
  if (route === '/evidence-substrate/orchestration/jobs') return snapshot.orchestration_jobs
  if (route === '/evidence-substrate/readiness') return snapshot.readiness
  if (route === '/scenario/templates') return snapshot.scenario_templates
  if (route === '/scenario/runs') return snapshot.scenario_runs
  if (route === '/demo/extract' && method === 'POST') {
    const form = options.body instanceof FormData ? options.body : null
    const file = form?.get('file')
    if (file instanceof File) {
      return { text: await file.text() }
    }
    return { text: '' }
  }
  if (route === '/demo/ask' && method === 'POST') {
    return { run: buildRunRecord(snapshot, payload) }
  }

  throw new NonJsonApiError(translate('Request failed', 'İstek başarısız'), 404)
}
