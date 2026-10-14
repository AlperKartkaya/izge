import { getLanguage, translate } from './language'
import { BrowserDemo } from './browserDemo'
import { consumeSse } from './sse'
import type {
  ArtifactDetail,
  ArtifactProactiveSignals,
  ArtifactRead,
  AssumptionDriftItem,
  AuditEventRead,
  ContradictionItem,
  DatabaseOverviewRead,
  DemoConfigRead,
  DemoPersonaId,
  GraphNeighborhood,
  GraphSummary,
  GraphTimeline,
  IngestionJobRead,
  LocalLLMSmokeRead,
  LocalLLMStatusRead,
  MemoryDetail,
  ScenarioImpactRead,
  ScenarioReplayRead,
  ScenarioRunListRead,
  ScenarioRunRead,
  ScenarioTemplateCatalogItem,
  TemporalGraphRead,
  OrchestrationBlueprintRead,
  OrchestrationJobListRead,
  OperationsOverviewRead,
  OrchestrationStageRunsRead,
  MemoryFilesystemRead,
  NextActionSignalItem,
  QueryResult,
  QueryTraceRead,
  SignalDetail,
  SignalRead,
  TeamChatMessageRead,
  TeamChatThreadRead,
  TeamChatTypingRead,
  TargetReadinessRead,
  TokenResponse,
  UserRead,
  UserRole,
  WorkTaskRead,
  WorkTaskStatus,
  AgentRunCreated,
  AgentRunRead,
  AutomationRead,
  NotificationRead,
  AgentModelCatalogRead,
  AgentRequestOptions,
  AssistantConversationRead,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || '/api'
export const COOKIE_SESSION_TOKEN = '__izge_cookie_session__'

type VisibilityScope = 'workspace' | 'restricted'

interface RequestOptions extends RequestInit {
  token?: string
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let browserDemo: BrowserDemo | null = null

function configureDemo(user: UserRead, token?: string) {
  browserDemo = user.is_public_demo ? new BrowserDemo(user, localStorage,
    (path, options = {}) => remoteRequest(path, { ...options, token }),
    async (path, options, onEvent) => consumeSse(await remoteResponse(path, { ...options, token }), onEvent),
  ) : null
}

export function resetBrowserDemo() { browserDemo?.reset() }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!browserDemo) return remoteRequest<T>(path, options)
  try { return await browserDemo.request(path, options) as T }
  catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(error instanceof Error ? error.message : translate('Demo operation failed.', 'Demo işlemi başarısız.'), 400)
  }
}

async function remoteRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await remoteResponse(path, options)
  return (response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text()) as T
}

async function remoteResponse(path: string, options: RequestOptions = {}): Promise<Response> {
  const { token, headers, body, ...init } = options
  const requestHeaders = new Headers(headers)
  requestHeaders.set('Accept-Language', getLanguage())

  if (!(body instanceof FormData) && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  if (token && token !== COOKIE_SESSION_TOKEN) {
    requestHeaders.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: requestHeaders,
    body,
  })

  if (!response.ok) {
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text()
    const detail =
      typeof payload === 'string'
        ? payload
        : typeof payload?.detail === 'string'
          ? payload.detail
          : translate('Request failed', 'İstek başarısız')
    throw new ApiError(detail, response.status)
  }

  return response
}

export const api = {
  getDemoConfig() {
    return request<DemoConfigRead>('/auth/demo')
  },

  demoSignIn(persona: DemoPersonaId) {
    return request<TokenResponse>('/auth/demo/sign-in', {
      method: 'POST',
      body: JSON.stringify({ persona }),
    }).then((result) => { configureDemo(result.user, result.access_token); return result })
  },

  signIn(email: string, password: string) {
    return request<TokenResponse>('/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }).then((result) => { configureDemo(result.user, result.access_token); return result })
  },

  getCurrentUser(token?: string) {
    return remoteRequest<UserRead>('/users/me', { token }).then((user) => { configureDemo(user, token); return user })
  },

  signOut(token?: string) {
    browserDemo = null
    return request<{ status: string }>('/auth/sign-out', {
      method: 'POST',
      token,
    })
  },

  listUsers(token: string) {
    return request<UserRead[]>('/users', { token })
  },

  listColleagues(token: string) {
    return request<UserRead[]>('/users/colleagues', { token })
  },

  createUser(token: string, payload: { display_name: string; email: string; role: UserRole; password: string; is_active: boolean }) {
    return request<UserRead>('/users', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    })
  },

  updateUser(token: string, userId: string, payload: Partial<{ display_name: string; role: UserRole; password: string; is_active: boolean }>) {
    return request<UserRead>(`/users/${userId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    })
  },

  listArtifacts(token: string) {
    return request<ArtifactRead[]>('/artifacts', { token })
  },

  getArtifact(token: string, artifactId: string) {
    return request<ArtifactDetail>(`/artifacts/${artifactId}`, { token })
  },

  artifactPreviewUrl(artifactId: string, asText = false) {
    return browserDemo?.previewUrl(artifactId) ?? `${API_BASE}/artifacts/${encodeURIComponent(artifactId)}/preview${asText ? "?as_text=true" : ""}`
  },

  artifactDownloadUrl(artifactId: string) {
    return browserDemo?.previewUrl(artifactId) ?? `${API_BASE}/artifacts/${encodeURIComponent(artifactId)}/download`
  },

  getArtifactSignals(token: string, artifactId: string) {
    return request<ArtifactProactiveSignals>(`/artifacts/${artifactId}/signals`, { token })
  },

  uploadArtifact(
    token: string,
    payload: {
      file: File
      title: string
      visibility_scope: VisibilityScope
      permitted_user_ids: string[]
    },
  ) {
    const formData = new FormData()
    formData.set('file', payload.file)
    formData.set('title', payload.title)
    formData.set('visibility_scope', payload.visibility_scope)
    formData.set('permitted_user_ids', payload.permitted_user_ids.join(','))

    return request<ArtifactRead>('/artifacts/upload', {
      method: 'POST',
      token,
      body: formData,
    })
  },

  createPastedText(
    token: string,
    payload: {
      title: string
      text: string
      visibility_scope: VisibilityScope
      permitted_user_ids: string[]
    },
  ) {
    return request<ArtifactRead>('/artifacts/pasted-text', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    })
  },

  updateArtifactPermissions(token: string, artifactId: string, payload: { visibility_scope: VisibilityScope; permitted_user_ids: string[] }) {
    return request<ArtifactDetail>(`/artifacts/${artifactId}/permissions`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    })
  },

  updateArtifactReview(token: string, artifactId: string, payload: { review_status: string; review_notes: string | null }) {
    return request<ArtifactDetail>(`/artifacts/${artifactId}/review`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    })
  },

  updateArtifactMetadata(token: string, artifactId: string, payload: { title: string }) {
    return request<ArtifactDetail>(`/artifacts/${artifactId}/metadata`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    })
  },

  runIngestion(token: string, artifactId: string) {
    return request<IngestionJobRead>('/ingestion/run', {
      method: 'POST',
      token,
      body: JSON.stringify({ artifact_id: artifactId }),
    })
  },

  getIngestionJob(token: string, jobId: string) {
    return request<IngestionJobRead>(`/ingestion/jobs/${jobId}`, { token })
  },

  submitQuery(token: string, queryText: string, conversationContext?: string) {
    return request<QueryResult>('/query', {
      method: 'POST',
      token,
      body: JSON.stringify({ query_text: queryText, conversation_context: conversationContext || null }),
    })
  },

  getQueryResult(token: string, queryRunId: string) {
    return request<QueryResult>(`/query/${queryRunId}`, { token })
  },

  getQueryTrace(token: string, queryRunId: string) {
    return request<QueryTraceRead>(`/query/${queryRunId}/trace`, { token })
  },

  listTeamChatMessages(token: string, limit = 80, threadId?: string) {
    const thread = threadId ? `&thread_id=${encodeURIComponent(threadId)}` : ''
    return request<TeamChatThreadRead>(`/team-chat?limit=${limit}${thread}`, { token })
  },

  createTeamChatMessage(token: string, body: string, options: { thread_id?: string; thread_title?: string; thread_kind?: 'channel' | 'direct' | 'group'; reply_to_message_id?: string; message_metadata?: Record<string, unknown> } = {}) {
    return request<TeamChatMessageRead>('/team-chat', {
      method: 'POST',
      token,
      body: JSON.stringify({ body, ...options }),
    })
  },

  attachTeamChatFile(token: string, file: File, options: { thread_id: string; thread_title: string; thread_kind: 'channel' | 'direct' | 'group'; participant_user_ids: string[] }) {
    const body = new FormData()
    body.append('file', file)
    body.append('thread_id', options.thread_id)
    body.append('thread_title', options.thread_title)
    body.append('thread_kind', options.thread_kind)
    body.append('participant_user_ids', JSON.stringify(options.participant_user_ids))
    return request<TeamChatMessageRead>('/team-chat/attachments', { method: 'POST', token, body })
  },

  markTeamChatTyping(token: string, thread_id: string, thread_kind: 'channel' | 'direct' | 'group' = 'channel') {
    return request<TeamChatTypingRead>('/team-chat/typing', {
      method: 'POST',
      token,
      body: JSON.stringify({ thread_id, thread_kind }),
    })
  },

  listTeamChatTyping(token: string, thread_id: string, thread_kind: 'channel' | 'direct' | 'group' = 'channel') {
    return request<TeamChatTypingRead>(`/team-chat/typing?thread_id=${encodeURIComponent(thread_id)}&thread_kind=${thread_kind}`, { token })
  },

  listWorkTasks(token: string) {
    return request<{ items: WorkTaskRead[] }>('/work/tasks', { token }).then((response) => response.items)
  },

  createWorkTask(token: string, payload: {
    title: string
    description?: string | null
    assignee_user_id?: string | null
    due_at?: string | null
    remind_at?: string | null
    source_artifact_ids?: string[]
  }) {
    return request<WorkTaskRead>('/work/tasks', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    })
  },

  updateWorkTask(token: string, taskId: string, payload: Partial<{
    title: string
    description: string | null
    status: WorkTaskStatus
    assignee_user_id: string | null
    due_at: string | null
    remind_at: string | null
    source_artifact_ids: string[]
  }>) {
    return request<WorkTaskRead>(`/work/tasks/${taskId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    })
  },

  askColleague(token: string, payload: {
    message: string
    thread_id?: string
    thread_title?: string
    thread_kind?: 'channel' | 'direct' | 'group'
    participant_user_ids?: string[]
    client_request_id?: string
    reply_to_message_id?: string
  } & Partial<AgentRequestOptions>) {
    return request<AgentRunCreated>('/work/ask', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...payload, response_language: getLanguage() }),
    })
  },

  listAssistantConversations(token: string, includeArchived = false) {
    return request<{ items: AssistantConversationRead[] }>(`/work/conversations?include_archived=${includeArchived}`, { token }).then((response) => response.items)
  },

  createAssistantConversation(token: string, title?: string) {
    return request<AssistantConversationRead>('/work/conversations', {
      method: 'POST',
      token,
      body: JSON.stringify({ title: title || 'İzge ile çalışma' }),
    })
  },

  getAssistantConversation(token: string, conversationId: string) {
    return request<AssistantConversationRead>(`/work/conversations/${encodeURIComponent(conversationId)}`, { token })
  },

  updateAssistantConversation(token: string, conversationId: string, payload: { title?: string; archived?: boolean }) {
    return request<AssistantConversationRead>(`/work/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    })
  },

  deleteAssistantConversation(token: string, conversationId: string) {
    return request<void>(`/work/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE', token })
  },

  attachAssistantConversationFile(token: string, conversationId: string, file: File) {
    const body = new FormData()
    body.append('file', file)
    return request<TeamChatMessageRead>(`/work/conversations/${encodeURIComponent(conversationId)}/attachments`, { method: 'POST', token, body })
  },

  getAgentModels(token: string) {
    return request<AgentModelCatalogRead>('/work/models', { token })
  },

  listAgentRuns(token: string, threadId?: string) {
    const query = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : ''
    return request<{ items: AgentRunRead[] }>(`/work/runs${query}`, { token }).then((response) => response.items)
  },

  getAgentRun(token: string, runId: string) {
    return request<AgentRunRead>(`/work/runs/${runId}`, { token })
  },

  requestEveningReview(token: string) {
    return request<{ run_id: string; status: 'queued' | 'running' }>('/work/review', {
      method: 'POST',
      token,
    })
  },

  agentRunEventsUrl(runId: string) {
    return `${API_BASE}/work/runs/${encodeURIComponent(runId)}/events`
  },

  subscribeAgentRunEvents(runId: string) {
    if (!browserDemo) {
      const events = new EventSource(api.agentRunEventsUrl(runId), { withCredentials: true })
      // Stored SSE events replay from the beginning; do not append them to a cached answer.
      events.addEventListener('open', () => events.dispatchEvent(new MessageEvent('reset', { data: '{}' })), { once: true })
      return events
    }
    const events = new EventTarget() as EventTarget & { close: () => void; onerror: (() => void) | null }
    const unsubscribe = browserDemo.subscribeRun(runId, (event) => events.dispatchEvent(new MessageEvent(event.type === 'result' ? 'done' : event.type, { data: JSON.stringify(event.data) })))
    let closed = false
    events.close = () => { closed = true; unsubscribe() }
    events.onerror = null
    browserDemo.request(`/work/runs/${runId}`).then((run) => {
      if (!closed) events.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(run) }))
    }).catch(() => { if (!closed) events.onerror?.() })
    return events
  },

  listNotifications(token: string, unreadOnly = false) {
    return request<{ items: NotificationRead[]; unread_count: number }>(`/notifications?limit=50&unread_only=${unreadOnly}`, { token })
  },

  getNotification(token: string, notificationId: string) {
    return request<NotificationRead>(`/notifications/${encodeURIComponent(notificationId)}`, { token })
  },

  markNotificationRead(token: string, notificationId: string) {
    return request<NotificationRead>(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH', token })
  },

  markNotificationUnread(token: string, notificationId: string) {
    return request<NotificationRead>(`/notifications/${encodeURIComponent(notificationId)}/unread`, { method: 'PATCH', token })
  },

  deleteNotification(token: string, notificationId: string) {
    return request<void>(`/notifications/${encodeURIComponent(notificationId)}`, { method: 'DELETE', token })
  },

  listAutomations(token: string) {
    return request<{ items: AutomationRead[] }>('/automations', { token }).then((response) => response.items)
  },

  createAutomation(token: string, payload: { title: string; prompt: string; schedule_time: string; frequency: AutomationRead['frequency']; starts_at: string; enabled?: boolean }) {
    return request<AutomationRead>('/automations', { method: 'POST', token, body: JSON.stringify({ ...payload, response_language: getLanguage() }) })
  },

  updateAutomation(token: string, automationId: string, payload: Partial<Pick<AutomationRead, 'title' | 'prompt' | 'schedule_time' | 'frequency' | 'starts_at' | 'enabled'>>) {
    return request<AutomationRead>(`/automations/${automationId}`, { method: 'PATCH', token, body: JSON.stringify({ ...payload, ...(payload.prompt !== undefined ? { response_language: getLanguage() } : {}) }) })
  },

  runAutomation(token: string, automationId: string) {
    return request<AgentRunCreated>(`/automations/${automationId}/run`, { method: 'POST', token })
  },

  deleteAutomation(token: string, automationId: string) {
    return request<void>(`/automations/${automationId}`, { method: 'DELETE', token })
  },

  getGraphSummary(token: string) {
    return request<GraphSummary>('/graph/summary', { token })
  },

  getGraphTimeline(token: string) {
    return request<GraphTimeline>('/graph/timeline', { token })
  },

  getGraphNeighborhood(token: string, memoryType: string, memoryId: string) {
    return request<GraphNeighborhood>(`/graph/neighborhood/${memoryType}/${memoryId}`, { token })
  },

  getMemoryDetail(token: string, memoryType: string, memoryId: string) {
    return request<MemoryDetail>(`/memory/${memoryType}/${memoryId}`, { token })
  },

  listContradictions(token: string) {
    return request<ContradictionItem[]>('/contradictions', { token })
  },

  listAssumptionDrift(token: string) {
    return request<AssumptionDriftItem[]>('/assumptions/stale', { token })
  },

  listNextActions(token: string) {
    return request<NextActionSignalItem[]>('/next-actions', { token })
  },

  listSignals(token: string) {
    return request<SignalRead[]>('/signals', { token })
  },

  getSignal(token: string, signalId: string) {
    return request<SignalDetail>(`/signals/${signalId}`, { token })
  },

  listAuditEvents(token: string) {
    return request<AuditEventRead[]>('/audit/events', { token })
  },

  getLocalLLMStatus(token: string) {
    return request<LocalLLMStatusRead>('/system/llm-status', { token })
  },


  getMemoryFilesystem(token: string) {
    return request<MemoryFilesystemRead>('/evidence-substrate/filesystem', { token })
  },

  getOrchestrationBlueprint(token: string) {
    return request<OrchestrationBlueprintRead>('/evidence-substrate/orchestration', { token })
  },

  getTargetReadiness(token: string) {
    return request<TargetReadinessRead>('/evidence-substrate/readiness', { token })
  },

  listOrchestrationStageRuns(token: string, limit = 40, queryRunId?: string) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (queryRunId) {
      params.set('query_run_id', queryRunId)
    }
    return request<OrchestrationStageRunsRead>(`/evidence-substrate/orchestration/runs?${params.toString()}`, { token })
  },

  listOrchestrationJobs(token: string, limit = 20) {
    return request<OrchestrationJobListRead>(`/evidence-substrate/orchestration/jobs?limit=${limit}`, { token })
  },

  getTemporalGraph(token: string, limit = 80) {
    return request<TemporalGraphRead>(`/graph/temporal?limit=${limit}`, { token })
  },

  runScenarioImpact(token: string, scenarioText: string, limit = 10) {
    return request<ScenarioImpactRead>('/scenario/impact', {
      method: 'POST',
      token,
      body: JSON.stringify({ scenario_text: scenarioText, limit }),
    })
  },

  listScenarioRuns(token: string, limit = 30) {
    return request<ScenarioRunListRead>(`/scenario/runs?limit=${limit}`, { token })
  },

  getScenarioRun(token: string, scenarioRunId: string) {
    return request<ScenarioRunRead>(`/scenario/runs/${scenarioRunId}`, { token })
  },

  replayScenarioRun(token: string, scenarioRunId: string) {
    return request<ScenarioReplayRead>(`/scenario/runs/${scenarioRunId}/replay`, {
      method: 'POST',
      token,
    })
  },

  listScenarioTemplates(token: string) {
    return request<ScenarioTemplateCatalogItem[]>('/scenario/templates', { token })
  },

  runLocalLLMSmoke(token: string) {
    return request<LocalLLMSmokeRead>('/system/llm-smoke', {
      method: 'POST',
      token,
    })
  },

  getDatabaseOverview(token: string) {
    return request<DatabaseOverviewRead>('/admin/database', { token })
  },

  getOperationsOverview(token: string) {
    return request<OperationsOverviewRead>('/operations/overview', { token })
  },
}
