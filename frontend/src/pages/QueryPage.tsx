import { useEffect, useMemo, useRef, useState, type FormEventHandler } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { starterPrompts } from '../lib/demo'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
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

function createMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function chatStorageKey(workspaceId: string | undefined, userId: string | undefined): string {
  return `izge-chat-session:${workspaceId || 'workspace'}:${userId || 'user'}`
}

function loadStoredMessages(storageKey: string): ChatMessage[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]') as ChatMessage[]
    return Array.isArray(parsed)
      ? parsed.filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
      : []
  } catch {
    return []
  }
}

function persistStoredMessages(storageKey: string, messages: ChatMessage[]) {
  if (typeof window === 'undefined') {
    return
  }

  const compactMessages = messages.slice(-24).map((message) => ({
    ...message,
    supportingEvidence: message.supportingEvidence?.slice(0, 6),
    supportingNodes: message.supportingNodes?.slice(0, 8),
    relatedSignals: message.relatedSignals?.slice(0, 4),
  }))
  window.localStorage.setItem(storageKey, JSON.stringify(compactMessages))
}

function buildSessionAwareQuery(previousMessages: ChatMessage[], currentQuestion: string): string {
  const recentTurns = previousMessages
    .slice(-8)
    .map((message) => `${message.role === 'user' ? 'Employee' : 'Assistant'}: ${message.content.replace(/\s+/g, ' ').trim()}`)
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
  return result.answer_text || result.why_this_answer || 'Izge generated an answer, but no answer text was returned.'
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

function llmStatusCopy(status: LocalLLMStatusRead | null, error: string | null): { label: string; detail: string; tone: 'ready' | 'fallback' | 'blocked' } {
  if (error) {
    return {
      label: 'Admin-only status',
      detail: 'Employees can use the assistant, but local model diagnostics are visible only to admins.',
      tone: 'blocked',
    }
  }
  if (!status) {
    return { label: 'Checking model', detail: 'Loading local LLM status…', tone: 'fallback' }
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
      detail: 'Local LLM is disabled, so Izge uses deterministic retrieval and answer assembly. Set IZGE_LOCAL_LLM_ENABLED=true and enable query routing/synthesis flags to use a local model.',
      tone: 'fallback',
    }
  }
  return {
    label: formatLabel(status.gateway_status),
    detail: status.error || `${status.configured_model} is configured at ${status.base_url}, but the gateway is not ready.`,
    tone: 'blocked',
  }
}

export function QueryPage() {
  const [searchParams] = useSearchParams()
  const { session } = useAuth()
  const promptFromUrl = searchParams.get('prompt')
  const storageKey = useMemo(() => chatStorageKey(session?.user.workspace_id, session?.user.user_id), [session?.user.user_id, session?.user.workspace_id])
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages(storageKey))
  const [queryDraftState, setQueryDraftState] = useState({ sourcePrompt: promptFromUrl, text: promptFromUrl || '' })
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null)
  const [activeTrace, setActiveTrace] = useState<QueryTraceRead | null>(null)
  const [activeStageRuns, setActiveStageRuns] = useState<OrchestrationStageRunRead[]>([])
  const [llmStatus, setLlmStatus] = useState<LocalLLMStatusRead | null>(null)
  const [llmStatusError, setLlmStatusError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const queryDraft = queryDraftState.sourcePrompt === promptFromUrl ? queryDraftState.text : promptFromUrl || queryDraftState.text

  const assistantMessages = useMemo(() => messages.filter((message) => message.role === 'assistant'), [messages])
  const activeAssistant = useMemo(
    () => assistantMessages.find((message) => message.id === activeAssistantId) ?? assistantMessages.at(-1) ?? null,
    [activeAssistantId, assistantMessages],
  )
  const llmCopy = llmStatusCopy(llmStatus, llmStatusError)

  useEffect(() => {
    persistStoredMessages(storageKey, messages)
  }, [messages, storageKey])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, isSubmitting])

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      if (!session?.token) {
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
          setLlmStatusError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load local model status.')
        }
      }
    }

    void loadStatus()

    return () => {
      cancelled = true
    }
  }, [session?.token])

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
          api.listOrchestrationStageRuns(session.token, 20, activeAssistant.queryRunId),
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

    setMessages((current) => [...current, userMessage])
    setQueryDraftState({ sourcePrompt: promptFromUrl, text: '' })
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await api.submitQuery(session.token, queryText)
      const assistantMessage = resultToAssistantMessage(result)
      setMessages((current) => [...current, assistantMessage])
      setActiveAssistantId(assistantMessage.id)
    } catch (caughtError) {
      setMessages((current) => current.filter((message) => message.id !== userMessage.id))
      setQueryDraftState({ sourcePrompt: promptFromUrl, text: trimmedQuestion })
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to submit chat message.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleClearChat() {
    setMessages([])
    setActiveAssistantId(null)
    setActiveTrace(null)
    setActiveStageRuns([])
    setError(null)
  }

  return (
    <div className="full-chat-page">
      <header className="assistant-topbar">
        <div>
          <p className="eyebrow">Company AI assistant</p>
          <h2 className="page-title">Ask permitted company knowledge</h2>
          <p className="page-description">
            Full-page employee chatbot with session continuity, permission-aware retrieval, evidence citations, and an oracle-style orchestration trace for each answer.
          </p>
        </div>
        <div className="assistant-status-row" aria-label="Assistant runtime status">
          <span className={`assistant-runtime-pill assistant-runtime-pill-${llmCopy.tone}`}>{llmCopy.label}</span>
          <button type="button" className="secondary-button" onClick={handleClearChat} disabled={messages.length === 0 || isSubmitting}>
            New chat
          </button>
        </div>
      </header>

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className="assistant-workspace">
        <aside className="assistant-sidebar panel-subtle" aria-label="Conversation controls">
          <div className="stack-md">
            <div>
              <p className="section-label">Session</p>
              <p className="table-primary">{messages.length} message{messages.length === 1 ? '' : 's'}</p>
              <p className="table-secondary">Stored locally in this browser; each backend query remains persisted as a query run.</p>
            </div>
            <div>
              <p className="section-label">Access model</p>
              <ul className="bullet-list compact-list">
                <li>Admins manage users, audit, storage, and review flows.</li>
                <li>Employees use the assistant and see only permitted evidence.</li>
                <li>Restricted artifacts stay out unless the signed-in user is granted access.</li>
              </ul>
            </div>
          </div>

          <div className="chat-starters assistant-starters">
            <p className="section-label">Starter prompts</p>
            {starterPrompts.slice(0, 5).map((prompt) => (
              <button key={prompt} type="button" className="prompt-card" onClick={() => setQueryDraftState({ sourcePrompt: promptFromUrl, text: prompt })}>
                {prompt}
              </button>
            ))}
          </div>
        </aside>

        <section className="assistant-main panel-subtle" aria-label="Assistant conversation">
          <div className="assistant-thread" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-empty-state assistant-empty-state panel-subtle">
                <p className="table-primary">Ask about company decisions, risks, or meeting follow-ups.</p>
                <p className="muted-copy">
                  Example: “What changed about self-serve onboarding after the April notes, and which artifacts support it?”
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={message.role === 'user' ? 'chat-message chat-message-user' : 'chat-message chat-message-assistant assistant-message-card'}
                >
                  <div className="chat-message-head">
                    <span className="section-label">{message.role === 'user' ? 'You' : 'Izge assistant'}</span>
                    <span className="table-secondary">{formatDateTime(message.createdAt)}</span>
                  </div>
                  <p className="chat-message-copy">{message.content}</p>

                  {message.role === 'assistant' ? (
                    <div className="chat-answer-meta">
                      <div className="inline-actions">
                        {message.queryClass ? <StatusBadge value={formatLabel(message.queryClass)} /> : null}
                        {message.permissionsLimited ? <StatusBadge value="Permission-limited" /> : null}
                        {message.queryRunId ? (
                          <button type="button" className="table-action-link inline-button-link" onClick={() => setActiveAssistantId(message.id)}>
                            Show trace
                          </button>
                        ) : null}
                        {message.queryRunId ? (
                          <Link className="table-action-link" to={`/query/${message.queryRunId}`}>
                            Full reasoning page
                          </Link>
                        ) : null}
                      </div>

                      {message.supportingEvidence && message.supportingEvidence.length > 0 ? (
                        <ol className="chat-citations">
                          {message.supportingEvidence.slice(0, 3).map((evidence) => (
                            <li key={`${message.id}-${evidence.artifact_id}-${evidence.chunk_id || evidence.excerpt.slice(0, 24)}`}>
                              <strong>{evidence.artifact_title}</strong>
                              <span>{evidence.excerpt}</span>
                            </li>
                          ))}
                        </ol>
                      ) : null}

                      {message.recommendedNextActions && message.recommendedNextActions.length > 0 ? (
                        <div className="assistant-next-actions">
                          <p className="section-label">Recommended next actions</p>
                          <ul className="bullet-list compact-list">
                            {message.recommendedNextActions.slice(0, 3).map((action) => (
                              <li key={action}>{action}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))
            )}

            {isSubmitting ? (
              <article className="chat-message chat-message-assistant chat-message-pending assistant-message-card">
                <div className="chat-message-head">
                  <span className="section-label">Oracle coordinator</span>
                  <span className="table-secondary">Spawning bounded checks…</span>
                </div>
                <p className="chat-message-copy">Retrieving permitted evidence, constructing graph context, then waiting for contradiction, drift, and guidance subagent packets.</p>
              </article>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          <form className="chat-composer assistant-composer" onSubmit={handleSubmit}>
            <label className="field field-block chat-input-field">
              <span className="field-label">Message Izge</span>
              <textarea
                className="chat-input"
                value={queryDraft}
                onChange={(event) => setQueryDraftState({ sourcePrompt: promptFromUrl, text: event.target.value })}
                rows={3}
                minLength={3}
                placeholder="Ask about permitted artifacts, decisions, contradictions, owners, meeting notes, or next actions…"
                required
              />
            </label>
            <button type="submit" className="primary-button chat-send-button" disabled={isSubmitting}>
              {isSubmitting ? 'Thinking…' : 'Send'}
            </button>
          </form>
        </section>

        <aside className="assistant-trace-rail panel-subtle" aria-label="Evidence and orchestration trace">
          <section className="assistant-rail-section">
            <p className="section-label">Runtime</p>
            <p className="table-primary">{llmCopy.label}</p>
            <p className="table-secondary">{llmCopy.detail}</p>
            {llmStatus ? (
              <dl className="meta-list compact-meta-list assistant-runtime-grid">
                <div>
                  <dt>Gateway</dt>
                  <dd>{formatLabel(llmStatus.gateway_status)}</dd>
                </div>
                <div>
                  <dt>Routing</dt>
                  <dd>{llmStatus.feature_flags.query_routing ? 'LLM' : 'Deterministic'}</dd>
                </div>
                <div>
                  <dt>Synthesis</dt>
                  <dd>{llmStatus.feature_flags.answer_synthesis ? 'LLM' : 'Deterministic'}</dd>
                </div>
              </dl>
            ) : null}
          </section>

          <section className="assistant-rail-section">
            <div className="timeline-card-head">
              <p className="section-label">Evidence</p>
              {activeAssistant?.queryClass ? <StatusBadge value={formatLabel(activeAssistant.queryClass)} /> : null}
            </div>
            {!activeAssistant ? <p className="muted-copy">Ask a question to see citations and trace packets.</p> : null}
            {activeAssistant?.supportingEvidence && activeAssistant.supportingEvidence.length > 0 ? (
              <div className="assistant-evidence-list">
                {activeAssistant.supportingEvidence.slice(0, 5).map((evidence) => (
                  <article key={`${evidence.artifact_id}-${evidence.chunk_id ?? evidence.excerpt.slice(0, 16)}`} className="panel-subtle stack-sm">
                    <p className="table-primary">{evidence.artifact_title}</p>
                    <p className="muted-copy">{evidence.excerpt}</p>
                    <div className="inline-actions">
                      <a className="table-action-link" href={api.artifactPreviewUrl(evidence.artifact_id)} target="_blank" rel="noreferrer">
                        Preview
                      </a>
                      <a className="table-action-link" href={api.artifactDownloadUrl(evidence.artifact_id)}>
                        Download
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          <section className="assistant-rail-section">
            <p className="section-label">Oracle-style orchestration</p>
            <p className="table-secondary">
              The main answer run fans out bounded subagent packets, waits for their summaries, then synthesizes only with permission-safe evidence.
            </p>
            <div className="orchestration-ledger">
              {activeStageRuns.length > 0
                ? activeStageRuns.map((run) => (
                    <article key={run.stage_run_id} className="orchestration-ledger-item">
                      <div>
                        <p className="table-primary">{stageTitle(run.stage_key)}</p>
                        <p className="table-secondary">
                          {formatLabel(run.status)} · {formatLabel(run.authority_level)} · {formatDateTime(run.created_at)}
                        </p>
                      </div>
                      {run.verifier_status ? <StatusBadge value={formatLabel(run.verifier_status)} /> : null}
                      <p className="muted-copy">{summarizeValue(run.output_summary)}</p>
                    </article>
                  ))
                : null}
              {activeTrace?.steps.map((step) => (
                <article key={`${step.step_kind}-${step.created_at}`} className="orchestration-ledger-item orchestration-ledger-item-muted">
                  <div>
                    <p className="table-primary">{traceStepTitle(step.step_kind)}</p>
                    <p className="table-secondary">{formatDateTime(step.created_at)}</p>
                  </div>
                  <p className="muted-copy">{summarizeValue(step.payload)}</p>
                </article>
              ))}
              {!activeTrace && activeStageRuns.length === 0 ? <p className="muted-copy">Select an assistant answer with a query run to inspect the trace.</p> : null}
            </div>
          </section>

          {activeTrace ? (
            <section className="assistant-rail-section">
              <p className="section-label">Route confidence</p>
              <p className="assistant-confidence-value">{formatPercent(activeTrace.route_confidence)}</p>
              <p className="table-secondary">{activeTrace.permissions_limited ? 'Permission-limited readback was active.' : 'No readback redaction was required for this user.'}</p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
