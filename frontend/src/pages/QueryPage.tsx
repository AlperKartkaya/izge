import { useEffect, useMemo, useState, type FormEventHandler } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { starterPrompts } from '../lib/demo'
import { formatDateTime } from '../lib/format'
import type { EvidenceReference, MemoryReference, QueryResult } from '../lib/types'

type ChatRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  queryRunId?: string
  queryClass?: string
  permissionsLimited?: boolean
  supportingEvidence?: EvidenceReference[]
  supportingNodes?: MemoryReference[]
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

  window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-24)))
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
    supportingEvidence: result.supporting_evidence,
    supportingNodes: result.supporting_nodes,
  }
}

export function QueryPage() {
  const [searchParams] = useSearchParams()
  const { session } = useAuth()
  const promptFromUrl = searchParams.get('prompt')
  const storageKey = useMemo(() => chatStorageKey(session?.user.workspace_id, session?.user.user_id), [session?.user.user_id, session?.user.workspace_id])
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages(storageKey))
  const [queryDraftState, setQueryDraftState] = useState({ sourcePrompt: promptFromUrl, text: promptFromUrl || '' })
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const queryDraft = queryDraftState.sourcePrompt === promptFromUrl ? queryDraftState.text : promptFromUrl || queryDraftState.text

  useEffect(() => {
    persistStoredMessages(storageKey, messages)
  }, [messages, storageKey])

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
      setMessages((current) => [...current, resultToAssistantMessage(result)])
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
    setError(null)
  }

  return (
    <div className="stack-xl chat-page">
      <PageIntro
        eyebrow="Company memory chat"
        title="Chat with permitted company knowledge"
        description="Employees can ask natural questions. Izge keeps this chat session locally, retrieves only artifacts visible to the signed-in user, and links every answer back to evidence."
        actions={
          <button type="button" className="secondary-button" onClick={handleClearChat} disabled={messages.length === 0 || isSubmitting}>
            Clear session
          </button>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className="chat-layout">
        <Panel title="Assistant" description="Session memory is stored in this browser for continuity. Backend retrieval still enforces artifact permissions for every answer.">
          <div className="chat-shell">
            <div className="chat-thread" aria-live="polite">
              {messages.length === 0 ? (
                <div className="chat-empty-state panel-subtle">
                  <p className="table-primary">Start with a company-memory question.</p>
                  <p className="muted-copy">Ask about decisions, assumptions, contradictions, owners, or what changed after a new document was ingested.</p>
                </div>
              ) : (
                messages.map((message) => (
                  <article key={message.id} className={message.role === 'user' ? 'chat-message chat-message-user' : 'chat-message chat-message-assistant'}>
                    <div className="chat-message-head">
                      <span className="section-label">{message.role === 'user' ? 'You' : 'Izge assistant'}</span>
                      <span className="table-secondary">{formatDateTime(message.createdAt)}</span>
                    </div>
                    <p className="chat-message-copy">{message.content}</p>

                    {message.role === 'assistant' ? (
                      <div className="chat-answer-meta">
                        <div className="inline-actions">
                          {message.queryClass ? <StatusBadge value={message.queryClass} /> : null}
                          {message.permissionsLimited ? <StatusBadge value="Permission-limited" /> : null}
                          {message.queryRunId ? (
                            <Link className="table-action-link" to={`/query/${message.queryRunId}`}>
                              Full reasoning
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
                        {message.supportingNodes && message.supportingNodes.length > 0 ? (
                          <p className="table-secondary">{message.supportingNodes.length} memory object{message.supportingNodes.length === 1 ? '' : 's'} referenced.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))
              )}

              {isSubmitting ? (
                <article className="chat-message chat-message-assistant chat-message-pending">
                  <div className="chat-message-head">
                    <span className="section-label">Izge assistant</span>
                    <span className="table-secondary">Retrieving permitted evidence…</span>
                  </div>
                  <p className="chat-message-copy">Checking visible artifacts, graph memory, contradictions, and next-action records.</p>
                </article>
              ) : null}
            </div>

            <form className="chat-composer" onSubmit={handleSubmit}>
              <label className="field field-block chat-input-field">
                <span className="field-label">Message</span>
                <textarea
                  className="chat-input"
                  value={queryDraft}
                  onChange={(event) => setQueryDraftState({ sourcePrompt: promptFromUrl, text: event.target.value })}
                  rows={4}
                  minLength={3}
                  placeholder="Ask Izge about permitted artifacts, decisions, contradictions, or next actions…"
                  required
                />
              </label>
              <button type="submit" className="primary-button chat-send-button" disabled={isSubmitting}>
                {isSubmitting ? 'Thinking…' : 'Send'}
              </button>
            </form>
          </div>
        </Panel>

        <aside className="stack-lg chat-side-panel">
          <Panel title="Starter questions" description="Click a prompt, adjust if needed, then send it to the assistant.">
            <div className="chat-starters">
              {starterPrompts.map((prompt) => (
                <button key={prompt} type="button" className="prompt-card" onClick={() => setQueryDraftState({ sourcePrompt: promptFromUrl, text: prompt })}>
                  {prompt}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Access model" description="The same chatbot surface works for admins and employees, but the answer set is role- and artifact-permission aware.">
            <ul className="bullet-list compact-list">
              <li>Admins can inspect audit, users, storage, and all artifacts.</li>
              <li>Employees see workspace artifacts plus restricted artifacts explicitly granted to them.</li>
              <li>Every answer is stored as a query run so full reasoning remains inspectable.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
