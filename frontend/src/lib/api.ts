import { getLanguage, translate } from './language'
import type {
  ArtifactDetail,
  ArtifactProactiveSignals,
  ArtifactRead,
  AssumptionDriftItem,
  AuditEventRead,
  ContradictionItem,
  DatabaseOverviewRead,
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const detail =
      typeof payload === 'string'
        ? payload
        : typeof payload?.detail === 'string'
          ? payload.detail
          : translate('Request failed', 'İstek başarısız')
    throw new ApiError(detail, response.status)
  }

  return payload as T
}

export const api = {
  signIn(email: string, password: string) {
    return request<TokenResponse>('/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },

  getCurrentUser(token?: string) {
    return request<UserRead>('/users/me', { token })
  },

  signOut(token?: string) {
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
    return `${API_BASE}/artifacts/${encodeURIComponent(artifactId)}/preview${asText ? "?as_text=true" : ""}`
  },

  artifactDownloadUrl(artifactId: string) {
    return `${API_BASE}/artifacts/${encodeURIComponent(artifactId)}/download`
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

  listTeamChatMessages(token: string, limit = 80) {
    return request<TeamChatThreadRead>(`/team-chat?limit=${limit}`, { token })
  },

  createTeamChatMessage(token: string, body: string, options: { thread_id?: string; thread_title?: string; thread_kind?: 'channel' | 'direct' | 'group'; message_metadata?: Record<string, unknown> } = {}) {
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
  }) {
    return request<AgentRunCreated>('/work/ask', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...payload, response_language: getLanguage() }),
    })
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

  listNotifications(token: string, unreadOnly = false) {
    return request<{ items: NotificationRead[]; unread_count: number }>(`/notifications?limit=50&unread_only=${unreadOnly}`, { token })
  },

  markNotificationRead(token: string, notificationId: string) {
    return request<NotificationRead>(`/notifications/${notificationId}/read`, { method: 'PATCH', token })
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
