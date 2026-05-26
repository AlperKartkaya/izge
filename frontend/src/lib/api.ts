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
  OrchestrationStageRunsRead,
  MemoryFilesystemRead,
  NextActionSignalItem,
  QueryResult,
  QueryTraceRead,
  SignalDetail,
  SignalRead,
  TargetReadinessRead,
  TokenResponse,
  UserRead,
  UserRole,
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
          : 'Request failed'
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

  submitQuery(token: string, queryText: string) {
    return request<QueryResult>('/query', {
      method: 'POST',
      token,
      body: JSON.stringify({ query_text: queryText }),
    })
  },

  getQueryResult(token: string, queryRunId: string) {
    return request<QueryResult>(`/query/${queryRunId}`, { token })
  },

  getQueryTrace(token: string, queryRunId: string) {
    return request<QueryTraceRead>(`/query/${queryRunId}/trace`, { token })
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

  listOrchestrationStageRuns(token: string, limit = 40) {
    return request<OrchestrationStageRunsRead>(`/evidence-substrate/orchestration/runs?limit=${limit}`, { token })
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
}
