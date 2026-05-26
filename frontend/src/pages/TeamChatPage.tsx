import { useEffect, useRef, useState, type FormEventHandler } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { TeamChatMessageRead } from '../lib/types'

function roleLabel(role: TeamChatMessageRead['author_role']) {
  return role === 'Admin' ? 'Admin' : 'Employee'
}

export function TeamChatPage() {
  const { session } = useAuth()
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<TeamChatMessageRead[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadThread() {
      if (!session?.token) {
        return
      }

      setIsLoading(true)
      try {
        const payload = await api.listTeamChatMessages(session.token, 120)
        if (!cancelled) {
          setMessages(payload.messages)
          setError(null)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load team chat.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadThread()

    return () => {
      cancelled = true
    }
  }, [session?.token])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, isSending])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token) {
      return
    }

    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Write a message before sending it.')
      return
    }

    setIsSending(true)
    setError(null)
    try {
      const created = await api.createTeamChatMessage(session.token, trimmed)
      setMessages((current) => [...current, created])
      setDraft('')
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to send team chat message.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="stack-xl team-chat-page">
      <div className="page-intro compact-page-intro">
        <div>
          <p className="eyebrow">Internal employee chat</p>
          <h2 className="page-title">Coordinate around company artifacts</h2>
          <p className="page-description">
            A workspace-wide employee channel for rollout notes, document review, and handoffs. Messages are stored in the same database and audited like other company operations.
          </p>
        </div>
        <div className="team-chat-presence panel-subtle" aria-label="Current chat identity">
          <p className="section-label">Signed in as</p>
          <p className="table-primary">{session?.user.display_name}</p>
          <p className="table-secondary">{roleLabel(session?.user.role ?? 'Member')} access</p>
        </div>
      </div>

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <Panel
        title="Company-general"
        description="Use this for employee-to-employee coordination. Ask Izge in the assistant page when you need evidence-grounded answers from artifacts."
      >
        <div className="team-chat-shell">
          <div className="team-chat-thread" aria-live="polite">
            {isLoading ? <p className="muted-copy">Loading company chat…</p> : null}
            {!isLoading && messages.length === 0 ? (
              <EmptyState title="No messages yet" description="Start the first company conversation about a document, meeting note, or rollout decision." />
            ) : null}
            {messages.map((message) => {
              const isOwnMessage = message.author_user_id === session?.user.user_id
              return (
                <article key={message.message_id} className={isOwnMessage ? 'team-chat-message team-chat-message-own' : 'team-chat-message'}>
                  <div className="chat-message-head">
                    <div>
                      <p className="table-primary">{message.author_display_name}</p>
                      <p className="table-secondary">{formatDateTime(message.created_at)}</p>
                    </div>
                    <StatusBadge value={roleLabel(message.author_role)} />
                  </div>
                  <p className="chat-message-copy">{message.body}</p>
                </article>
              )
            })}
            {isSending ? (
              <article className="team-chat-message team-chat-message-own chat-message-pending">
                <div className="chat-message-head">
                  <p className="table-primary">{session?.user.display_name}</p>
                  <p className="table-secondary">Sending…</p>
                </div>
                <p className="chat-message-copy">{draft.trim()}</p>
              </article>
            ) : null}
            <div ref={threadEndRef} />
          </div>

          <form className="team-chat-composer" onSubmit={handleSubmit}>
            <label className="field field-block chat-input-field">
              <span className="field-label">Message everyone</span>
              <textarea
                className="chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Share a rollout update, ask a teammate to review an artifact, or capture a meeting follow-up…"
              />
            </label>
            <button type="submit" className="primary-button chat-send-button" disabled={isSending}>
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      </Panel>
    </div>
  )
}
