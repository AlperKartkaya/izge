import type { AgentRunRead, ArtifactDetail, AssistantConversationRead, AutomationRead, NotificationRead, TeamChatMessageRead, UserRead, WorkTaskRead } from './types.ts'

export type DemoTransport = (path: string, options?: RequestInit) => Promise<unknown>
export type DemoRunEvent = { type: string; data: Record<string, unknown> }
export type DemoStreamTransport = (path: string, options: RequestInit, onEvent: (event: DemoRunEvent) => void | Promise<void>) => Promise<void>
type LocalSource = ArtifactDetail & { text: string }
interface DemoState {
  version: 1
  messages: TeamChatMessageRead[]
  tasks: WorkTaskRead[]
  automations: AutomationRead[]
  notifications: NotificationRead[]
  conversations: AssistantConversationRead[]
  runs: AgentRunRead[]
  sources: LocalSource[]
}
const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const threadOf = (message: TeamChatMessageRead) => String(message.message_metadata.thread_id ?? 'company-general')

/** Demo writes never fall through to the shared API. Only AI computation leaves the browser. */
export class BrowserDemo {
  private state?: DemoState
  private initializing?: Promise<DemoState>
  private lastSaved: string | null = null
  readonly key: string
  readonly user: UserRead
  private storage: Storage
  private remote: DemoTransport
  private stream?: DemoStreamTransport
  private runListeners = new Map<string, Set<(event: DemoRunEvent) => void>>()
  private mutations: Promise<unknown> = Promise.resolve()
  constructor(user: UserRead, storage: Storage, remote: DemoTransport, stream?: DemoStreamTransport) {
    this.user = user
    this.storage = storage
    this.remote = remote
    this.stream = stream
    this.key = `izge-demo-v1:${user.workspace_id}:${user.user_id}`
  }

  private save(state: DemoState) {
    const serialized = JSON.stringify(state)
    try { this.storage.setItem(this.key, serialized) }
    catch { throw new Error('Demo değişiklikleri tarayıcıya kaydedilemedi. Depolama alanını kontrol edin; değişiklik sunucuya gönderilmedi.') }
    this.lastSaved = serialized
    this.state = state
  }

  reset() { this.storage.removeItem(this.key); this.state = undefined; this.initializing = undefined }

  subscribeRun(runId: string, listener: (event: DemoRunEvent) => void) {
    const listeners = this.runListeners.get(runId) ?? new Set()
    listeners.add(listener)
    this.runListeners.set(runId, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.runListeners.delete(runId)
    }
  }

  private emitRun(runId: string, event: DemoRunEvent) {
    for (const listener of this.runListeners.get(runId) ?? []) listener(event)
  }

  private async load(): Promise<DemoState> {
    if (this.state && this.storage.getItem(this.key) === this.lastSaved) return this.state
    if (this.initializing) return this.initializing
    this.initializing = this.initialize().finally(() => { this.initializing = undefined })
    return this.initializing
  }

  private async initialize(): Promise<DemoState> {
    const saved = this.storage.getItem(this.key)
    if (saved) {
      let parsed: DemoState
      try { parsed = JSON.parse(saved) as DemoState } catch { throw new Error('Tarayıcıdaki demo kaydı okunamadı. Demoyu sıfırlayın.') }
      if (parsed.version !== 1 || !['messages', 'tasks', 'automations', 'notifications', 'conversations', 'runs', 'sources'].every((key) => Array.isArray(parsed[key as keyof DemoState]))) throw new Error('Demo kaydı uyumsuz. Demoyu sıfırlayın.')
      this.lastSaved = saved
      this.state = parsed
      // Refresh only the new shared announcement; visitor messages remain local.
      try {
        const chat = await this.remote('/team-chat?limit=240&thread_id=company-general') as { messages: TeamChatMessageRead[] }
        for (const message of chat.messages) if (message.message_metadata?.seed_key === 'productivity-seminar-20261016' && !parsed.messages.some((item) => item.message_metadata?.seed_key === message.message_metadata.seed_key)) parsed.messages.push(message)
        this.save(parsed)
      } catch { /* Saved demo history remains available when the seed cannot refresh. */ }
      return parsed
    }
    const [chat, tasks, artifacts] = await Promise.all([
      this.remote('/team-chat?limit=240') as Promise<{ messages: TeamChatMessageRead[] }>,
      this.remote('/work/tasks') as Promise<{ items: WorkTaskRead[] }>,
      this.remote('/artifacts') as Promise<ArtifactDetail[]>,
    ])
    const date = now()
    const state: DemoState = { version: 1, messages: chat.messages, tasks: tasks.items, automations: [], notifications: [], conversations: [{ conversation_id: 'demo-personal', thread_id: 'izge-colleague', title: 'İzge', archived_at: null, created_at: date, updated_at: date }], runs: [], sources: [] }
    seedDemoExamples(state, this.user, artifacts)
    this.save(state)
    return state
  }

  previewUrl(artifactId: string): string | undefined {
    const source = this.state?.sources.find((item) => item.artifact_id === artifactId)
    return source ? `data:text/plain;charset=utf-8,${encodeURIComponent(source.text)}` : undefined
  }

  private message(body: string, metadata: Record<string, unknown>, replyId?: string): TeamChatMessageRead {
    const target = replyId ? this.state?.messages.find((message) => message.message_id === replyId && threadOf(message) === String(metadata.thread_id ?? 'company-general')) : undefined
    if (replyId && !target) throw new Error('Yanıtlanan mesaj bu konuşmada bulunamadı.')
    const reply = target ? { message_id: target.message_id, author_display_name: target.author_display_name, body: target.body } : null
    return { message_id: id(), workspace_id: this.user.workspace_id, author_user_id: this.user.user_id, author_display_name: this.user.display_name, author_role: this.user.role, is_authored_by_current_user: true, body, reply_to: reply, message_metadata: { ...metadata, ...(reply ? { reply_to_message_id: reply.message_id } : {}) }, created_at: now() }
  }

  private askPayload(state: DemoState, payload: Record<string, unknown>) {
    const thread = String(payload.thread_id ?? 'izge-colleague')
    const history = state.runs.filter((run) => run.thread_id === thread && run.status === 'completed' && run.answer).slice(-3).map((run) => ({ question: run.question.slice(0, 8000), answer: run.answer!.slice(0, 8000) }))
    const target = payload.reply_to_message_id ? state.messages.find((message) => message.message_id === payload.reply_to_message_id && threadOf(message) === thread) : null
    const conversationContext = [target ? `Yanıtlanan mesaj — ${target.author_display_name}: ${target.body}` : '', ...state.messages.filter((message) => threadOf(message) === thread).slice(-8).map((message) => `${message.author_display_name}: ${message.body}`)].join('\n').slice(0, 8000)
    return { thread, body: { ...payload, client_request_id: payload.client_request_id ?? id(), reply_to_message_id: null, history, conversation_context: conversationContext, local_tasks: state.tasks.map((task) => ({ task_id: task.task_id, title: task.title, description: task.description, status: task.status, assignee_user_id: task.assignee_user_id, due_at: task.due_at ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(task.due_at) ? task.due_at : `${task.due_at}Z`).toISOString() : null, remind_at: task.remind_at ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(task.remind_at) ? task.remind_at : `${task.remind_at}Z`).toISOString() : null, source_artifact_ids: task.source_artifact_ids })), local_sources: state.sources.map((source) => ({ artifact_id: source.artifact_id, title: source.title, text: source.text })) } }
  }

  private storeAcceptedRun(state: DemoState, payload: Record<string, unknown>, thread: string, run: AgentRunRead) {
    const metadata = { thread_id: thread, thread_title: run.thread_title, thread_kind: run.thread_kind, participant_user_ids: [this.user.user_id], colleague_run_id: run.run_id }
    const question = this.message(String(payload.message), metadata, payload.reply_to_message_id as string | undefined)
    state.messages.push(question)
    state.runs.push(run)
    const conversation = state.conversations.find((item) => item.thread_id === thread)
    if (conversation) conversation.updated_at = now()
    this.save(state)
  }

  private async ask(state: DemoState, payload: Record<string, unknown>) {
    const { thread, body } = this.askPayload(state, payload)
    if (!this.stream) {
      const result = await this.remote('/demo/ask', { method: 'POST', body: JSON.stringify(body) }) as { run: AgentRunRead }
      const run = { ...result.run, thread_id: thread, thread_title: String(payload.thread_title ?? 'İzge'), thread_kind: (payload.thread_kind ?? 'direct') as AgentRunRead['thread_kind'], participant_user_ids: [this.user.user_id] }
      this.storeAcceptedRun(state, payload, thread, run)
      await this.finishRun(run.run_id, run)
      return { run_id: run.run_id, thread_id: thread, status: run.status }
    }

    let acceptedResolve!: (value: { run_id: string; thread_id: string; status: AgentRunRead['status'] }) => void
    let acceptedReject!: (reason: unknown) => void
    const accepted = new Promise<{ run_id: string; thread_id: string; status: AgentRunRead['status'] }>((resolve, reject) => { acceptedResolve = resolve; acceptedReject = reject })
    let runId: string | null = null
    let acceptedSaved = false
    // shortcut: Full reload/tab closure interrupts demo work; persist jobs if cross-reload resume is required.
    void this.stream('/demo/ask/events', { method: 'POST', body: JSON.stringify(body) }, async (event) => {
      if (event.type === 'accepted') {
        runId = String(event.data.run_id)
        const date = now()
        const run: AgentRunRead = { run_id: runId, kind: 'ask', thread_id: thread, thread_title: String(payload.thread_title ?? 'İzge'), thread_kind: (payload.thread_kind ?? 'direct') as AgentRunRead['thread_kind'], participant_user_ids: [this.user.user_id], status: (event.data.status ?? 'running') as AgentRunRead['status'], question: String(payload.message), answer: null, error: null, sources: [], follow_ups: [], stages: [], created_at: date, updated_at: date }
        this.storeAcceptedRun(state, payload, thread, run)
        acceptedSaved = true
        acceptedResolve({ run_id: runId, thread_id: thread, status: run.status })
        return
      }
      if (!runId) return
      await this.applyRunEvent(runId, thread, event)
    }).catch(async (error) => {
      if (!acceptedSaved) acceptedReject(error)
      else if (runId) await this.applyRunEvent(runId, thread, { type: 'failed', data: { text: error instanceof Error ? error.message : 'İzge bu çalışmayı tamamlayamadı.' } })
    })
    return accepted
  }

  private async applyRunEvent(runId: string, thread: string, event: DemoRunEvent) {
    const apply = async () => {
      const current = await this.load()
      const draft = structuredClone(current)
      const run = draft.runs.find((item) => item.run_id === runId)
      if (!run) return
      if (event.type === 'delta' && typeof event.data.text === 'string') run.answer = `${run.answer ?? ''}${event.data.text}`
      if (event.type === 'reset') { run.answer = null; run.stages = [] }
      if (event.type === 'source' && event.data.source) run.sources.push(event.data.source as AgentRunRead['sources'][number])
      if (event.type === 'stage') {
        const key = String(event.data.stage_key ?? 'work')
        const stage = { sequence: Number(event.data.sequence ?? 0), key, label: String(event.data.label ?? 'İşleniyor'), status: String(event.data.status ?? 'running') as AgentRunRead['stages'][number]['status'], created_at: now(), summary: typeof event.data.summary === 'string' ? event.data.summary : null }
        run.stages = [...run.stages.filter((item) => item.key !== key), stage]
      }
      if (event.type === 'failed') { run.status = 'failed'; run.error = String(event.data.text ?? 'İzge bu çalışmayı tamamlayamadı.') }
      for (const item of draft.automations) if (item.last_run_id === runId) item.last_run_status = run.status
      if (event.type === 'result' && event.data.run) await this.finishRun(runId, { ...(event.data.run as AgentRunRead), thread_id: thread }, draft)
      else { run.updated_at = now(); this.save(draft) }
      this.emitRun(runId, event)
    }
    const work = this.mutations.then(() => globalThis.navigator?.locks
      ? navigator.locks.request(this.key, apply)
      : apply())
    this.mutations = work.catch(() => undefined)
    await work
  }

  private async finishRun(runId: string, finished: AgentRunRead, state?: DemoState) {
    const draft = state ?? structuredClone(await this.load())
    const index = draft.runs.findIndex((item) => item.run_id === runId)
    if (index < 0) return
    const run = { ...finished, thread_id: draft.runs[index].thread_id, thread_title: draft.runs[index].thread_title, thread_kind: draft.runs[index].thread_kind, participant_user_ids: [this.user.user_id] }
    const conversation = draft.conversations.find((item) => item.thread_id === run.thread_id)
    if (conversation && ['İzge', 'İzge ile çalışma'].includes(conversation.title) && draft.runs.filter((item) => item.thread_id === run.thread_id).length === 1 && finished.thread_title && !finished.thread_title.startsWith('demo:')) {
      conversation.title = finished.thread_title
      conversation.updated_at = now()
      run.thread_title = finished.thread_title
    }
    draft.runs[index] = run
    const metadata = { thread_id: run.thread_id, thread_title: run.thread_title, thread_kind: run.thread_kind, participant_user_ids: [this.user.user_id], colleague_run_id: run.run_id }
    const question = draft.messages.find((message) => message.message_metadata.colleague_run_id === runId)
    if (run.answer && question && !draft.messages.some((message) => message.message_metadata.colleague_run_id === runId && !message.is_authored_by_current_user)) draft.messages.push({ ...question, message_id: id(), author_user_id: 'demo-izge', author_display_name: 'İzge', is_authored_by_current_user: false, body: run.answer, reply_to: null, message_metadata: { ...metadata, agent: true, source_refs: run.sources, follow_ups: run.follow_ups } })
    draft.notifications.unshift({ notification_id: id(), kind: 'agent', title: run.status === 'failed' ? 'İzge çalışması tamamlanamadı' : 'İzge yanıtı hazır', body: run.answer ?? run.error ?? '', thread_id: run.thread_id, run_id: run.run_id, message_id: null, read_at: null, created_at: now() })
    for (const item of draft.automations) if (item.last_run_id === runId) item.last_run_status = run.status
    this.save(draft)
  }

  request(path: string, options: RequestInit = {}): Promise<unknown> {
    if (!options.method || options.method === 'GET') return this.handle(path, options)
    const work = this.mutations.then(() => globalThis.navigator?.locks
      ? navigator.locks.request(this.key, () => this.handle(path, options))
      : this.handle(path, options))
    this.mutations = work.catch(() => undefined)
    return work
  }

  private async handle(path: string, options: RequestInit): Promise<unknown> {
    const url = new URL(path, 'http://demo.local')
    const route = url.pathname
    const method = options.method ?? 'GET'
    // Auth/model/read-only evidence requests retain their existing server-side permission checks.
    if (route.startsWith('/auth/') || route === '/users/me' || route === '/work/models') return this.remote(path, options)
    const localRoute = /^\/(team-chat|work\/(tasks|conversations|runs|ask|review)|automations|notifications|artifacts|ingestion)(\/|$)/.test(route)
    if (!localRoute) {
      if (method !== 'GET') throw new Error('Bu işlem demo çalışma alanında desteklenmiyor; ortak veriler değiştirilmedi.')
      return this.remote(path, options)
    }
    const state = await this.load()
    // Serialize only at the commit boundary; an unsuccessful request must not alter the saved state.
    const draft = structuredClone(state)
    const payload = typeof options.body === 'string' ? JSON.parse(options.body) as Record<string, unknown> : {}
    const commit = (value: unknown) => { this.save(draft); return value }
    const requireItem = <T,>(item: T | undefined): T => { if (!item) throw new Error('Demo kaydı bulunamadı.'); return item }

    if (route === '/team-chat/typing') return { workspace_id: this.user.workspace_id, generated_at: now(), typing: [] }
    if (route === '/team-chat' && method === 'GET') return { workspace_id: this.user.workspace_id, generated_at: now(), messages: draft.messages.filter((message) => !url.searchParams.get('thread_id') || threadOf(message) === url.searchParams.get('thread_id')).slice(-Number(url.searchParams.get('limit') ?? 80)) }
    if (route === '/team-chat' && method === 'POST') {
      if (!String(payload.body ?? '').trim()) throw new Error('Mesaj boş olamaz.')
      const message = this.message(String(payload.body), { ...payload.message_metadata as object, thread_id: payload.thread_id ?? 'company-general', thread_title: payload.thread_title ?? 'Şirket geneli', thread_kind: payload.thread_kind ?? 'channel' }, payload.reply_to_message_id as string | undefined)
      draft.messages.push(message); return commit(message)
    }
    if (route === '/work/ask' && method === 'POST') return this.ask(draft, payload)
    if (route === '/work/review' && method === 'POST') return this.ask(draft, { ...payload, message: 'Atlas için açık işleri, değişen kararları ve sıradaki adımı kaynaklarıyla özetle.', thread_id: 'izge-colleague' })
    if (route === '/work/runs' && method === 'GET') return { items: draft.runs.filter((run) => !url.searchParams.get('thread_id') || run.thread_id === url.searchParams.get('thread_id')).toReversed() }
    if (route.startsWith('/work/runs/') && method === 'GET') return requireItem(draft.runs.find((run) => run.run_id === route.split('/')[3]))
    if (route === '/work/conversations') {
      if (method === 'GET') return { items: draft.conversations.filter((item) => url.searchParams.get('include_archived') === 'true' || !item.archived_at) }
      if (method === 'POST') {
        const empty = draft.conversations.find((item) => !item.archived_at && !draft.messages.some((message) => threadOf(message) === item.thread_id))
        if (empty) return empty
        const conversation = { conversation_id: id(), thread_id: `demo-${id()}`, title: String(payload.title ?? 'İzge'), archived_at: null, created_at: now(), updated_at: now() }
        draft.conversations.push(conversation); return commit(conversation)
      }
    }
    if (/^\/work\/conversations\/[^/]+$/.test(route)) {
      const item = requireItem(draft.conversations.find((conversation) => conversation.conversation_id === route.split('/')[3]))
      if (method === 'GET') return item
      if (method === 'PATCH') { if (typeof payload.title === 'string') item.title = payload.title; if ('archived' in payload) item.archived_at = payload.archived ? now() : null; item.updated_at = now(); return commit(item) }
      if (method === 'DELETE') { draft.conversations = draft.conversations.filter((value) => value !== item); draft.messages = draft.messages.filter((message) => threadOf(message) !== item.thread_id); draft.runs = draft.runs.filter((run) => run.thread_id !== item.thread_id); return commit(null) }
    }
    if (route === '/work/tasks' && method === 'GET') return { items: draft.tasks }
    if (route === '/work/tasks' && method === 'POST') {
      if (!String(payload.title ?? '').trim()) throw new Error('İş başlığı boş olamaz.')
      const task: WorkTaskRead = { task_id: id(), workspace_id: this.user.workspace_id, created_by: this.user.user_id, assignee_user_id: this.user.user_id, assignee_display_name: this.user.display_name, title: String(payload.title), description: null, status: 'open', due_at: null, remind_at: null, reminder_sent_at: null, source_artifact_ids: [], ...payload, created_at: now(), updated_at: now() }
      draft.tasks.push(task); return commit(task)
    }
    if (route.startsWith('/work/tasks/') && method === 'PATCH') { const task = requireItem(draft.tasks.find((item) => item.task_id === route.split('/')[3])); Object.assign(task, payload, { updated_at: now() }); return commit(task) }
    if (route === '/automations' && method === 'GET') return { items: draft.automations }
    if (route === '/automations' && method === 'POST') {
      if (!String(payload.title ?? '').trim() || !String(payload.prompt ?? '').trim()) throw new Error('Otomasyon başlığı ve istemi boş olamaz.')
      const automation = { automation_id: id(), title: '', prompt: '', schedule_time: '09:00', frequency: 'daily', starts_at: now(), timezone: 'Europe/Istanbul', enabled: true, response_language: 'tr', last_run_at: null, last_run_id: null, last_run_status: null, next_run_at: null, ...payload, created_at: now(), updated_at: now() } as AutomationRead
      draft.automations.push(automation); return commit(automation)
    }
    if (route.startsWith('/automations/')) {
      const item = requireItem(draft.automations.find((value) => value.automation_id === route.split('/')[2]))
      if (route.endsWith('/run') && method === 'POST') { const result = await this.ask(draft, { message: item.prompt, thread_id: `automation:${item.automation_id}`, thread_title: item.title, thread_kind: 'direct', response_language: item.response_language }); item.last_run_at = now(); item.last_run_id = result.run_id; item.last_run_status = result.status; return commit(result) }
      if (method === 'PATCH') { Object.assign(item, payload, { updated_at: now(), next_run_at: null }); return commit(item) }
      if (method === 'DELETE') { draft.automations = draft.automations.filter((value) => value !== item); return commit(null) }
    }
    if (route === '/notifications' && method === 'GET') return { items: draft.notifications.filter((item) => url.searchParams.get('unread_only') !== 'true' || !item.read_at), unread_count: draft.notifications.filter((item) => !item.read_at).length }
    if (route.startsWith('/notifications/')) {
      const item = requireItem(draft.notifications.find((value) => value.notification_id === route.split('/')[2]))
      if (method === 'GET') return item
      if (method === 'PATCH') { item.read_at = route.endsWith('/unread') ? null : now(); return commit(item) }
      if (method === 'DELETE') { draft.notifications = draft.notifications.filter((value) => value !== item); return commit(null) }
    }
    if (route === '/artifacts' && method === 'GET') return [...await this.remote(path) as ArtifactDetail[], ...draft.sources]
    if (route === '/artifacts/upload' || route === '/artifacts/pasted-text' || route.endsWith('/attachments')) {
      let text = String(payload.text ?? '')
      const form = options.body instanceof FormData ? options.body : null
      const file = form?.get('file')
      if (file instanceof File) {
        if (file.size > 2 * 1024 * 1024) throw new Error('Tarayıcı demosunda dosya sınırı 2 MB.')
        const extracted = await this.remote('/demo/extract', { method: 'POST', body: form! }) as { text: string }; text = extracted.text
      }
      if (!text.trim() || text.length > 50_000) throw new Error('Demo kaynağı boş olamaz ve 50.000 karakteri geçemez.')
      const source: LocalSource = { artifact_id: id(), workspace_id: this.user.workspace_id, title: String(payload.title ?? form?.get('title') ?? (file instanceof File ? file.name : 'Not')), text, extracted_text_preview: text, chunk_count: 1, chunk_provenance: [], permitted_user_ids: [this.user.user_id], source_type: 'pasted_text', mime_type: 'text/plain', uploaded_by: this.user.user_id, visibility_scope: 'restricted', original_filename: file instanceof File ? file.name : null, checksum_sha256: null, ingestion_status: 'completed', review_status: 'pending', reviewed_by: null, reviewed_at: null, review_notes: null, created_at: now(), updated_at: now() }
      if (draft.sources.length >= 4 || draft.sources.reduce((total, item) => total + item.text.length, 0) + text.length > 100_000) throw new Error('Demo en fazla 4 yerel kaynak ve toplam 100.000 karakter saklar. Yeni bir deneme için demoyu sıfırlayın.')
      draft.sources.push(source)
      if (route.endsWith('/attachments')) {
        const conversation = draft.conversations.find((item) => item.conversation_id === route.split('/')[3])
        const message = this.message(source.title, { thread_id: conversation?.thread_id ?? form?.get('thread_id'), thread_title: conversation?.title ?? form?.get('thread_title'), thread_kind: form?.get('thread_kind') ?? 'direct', participant_user_ids: [this.user.user_id], attachments: [{ artifact_id: source.artifact_id, title: source.title, filename: source.original_filename, mime_type: source.mime_type }] })
        draft.messages.push(message); return commit(message)
      }
      return commit(source)
    }
    if (route === '/ingestion/run') return { job_id: `demo-${payload.artifact_id}`, artifact_id: payload.artifact_id, status: 'completed', stage: 'completed', detail: 'Kaynak tarayıcıda hazır.', created_at: now(), updated_at: now() }
    if (route.startsWith('/artifacts/')) {
      const source = draft.sources.find((item) => item.artifact_id === route.split('/')[2])
      if (source && method === 'GET') return route.endsWith('/signals') ? { artifact_id: source.artifact_id, signals: [], contradictions: [], assumption_drift: [], next_actions: [] } : source
      if (source && method === 'PATCH') { Object.assign(source, payload, { updated_at: now() }); return commit(source) }
    }
    if (method === 'GET') return this.remote(path, options)
    throw new Error('Bu işlem demo çalışma alanında desteklenmiyor; ortak veriler değiştirilmedi.')
  }
}

function seedDemoExamples(state: DemoState, user: UserRead, artifacts: ArtifactDetail[]) {
  // Illustrative history is grounded in the shipped Atlas sources, not a fabricated live run.
  const cases = [
    { thread: 'atlas-commercial', title: 'Atlas · Ticari takip', question: '@izge Teslim edilen ek iş faturaya yansımış mı?', answer: 'Teslim kayıtlarında 18 saat ek iş var; Eylül faturasında yalnızca 85.000 TL aylık bakım yer alıyor. Sözleşmedeki 2.000 TL/saat üzerinden 36.000 TL + KDV kontrol edilmeli. Bu bir tahsilat kaydı değil; Ece teslim kanıtıyla fatura düzeltmesini teyit etmeli.', sources: ['Sözleşmesi', 'Faturası', 'Teslimi'], automation: 'Atlas ek iş ve fatura kontrolü', prompt: 'Atlas teslim kayıtlarını, kapsam dışı saat ücretini ve Eylül faturasını karşılaştır. Yalnızca kanıtlanan farkı ve teyit edilmesi gereken adımı belirt.' },
    { thread: 'atlas-support', title: 'Atlas · Destek ve yenileme riski', question: '@izge Servisi yeniden başlatmak kalıcı çözüm mü, sıradaki adım ne?', answer: 'Hayır. Temmuz–Eylül kayıtlarında aynı pool exhausted dizisi tekrarlanıyor. Bağlantı havuzu hipotezi henüz kesin kök neden değil. Kalıcı çözümü doğrulamak için yük testi ve havuz metrikleri gerekiyor; staging VPN onayı bekleniyor. Kerem ile Operasyon erişimi netleştirmeli.', sources: ['Kök Neden', 'Staging'], automation: 'Atlas kalıcı çözüm takibi', prompt: 'Atlas zaman aşımı incelemesini ve staging teslim notunu kontrol et. Doğrulanmış bulguyu hipotezden ayır; kalıcı çözümü bekleten işi ve sorumlusunu belirt.' },
  ]
  for (const [index, example] of cases.entries()) {
    const existing = state.messages.find((message) => String(message.message_metadata.thread_title) === example.title)
    const thread = existing ? threadOf(existing) : example.thread
    const date = `2026-10-08T${index ? '11' : '10'}:00:00+03:00`
    const sources = artifacts.filter((source) => example.sources.some((word) => source.title.includes(word))).map((source) => ({ artifact_id: source.artifact_id, title: source.title, quote: '' }))
    const metadata = { thread_id: thread, thread_title: example.title, thread_kind: 'group', participant_user_ids: [user.user_id], demo_example: true }
    const question: TeamChatMessageRead = { message_id: `demo-example-question-${index}`, workspace_id: user.workspace_id, author_user_id: user.user_id, author_display_name: user.display_name, author_role: user.role, is_authored_by_current_user: true, body: example.question, reply_to: null, message_metadata: metadata, created_at: date }
    const answer: TeamChatMessageRead = { ...question, message_id: `demo-example-answer-${index}`, author_user_id: 'demo-izge', author_display_name: 'İzge', is_authored_by_current_user: false, body: example.answer, message_metadata: { ...metadata, agent: true, source_refs: sources, follow_ups: [] } }
    state.messages.push(question, answer)
    state.automations.push({ automation_id: `demo-automation-${index}`, title: example.automation, prompt: example.prompt, schedule_time: index ? '16:30' : '09:00', frequency: 'daily', starts_at: null, timezone: 'Europe/Istanbul', enabled: true, response_language: 'tr', last_run_at: null, last_run_id: null, last_run_status: null, next_run_at: null, created_at: date, updated_at: date })
    state.notifications.push({ notification_id: `demo-notification-${index}`, kind: 'agent', title: example.automation, body: example.answer, thread_id: thread, run_id: null, message_id: answer.message_id, read_at: index ? date : null, created_at: date })
  }
  state.messages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
}
