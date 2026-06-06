import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEventHandler,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { workspaceStarterPrompts } from '../lib/workspacePrompts'
import { formatDateTime, formatLabel } from '../lib/format'
import type {
  EvidenceReference,
  LocalLLMStatusRead,
  MemoryReference,
  OrchestrationStageRunRead,
  QueryResult,
  QueryTraceRead,
  SignalRead,
} from '../lib/types'

type ChatRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  queryRunId?: string
  queryClass?: string
  permissionsLimited?: boolean
  whyThisAnswer?: string
  recommendedNextActions?: string[]
  uncertaintyNotes?: string[]
  supportingEvidence?: EvidenceReference[]
  supportingNodes?: MemoryReference[]
  relatedSignals?: SignalRead[]
}

interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

function createMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function legacyChatStorageKey(
  workspaceId: string | undefined,
  userId: string | undefined,
): string {
  return `izge-chat-session:${workspaceId || 'workspace'}:${userId || 'user'}`
}

function chatThreadsStorageKey(
  workspaceId: string | undefined,
  userId: string | undefined,
): string {
  return `izge-chat-threads:${workspaceId || 'workspace'}:${userId || 'user'}`
}

function isValidChatMessage(
  message: ChatMessage | null | undefined,
): message is ChatMessage {
  return Boolean(
    message &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string',
  )
}

function titleFromMessages(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  const rawTitle = firstUserMessage?.content.trim() || 'New chat'
  return rawTitle.length > 48 ? `${rawTitle.slice(0, 47)}…` : rawTitle
}

function createChatThread(messages: ChatMessage[] = []): ChatThread {
  const now = new Date().toISOString()
  return {
    id: createMessageId(),
    title: titleFromMessages(messages),
    createdAt: messages[0]?.createdAt ?? now,
    updatedAt: messages.at(-1)?.createdAt ?? now,
    messages,
  }
}

function normalizeThread(
  rawThread: Partial<ChatThread> | null | undefined,
): ChatThread | null {
  if (!rawThread || !Array.isArray(rawThread.messages)) {
    return null
  }
  const messages = rawThread.messages.filter(isValidChatMessage)
  return {
    id: typeof rawThread.id === 'string' ? rawThread.id : createMessageId(),
    title:
      typeof rawThread.title === 'string' && rawThread.title.trim()
        ? rawThread.title.trim()
        : titleFromMessages(messages),
    createdAt:
      typeof rawThread.createdAt === 'string'
        ? rawThread.createdAt
        : messages[0]?.createdAt ?? new Date().toISOString(),
    updatedAt:
      typeof rawThread.updatedAt === 'string'
        ? rawThread.updatedAt
        : messages.at(-1)?.createdAt ?? new Date().toISOString(),
    messages,
  }
}

function loadStoredThreads(
  storageKey: string,
  legacyStorageKey: string,
): ChatThread[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey) || '[]',
    ) as Partial<ChatThread>[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .map(normalizeThread)
        .filter((thread): thread is ChatThread => thread !== null)
    }
  } catch {
    // Fall through to legacy session migration.
  }

  try {
    const legacyMessages = JSON.parse(
      window.localStorage.getItem(legacyStorageKey) || '[]',
    ) as ChatMessage[]
    const messages = Array.isArray(legacyMessages)
      ? legacyMessages.filter(isValidChatMessage)
      : []
    return messages.length > 0 ? [createChatThread(messages)] : []
  } catch {
    return []
  }
}

function persistStoredThreads(storageKey: string, threads: ChatThread[]) {
  if (typeof window === 'undefined') {
    return
  }

  const compactThreads = threads
    .slice(0, 16)
    .map((thread) => ({
      ...thread,
      title: thread.title || titleFromMessages(thread.messages),
      messages: thread.messages.slice(-24).map((message) => ({
        ...message,
        supportingEvidence: message.supportingEvidence?.slice(0, 6),
        supportingNodes: message.supportingNodes?.slice(0, 8),
        relatedSignals: message.relatedSignals?.slice(0, 4),
      })),
    }))
  window.localStorage.setItem(storageKey, JSON.stringify(compactThreads))
}

function buildSessionAwareQuery(
  previousMessages: ChatMessage[],
  currentQuestion: string,
): string {
  const recentTurns = previousMessages
    .slice(-8)
    .map(
      (message) =>
        `${message.role === 'user' ? 'Employee' : 'Assistant'}: ${message.content.replace(/\s+/g, ' ').trim()}`,
    )
    .join('\n')
    .slice(-3600)

  if (!recentTurns) {
    return currentQuestion
  }

  return [
    'Use the following same-session chat context only for conversational continuity.',
    'Keep the answer grounded in Izge artifacts and memory records visible to the signed-in employee. Do not use artifacts outside their permissions.',
    '',
    recentTurns,
    '',
    `Current employee question: ${currentQuestion}`,
  ].join('\n')
}

function answerFromResult(result: QueryResult): string {
  return (
    result.answer_text ||
    result.why_this_answer ||
    'Izge generated an answer, but no answer text was returned.'
  )
}

function resultToAssistantMessage(result: QueryResult): ChatMessage {
  return {
    id: createMessageId(),
    role: 'assistant',
    content: answerFromResult(result),
    createdAt: result.created_at,
    queryRunId: result.query_run_id,
    queryClass: result.query_class,
    permissionsLimited: result.permissions_limited,
    whyThisAnswer: result.why_this_answer,
    recommendedNextActions: result.recommended_next_actions,
    uncertaintyNotes: result.uncertainty_notes,
    supportingEvidence: result.supporting_evidence,
    supportingNodes: result.supporting_nodes,
    relatedSignals: result.related_signals,
  }
}

function traceStepTitle(stepKind: string): string {
  const titles: Record<string, string> = {
    route_classification: 'Main oracle classified the question',
    retrieval_recipe: 'Retrieval recipe prepared',
    memory_selection: 'Permitted memory objects selected',
    evidence_selection: 'Evidence snippets attached',
    contradiction_check: 'Contradiction subagent checked conflicts',
    drift_check: 'Assumption-drift subagent checked freshness',
    answer_synthesis: 'Answer synthesis boundary recorded',
    permissions_filter: 'Permission filter enforced',
  }
  return titles[stepKind] ?? formatLabel(stepKind)
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'None'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  if (typeof value === 'object') {
    return Object.keys(value).slice(0, 4).join(', ') || 'Object'
  }
  return String(value)
}

function stageTitle(stageKey: string): string {
  const titles: Record<string, string> = {
    contradiction_interrogator: 'Contradiction subagent',
    assumption_drift_interrogator: 'Drift subagent',
    guidance_planner: 'Guidance planner subagent',
  }
  return titles[stageKey] ?? formatLabel(stageKey)
}

function llmStatusCopy(
  status: LocalLLMStatusRead | null,
  error: string | null,
): { label: string; detail: string; tone: 'ready' | 'fallback' | 'blocked' } {
  if (error) {
    return {
      label: 'Admin-only status',
      detail:
        'Employees can use the assistant, but local model diagnostics are visible only to admins.',
      tone: 'blocked',
    }
  }
  if (!status) {
    return {
      label: 'Checking model',
      detail: 'Loading local LLM status…',
      tone: 'fallback',
    }
  }
  if (status.gateway_status === 'ready') {
    return {
      label: 'Local model ready',
      detail: `${status.configured_model} is available. Enabled features decide whether routing, synthesis, and extraction call the model.`,
      tone: 'ready',
    }
  }
  if (!status.enabled) {
    return {
      label: 'Deterministic fallback',
      detail:
        'Local LLM is disabled, so Izge uses deterministic retrieval and answer assembly. Set IZGE_LOCAL_LLM_ENABLED=true and enable query routing/synthesis flags to use a local model.',
      tone: 'fallback',
    }
  }
  return {
    label: formatLabel(status.gateway_status),
    detail:
      status.error ||
      `${status.configured_model} is configured at ${status.base_url}, but the gateway is not ready.`,
    tone: 'blocked',
  }
}

export function QueryPage() {
  const [searchParams] = useSearchParams()
  const { session } = useAuth()
  const promptFromUrl = searchParams.get('prompt')
  const storageKey = useMemo(
    () =>
      chatThreadsStorageKey(session?.user.workspace_id, session?.user.user_id),
    [session?.user.user_id, session?.user.workspace_id],
  )
  const legacyStorageKey = useMemo(
    () =>
      legacyChatStorageKey(session?.user.workspace_id, session?.user.user_id),
    [session?.user.user_id, session?.user.workspace_id],
  )
  const [threads, setThreads] = useState<ChatThread[]>(() => {
    const storedThreads = loadStoredThreads(storageKey, legacyStorageKey)
    return storedThreads.length > 0 ? storedThreads : [createChatThread()]
  })
  const [activeThreadId, setActiveThreadId] = useState(
    () => threads[0]?.id ?? '',
  )
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [queryDraftState, setQueryDraftState] = useState({
    sourcePrompt: promptFromUrl,
    text: promptFromUrl || '',
  })
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(
    null,
  )
  const [activeTrace, setActiveTrace] = useState<QueryTraceRead | null>(null)
  const [activeStageRuns, setActiveStageRuns] = useState<
    OrchestrationStageRunRead[]
  >([])
  const [llmStatus, setLlmStatus] = useState<LocalLLMStatusRead | null>(null)
  const [llmStatusError, setLlmStatusError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const queryDraft =
    queryDraftState.sourcePrompt === promptFromUrl
      ? queryDraftState.text
      : promptFromUrl || queryDraftState.text

  const activeThread = useMemo(
    () =>
      threads.find((thread) => thread.id === activeThreadId) ??
      threads[0] ??
      null,
    [activeThreadId, threads],
  )
  const messages = useMemo(() => activeThread?.messages ?? [], [activeThread])
  const assistantMessages = useMemo(
    () => messages.filter((message) => message.role === 'assistant'),
    [messages],
  )
  const activeAssistant = useMemo(
    () =>
      assistantMessages.find((message) => message.id === activeAssistantId) ??
      assistantMessages.at(-1) ??
      null,
    [activeAssistantId, assistantMessages],
  )
  const llmCopy = llmStatusCopy(llmStatus, llmStatusError)

  useEffect(() => {
    const storedThreads = loadStoredThreads(storageKey, legacyStorageKey)
    const nextThreads =
      storedThreads.length > 0 ? storedThreads : [createChatThread()]
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) {
        return
      }
      setThreads(nextThreads)
      setActiveThreadId(nextThreads[0]?.id ?? '')
      setActiveAssistantId(null)
      setActiveTrace(null)
      setActiveStageRuns([])
    })
    return () => {
      cancelled = true
    }
  }, [legacyStorageKey, storageKey])

  useEffect(() => {
    if (threads.length > 0) {
      persistStoredThreads(storageKey, threads)
    }
  }, [storageKey, threads])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, isSubmitting])

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      if (!session?.token || session.user.role !== 'Admin') {
        setLlmStatus(null)
        setLlmStatusError(null)
        return
      }

      try {
        const payload = await api.getLocalLLMStatus(session.token)
        if (!cancelled) {
          setLlmStatus(payload)
          setLlmStatusError(null)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setLlmStatus(null)
          setLlmStatusError(
            caughtError instanceof ApiError
              ? caughtError.message
              : 'Unable to load local model status.',
          )
        }
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [session?.token, session?.user.role])

  useEffect(() => {
    let cancelled = false

    async function loadTrace() {
      if (!session?.token || !activeAssistant?.queryRunId) {
        setActiveTrace(null)
        setActiveStageRuns([])
        return
      }

      try {
        const [tracePayload, stageRunsPayload] = await Promise.all([
          api.getQueryTrace(session.token, activeAssistant.queryRunId),
          api.listOrchestrationStageRuns(
            session.token,
            20,
            activeAssistant.queryRunId,
          ),
        ])
        if (!cancelled) {
          setActiveTrace(tracePayload)
          setActiveStageRuns(stageRunsPayload.runs)
        }
      } catch {
        if (!cancelled) {
          setActiveTrace(null)
          setActiveStageRuns([])
        }
      }
    }

    void loadTrace()

    return () => {
      cancelled = true
    }
  }, [activeAssistant?.queryRunId, session?.token])

  function updateActiveThreadMessages(
    updater: (currentMessages: ChatMessage[]) => ChatMessage[],
  ) {
    setThreads((currentThreads) =>
      currentThreads.map((thread) => {
        if (thread.id !== activeThreadId) {
          return thread
        }
        const nextMessages = updater(thread.messages)
        return {
          ...thread,
          title: titleFromMessages(nextMessages),
          updatedAt: nextMessages.at(-1)?.createdAt ?? new Date().toISOString(),
          messages: nextMessages,
        }
      }),
    )
  }

  function selectThread(threadId: string) {
    setActiveThreadId(threadId)
    setActiveAssistantId(null)
    setActiveTrace(null)
    setActiveStageRuns([])
  }

  function handleNewChat() {
    const nextThread = createChatThread()
    setThreads((currentThreads) => [nextThread, ...currentThreads])
    selectThread(nextThread.id)
    setQueryDraftState({ sourcePrompt: promptFromUrl, text: '' })
    setError(null)
  }

  function handleDeleteThread(threadId: string) {
    const remainingThreads = threads.filter((thread) => thread.id !== threadId)
    const nextThreads =
      remainingThreads.length > 0 ? remainingThreads : [createChatThread()]
    setThreads(nextThreads)
    if (threadId === activeThreadId) {
      selectThread(nextThreads[0].id)
    }
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token) {
      return
    }

    const trimmedQuestion = queryDraft.trim()
    if (trimmedQuestion.length < 3) {
      setError('Ask a question with at least three characters.')
      return
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: 'user',
      content: trimmedQuestion,
      createdAt: new Date().toISOString(),
    }
    const previousMessages = messages
    const queryText = buildSessionAwareQuery(previousMessages, trimmedQuestion)

    updateActiveThreadMessages((current) => [...current, userMessage])
    setQueryDraftState({ sourcePrompt: promptFromUrl, text: '' })
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await api.submitQuery(session.token, queryText)
      const assistantMessage = resultToAssistantMessage(result)
      updateActiveThreadMessages((current) => [...current, assistantMessage])
      setActiveAssistantId(assistantMessage.id)
    } catch (caughtError) {
      updateActiveThreadMessages((current) =>
        current.filter((message) => message.id !== userMessage.id),
      )
      setQueryDraftState({
        sourcePrompt: promptFromUrl,
        text: trimmedQuestion,
      })
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : 'Unable to submit chat message.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="full-chat-page assistant-clean-page">
      <header className="assistant-topbar assistant-clean-topbar">
        <div>
          <p className="eyebrow">Company assistant</p>
          <h2 className="page-title">Ask Izge</h2>
          <p className="page-description">
            Answers use only the company memory your account can access.
          </p>
        </div>
        <div className="assistant-status-row" aria-label="Assistant controls">
          {session?.user.role === 'Admin' && llmStatus ? (
            <span
              className={`assistant-runtime-pill assistant-runtime-pill-${llmCopy.tone}`}
            >
              {llmCopy.label}
            </span>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            onClick={handleNewChat}
            disabled={isSubmitting}
          >
            New chat
          </button>
        </div>
      </header>

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className={historyCollapsed ? 'assistant-workspace assistant-workspace-history-collapsed' : 'assistant-workspace assistant-workspace-with-history'}>
        <aside className="assistant-history-sidebar panel-subtle" aria-label="Saved assistant chats">
          <div className="assistant-history-head">
            <div>
              <p className="section-label">History</p>
              {!historyCollapsed ? (
                <p className="table-secondary">{threads.length} saved chat{threads.length === 1 ? '' : 's'}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={historyCollapsed ? 'Show chat history' : 'Hide chat history'}
              onClick={() => setHistoryCollapsed((current) => !current)}
            >
              {historyCollapsed ? '›' : '‹'}
            </button>
          </div>
          {!historyCollapsed ? (
            <div className="assistant-history-list">
              {threads.map((thread) => (
                <article
                  key={thread.id}
                  className={thread.id === activeThreadId ? 'assistant-history-item assistant-history-item-active' : 'assistant-history-item'}
                >
                  <button
                    type="button"
                    className="assistant-history-select"
                    onClick={() => selectThread(thread.id)}
                  >
                    <span className="table-primary">{thread.title}</span>
                    <span className="table-secondary">
                      {thread.messages.length} message{thread.messages.length === 1 ? '' : 's'} · {formatDateTime(thread.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="table-action-link assistant-history-delete"
                    onClick={() => handleDeleteThread(thread.id)}
                    disabled={isSubmitting}
                    aria-label={`Delete chat ${thread.title}`}
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </aside>
        <section
          className="assistant-main assistant-main-clean panel-subtle"
          aria-label="Assistant conversation"
        >
          <div className="assistant-thread" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-empty-state assistant-empty-state panel-subtle">
                <p className="table-primary">What do you need to know?</p>
                <p className="muted-copy">
                  Ask a short work question. Open details only when you need
                  sources or trace.
                </p>
                <div className="assistant-empty-prompts">
                  {workspaceStarterPrompts.slice(0, 3).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="prompt-card"
                      onClick={() =>
                        setQueryDraftState({
                          sourcePrompt: promptFromUrl,
                          text: prompt,
                        })
                      }
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => {
                const inspectorOpen =
                  message.role === 'assistant' &&
                  activeAssistantId === message.id
                return (
                  <article
                    key={message.id}
                    className={
                      message.role === 'user'
                        ? 'chat-message chat-message-user'
                        : 'chat-message chat-message-assistant assistant-message-card'
                    }
                  >
                    <div className="chat-message-head">
                      <span className="section-label">
                        {message.role === 'user' ? 'You' : 'Izge'}
                      </span>
                      <span className="table-secondary">
                        {formatDateTime(message.createdAt)}
                      </span>
                    </div>
                    <p className="chat-message-copy">{message.content}</p>

                    {message.role === 'assistant' ? (
                      <div className="chat-answer-meta">
                        <div className="inline-actions">
                          {message.queryClass ? (
                            <StatusBadge
                              value={formatLabel(message.queryClass)}
                            />
                          ) : null}
                          {message.permissionsLimited ? (
                            <StatusBadge value="Permission-limited" />
                          ) : null}
                          {message.queryRunId ? (
                            <button
                              type="button"
                              className="table-action-link inline-button-link"
                              onClick={() =>
                                setActiveAssistantId(
                                  inspectorOpen ? null : message.id,
                                )
                              }
                            >
                              {inspectorOpen
                                ? 'Hide sources'
                                : 'Sources and trace'}
                            </button>
                          ) : null}
                          {message.queryRunId ? (
                            <Link
                              className="table-action-link"
                              to={`/query/${message.queryRunId}`}
                            >
                              Full result
                            </Link>
                          ) : null}
                        </div>

                        {message.supportingEvidence &&
                        message.supportingEvidence.length > 0 ? (
                          <details className="chat-detail-disclosure">
                            <summary>
                              Sources · {message.supportingEvidence.length}
                            </summary>
                            <ol className="chat-citations">
                              {message.supportingEvidence
                                .slice(0, 3)
                                .map((evidence) => (
                                  <li
                                    key={`${message.id}-${evidence.artifact_id}-${evidence.chunk_id || evidence.excerpt.slice(0, 24)}`}
                                  >
                                    <strong>{evidence.artifact_title}</strong>
                                    <span>{evidence.excerpt}</span>
                                  </li>
                                ))}
                            </ol>
                          </details>
                        ) : null}

                        {message.recommendedNextActions &&
                        message.recommendedNextActions.length > 0 ? (
                          <details className="chat-detail-disclosure">
                            <summary>
                              Next actions · {message.recommendedNextActions.length}
                            </summary>
                            <ul className="bullet-list compact-list">
                              {message.recommendedNextActions
                                .slice(0, 3)
                                .map((action) => (
                                  <li key={action}>{action}</li>
                                ))}
                            </ul>
                          </details>
                        ) : null}

                        {inspectorOpen ? (
                          <div className="assistant-inline-inspector panel-subtle">
                            {activeAssistant?.supportingEvidence &&
                            activeAssistant.supportingEvidence.length > 0 ? (
                              <section className="assistant-inline-section">
                                <p className="section-label">Sources</p>
                                <div className="assistant-evidence-list">
                                  {activeAssistant.supportingEvidence
                                    .slice(0, 5)
                                    .map((evidence) => (
                                      <article
                                        key={`${evidence.artifact_id}-${evidence.chunk_id ?? evidence.excerpt.slice(0, 16)}`}
                                        className="panel-subtle stack-sm"
                                      >
                                        <p className="table-primary">
                                          {evidence.artifact_title}
                                        </p>
                                        <p className="muted-copy">
                                          {evidence.excerpt}
                                        </p>
                                        <div className="inline-actions">
                                          <a
                                            className="table-action-link"
                                            href={api.artifactPreviewUrl(
                                              evidence.artifact_id,
                                            )}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Preview
                                          </a>
                                          <a
                                            className="table-action-link"
                                            href={api.artifactDownloadUrl(
                                              evidence.artifact_id,
                                            )}
                                          >
                                            Download
                                          </a>
                                        </div>
                                      </article>
                                    ))}
                                </div>
                              </section>
                            ) : null}

                            <section className="assistant-inline-section">
                              <p className="section-label">Orchestration</p>
                              <div className="orchestration-ledger">
                                {activeStageRuns.length > 0
                                  ? activeStageRuns.map((run) => (
                                      <article
                                        key={run.stage_run_id}
                                        className="orchestration-ledger-item"
                                      >
                                        <div>
                                          <p className="table-primary">
                                            {stageTitle(run.stage_key)}
                                          </p>
                                          <p className="table-secondary">
                                            {formatLabel(run.status)} ·{' '}
                                            {formatLabel(run.authority_level)} ·{' '}
                                            {formatDateTime(run.created_at)}
                                          </p>
                                        </div>
                                        {run.verifier_status ? (
                                          <StatusBadge
                                            value={formatLabel(
                                              run.verifier_status,
                                            )}
                                          />
                                        ) : null}
                                        <p className="muted-copy">
                                          {summarizeValue(run.output_summary)}
                                        </p>
                                      </article>
                                    ))
                                  : null}
                                {activeTrace?.steps.map((step) => (
                                  <article
                                    key={`${step.step_kind}-${step.created_at}`}
                                    className="orchestration-ledger-item orchestration-ledger-item-muted"
                                  >
                                    <div>
                                      <p className="table-primary">
                                        {traceStepTitle(step.step_kind)}
                                      </p>
                                      <p className="table-secondary">
                                        {formatDateTime(step.created_at)}
                                      </p>
                                    </div>
                                    <p className="muted-copy">
                                      {summarizeValue(step.payload)}
                                    </p>
                                  </article>
                                ))}
                                {!activeTrace &&
                                activeStageRuns.length === 0 ? (
                                  <p className="muted-copy">
                                    Trace packets will appear after the answer
                                    finishes loading.
                                  </p>
                                ) : null}
                              </div>
                            </section>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                )
              })
            )}

            {isSubmitting ? (
              <article className="chat-message chat-message-assistant chat-message-pending assistant-message-card">
                <div className="chat-message-head">
                  <span className="section-label">Izge</span>
                  <span className="table-secondary">Working…</span>
                </div>
                <p className="chat-message-copy">
                  Routing the question, retrieving permitted artifacts, and
                  checking the graph before answering.
                </p>
              </article>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          <form
            className="chat-composer assistant-composer"
            onSubmit={handleSubmit}
          >
            <label className="field field-block chat-input-field">
              <span className="field-label">Message Izge</span>
              <textarea
                className="chat-input"
                value={queryDraft}
                onChange={(event) =>
                  setQueryDraftState({
                    sourcePrompt: promptFromUrl,
                    text: event.target.value,
                  })
                }
                rows={3}
                minLength={3}
                placeholder="Ask about a decision, document, owner, risk, meeting note, or next action…"
                required
              />
            </label>
            <button
              type="submit"
              className="primary-button chat-send-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Thinking…' : 'Send'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
