import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEventHandler,
} from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { TeamChatMessageRead } from '../lib/types'

interface ConversationSummary {
  id: string
  title: string
  description: string
  icon: string
  kind: 'channel' | 'direct'
  lastMessage: TeamChatMessageRead | null
  messages: TeamChatMessageRead[]
}

const DEFAULT_CONVERSATIONS: ConversationSummary[] = [
  {
    id: 'company-general',
    title: 'Company General',
    description: 'Workspace updates',
    icon: 'CG',
    kind: 'channel',
    lastMessage: null,
    messages: [],
  },
  {
    id: 'product-rollout',
    title: 'Product Rollout',
    description: 'Launch and readiness work',
    icon: 'PR',
    kind: 'channel',
    lastMessage: null,
    messages: [],
  },
  {
    id: 'direct:employee1-employee2',
    title: 'Employee 1 / Employee 2',
    description: 'Direct conversation',
    icon: 'E1',
    kind: 'direct',
    lastMessage: null,
    messages: [],
  },
  {
    id: 'customer-success',
    title: 'Customer Success',
    description: 'Customer-facing follow-ups',
    icon: 'CS',
    kind: 'channel',
    lastMessage: null,
    messages: [],
  },
]

function roleLabel(role: TeamChatMessageRead['author_role']) {
  return role === 'Admin' ? 'Admin' : 'Employee'
}

function metadataString(
  message: TeamChatMessageRead,
  key: string,
): string | null {
  const value = message.message_metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function threadIdForMessage(message: TeamChatMessageRead) {
  return (
    metadataString(message, 'thread_id') ||
    metadataString(message, 'channel') ||
    'company-general'
  )
}

function threadTitleForMessage(message: TeamChatMessageRead, threadId: string) {
  return (
    metadataString(message, 'thread_title') ||
    DEFAULT_CONVERSATIONS.find((conversation) => conversation.id === threadId)
      ?.title ||
    threadId.replace(/[-:]/g, ' ')
  )
}

function threadKindForMessage(
  message: TeamChatMessageRead,
): 'channel' | 'direct' {
  return metadataString(message, 'thread_kind') === 'direct'
    ? 'direct'
    : 'channel'
}

function initials(value: string) {
  const words = value.split(/\s+|\//).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
}

function buildConversations(
  messages: TeamChatMessageRead[],
): ConversationSummary[] {
  const conversations = new Map<string, ConversationSummary>()

  DEFAULT_CONVERSATIONS.forEach((conversation) => {
    conversations.set(conversation.id, {
      ...conversation,
      messages: [],
      lastMessage: null,
    })
  })

  messages.forEach((message) => {
    const threadId = threadIdForMessage(message)
    const existing = conversations.get(threadId)
    const title = existing?.title || threadTitleForMessage(message, threadId)
    const nextMessages = [...(existing?.messages ?? []), message]
    conversations.set(threadId, {
      id: threadId,
      title,
      description:
        existing?.description ||
        (threadKindForMessage(message) === 'direct'
          ? 'Direct conversation'
          : 'Conversation'),
      icon: existing?.icon || initials(title),
      kind: existing?.kind || threadKindForMessage(message),
      lastMessage: message,
      messages: nextMessages,
    })
  })

  return Array.from(conversations.values()).sort((left, right) => {
    const leftTime = left.lastMessage
      ? Date.parse(left.lastMessage.created_at)
      : 0
    const rightTime = right.lastMessage
      ? Date.parse(right.lastMessage.created_at)
      : 0
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }
    return (
      DEFAULT_CONVERSATIONS.findIndex(
        (conversation) => conversation.id === left.id,
      ) -
      DEFAULT_CONVERSATIONS.findIndex(
        (conversation) => conversation.id === right.id,
      )
    )
  })
}

export function TeamChatPage() {
  const { session } = useAuth()
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<TeamChatMessageRead[]>([])
  const [activeConversationId, setActiveConversationId] =
    useState('company-general')
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
        const payload = await api.listTeamChatMessages(session.token, 160)
        if (!cancelled) {
          setMessages(payload.messages)
          setError(null)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof ApiError
              ? caughtError.message
              : 'Unable to load team chat.',
          )
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

  const conversations = useMemo(() => buildConversations(messages), [messages])
  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ??
      conversations[0] ??
      DEFAULT_CONVERSATIONS[0],
    [activeConversationId, conversations],
  )
  const activeMessages = activeConversation.messages

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [activeConversationId, activeMessages.length, isSending])

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
      const created = await api.createTeamChatMessage(session.token, trimmed, {
        thread_id: activeConversation.id,
        thread_title: activeConversation.title,
      })
      setMessages((current) => [...current, created])
      setDraft('')
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : 'Unable to send team chat message.',
      )
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="full-chat-page team-chat-product-page">
      <header className="assistant-topbar team-chat-topbar">
        <div>
          <p className="eyebrow">Team chat</p>
          <h2 className="page-title">Messages</h2>
        </div>
        <div
          className="team-chat-presence panel-subtle"
          aria-label="Current chat identity"
        >
          <span
            className="conversation-avatar conversation-avatar-small"
            aria-hidden="true"
          >
            {initials(session?.user.display_name || 'ME')}
          </span>
          <span>
            <span className="table-primary">{session?.user.display_name}</span>
            <span className="table-secondary">
              {roleLabel(session?.user.role ?? 'Member')}
            </span>
          </span>
        </div>
      </header>

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="team-chat-app" aria-label="Employee conversations">
        <aside
          className="team-chat-conversations panel-subtle"
          aria-label="Conversation list"
        >
          <div className="team-chat-conversations-head">
            <p className="section-label">Conversations</p>
            <span className="conversation-count">{conversations.length}</span>
          </div>
          <div className="team-chat-conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={
                  conversation.id === activeConversation.id
                    ? 'conversation-button conversation-button-active'
                    : 'conversation-button'
                }
                onClick={() => setActiveConversationId(conversation.id)}
              >
                <span className="conversation-avatar" aria-hidden="true">
                  {conversation.icon}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-title-row">
                    <strong>{conversation.title}</strong>
                    <small>
                      {conversation.lastMessage
                        ? formatDateTime(conversation.lastMessage.created_at)
                        : ''}
                    </small>
                  </span>
                  <span className="conversation-preview">
                    {conversation.lastMessage
                      ? conversation.lastMessage.body
                      : conversation.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section
          className="team-chat-room panel-subtle"
          aria-label={`${activeConversation.title} conversation`}
        >
          <header className="team-chat-room-header">
            <span className="conversation-avatar" aria-hidden="true">
              {activeConversation.icon}
            </span>
            <span>
              <span className="table-primary">{activeConversation.title}</span>
              <span className="table-secondary">
                {activeConversation.kind === 'direct'
                  ? 'Direct conversation'
                  : 'Channel'}{' '}
                · {activeMessages.length} message
                {activeMessages.length === 1 ? '' : 's'}
              </span>
            </span>
          </header>

          <div className="team-chat-thread" aria-live="polite">
            {isLoading ? <p className="muted-copy">Loading messages…</p> : null}
            {!isLoading && activeMessages.length === 0 ? (
              <EmptyState
                title="No messages yet"
                description="Start the conversation."
              />
            ) : null}
            {activeMessages.map((message) => {
              const isOwnMessage =
                message.author_user_id === session?.user.user_id
              return (
                <article
                  key={message.message_id}
                  className={
                    isOwnMessage
                      ? 'team-chat-message team-chat-message-own'
                      : 'team-chat-message'
                  }
                >
                  <div className="chat-message-head">
                    <div>
                      <p className="table-primary">
                        {message.author_display_name}
                      </p>
                      <p className="table-secondary">
                        {formatDateTime(message.created_at)}
                      </p>
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
              <span className="field-label">
                Message {activeConversation.title}
              </span>
              <textarea
                className="chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Write a message…"
              />
            </label>
            <button
              type="submit"
              className="primary-button chat-send-button"
              disabled={isSending}
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </section>
      </section>
    </div>
  )
}
