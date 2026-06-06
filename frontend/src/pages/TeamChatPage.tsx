import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEventHandler,
} from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { TeamChatMessageRead, UserRead } from '../lib/types'

interface ConversationSummary {
  id: string
  title: string
  description: string
  icon: string
  kind: 'channel' | 'direct'
  searchText: string
  lastMessage: TeamChatMessageRead | null
  messages: TeamChatMessageRead[]
}

const EMPLOYEE_DIRECTORY = [
  {
    handle: 'employee1',
    email: 'employee1@example.com',
    displayName: 'Employee 1',
    icon: 'E1',
  },
  {
    handle: 'employee2',
    email: 'employee2@example.com',
    displayName: 'Employee 2',
    icon: 'E2',
  },
  {
    handle: 'employee3',
    email: 'employee3@example.com',
    displayName: 'Employee 3',
    icon: 'E3',
  },
]

const DEFAULT_CHANNELS: ConversationSummary[] = [
  {
    id: 'company-general',
    title: 'Company General',
    description: 'Workspace updates',
    icon: 'CG',
    kind: 'channel',
    searchText: 'company general workspace updates',
    lastMessage: null,
    messages: [],
  },
  {
    id: 'product-rollout',
    title: 'Product Rollout',
    description: 'Launch and readiness work',
    icon: 'PR',
    kind: 'channel',
    searchText: 'product rollout launch readiness',
    lastMessage: null,
    messages: [],
  },
  {
    id: 'customer-success',
    title: 'Customer Success',
    description: 'Customer-facing follow-ups',
    icon: 'CS',
    kind: 'channel',
    searchText: 'customer success customer-facing follow-ups',
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

function employeeHandleForUser(user: UserRead | undefined): string | null {
  if (!user) {
    return null
  }
  const byEmail = EMPLOYEE_DIRECTORY.find(
    (employee) => employee.email === user.email.toLowerCase(),
  )
  if (byEmail) {
    return byEmail.handle
  }
  const normalizedName = user.display_name.toLowerCase().replace(/\s+/g, '')
  return (
    EMPLOYEE_DIRECTORY.find((employee) => employee.handle === normalizedName)
      ?.handle ?? null
  )
}

function directThreadId(leftHandle: string, rightHandle: string): string {
  return `direct:${[leftHandle, rightHandle].sort().join('-')}`
}

function directConversationTitle(
  threadId: string,
  currentUser: UserRead | undefined,
): string {
  const currentHandle = employeeHandleForUser(currentUser)
  const handles = threadId.replace(/^direct:/, '').split('-')
  const partnerHandle =
    handles.find((handle) => handle !== currentHandle) ?? handles[0]
  return (
    EMPLOYEE_DIRECTORY.find((employee) => employee.handle === partnerHandle)
      ?.displayName ?? threadId.replace(/^direct:/, '').replace(/-/g, ' / ')
  )
}

function directConversationIcon(
  threadId: string,
  currentUser: UserRead | undefined,
): string {
  const title = directConversationTitle(threadId, currentUser)
  return (
    EMPLOYEE_DIRECTORY.find((employee) => employee.displayName === title)
      ?.icon ?? initials(title)
  )
}

function defaultConversationsForUser(
  user: UserRead | undefined,
): ConversationSummary[] {
  const currentHandle = employeeHandleForUser(user)
  if (!currentHandle || user?.role === 'Admin') {
    return DEFAULT_CHANNELS.map((conversation) => ({
      ...conversation,
      messages: [],
      lastMessage: null,
    }))
  }

  return EMPLOYEE_DIRECTORY.filter(
    (employee) => employee.handle !== currentHandle,
  ).map((employee) => ({
    id: directThreadId(currentHandle, employee.handle),
    title: employee.displayName,
    description: 'Direct conversation',
    icon: employee.icon,
    kind: 'direct',
    searchText: `${employee.displayName} ${employee.handle} ${employee.email}`,
    lastMessage: null,
    messages: [],
  }))
}

function threadIdForMessage(message: TeamChatMessageRead) {
  return (
    metadataString(message, 'thread_id') ||
    metadataString(message, 'channel') ||
    'company-general'
  )
}

function threadTitleForMessage(message: TeamChatMessageRead, threadId: string) {
  return threadId.startsWith('direct:')
    ? directConversationTitle(threadId, undefined)
    : metadataString(message, 'thread_title') ||
        DEFAULT_CHANNELS.find((conversation) => conversation.id === threadId)
          ?.title ||
        threadId.replace(/[-:]/g, ' ')
}

function threadKindForMessage(
  message: TeamChatMessageRead,
): 'channel' | 'direct' {
  return metadataString(message, 'thread_kind') === 'direct' ||
    threadIdForMessage(message).startsWith('direct:')
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
  currentUser: UserRead | undefined,
): ConversationSummary[] {
  const conversations = new Map<string, ConversationSummary>()

  defaultConversationsForUser(currentUser).forEach((conversation) => {
    conversations.set(conversation.id, {
      ...conversation,
      messages: [],
      lastMessage: null,
    })
  })

  messages.forEach((message) => {
    const threadId = threadIdForMessage(message)
    const threadKind = threadKindForMessage(message)
    if (currentUser?.role !== 'Admin' && threadKind !== 'direct') {
      return
    }
    const existing = conversations.get(threadId)
    const title =
      existing?.title ||
      (threadId.startsWith('direct:')
        ? directConversationTitle(threadId, currentUser)
        : threadTitleForMessage(message, threadId))
    const nextMessages = [...(existing?.messages ?? []), message]
    conversations.set(threadId, {
      id: threadId,
      title,
      description:
        existing?.description ||
        (threadKind === 'direct'
          ? 'Direct conversation'
          : 'Conversation'),
      icon:
        existing?.icon ||
        (threadId.startsWith('direct:')
          ? directConversationIcon(threadId, currentUser)
          : initials(title)),
      kind: existing?.kind || threadKind,
      searchText: existing?.searchText || `${title} ${threadId}`,
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
      defaultConversationsForUser(currentUser).findIndex(
        (conversation) => conversation.id === left.id,
      ) -
      defaultConversationsForUser(currentUser).findIndex(
        (conversation) => conversation.id === right.id,
      )
    )
  })
}

function messageReceiptState(
  message: TeamChatMessageRead,
  messageIndex: number,
  messages: TeamChatMessageRead[],
  currentUserId: string | undefined,
): 'delivered' | 'seen' | null {
  if (!currentUserId || message.author_user_id !== currentUserId) {
    return null
  }

  const laterReply = messages
    .slice(messageIndex + 1)
    .some((nextMessage) => nextMessage.author_user_id !== currentUserId)
  return laterReply ? 'seen' : 'delivered'
}

export function TeamChatPage() {
  const { session } = useAuth()
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<TeamChatMessageRead[]>([])
  const [activeConversationId, setActiveConversationId] =
    useState('company-general')
  const [draft, setDraft] = useState('')
  const [conversationSearch, setConversationSearch] = useState('')
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

  const conversations = useMemo(
    () => buildConversations(messages, session?.user),
    [messages, session?.user],
  )
  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase()
    if (!query) {
      return conversations
    }
    return conversations.filter((conversation) =>
      `${conversation.title} ${conversation.description} ${conversation.searchText}`
        .toLowerCase()
        .includes(query),
    )
  }, [conversationSearch, conversations])
  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ??
      conversations[0] ??
      defaultConversationsForUser(session?.user)[0],
    [activeConversationId, conversations, session?.user],
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
        thread_kind: activeConversation.kind,
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
            <span className="conversation-count">
              {filteredConversations.length}
            </span>
          </div>
          <label className="field team-chat-search-field">
            <span className="field-label">Search employee</span>
            <input
              type="search"
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="employee1, employee2…"
            />
          </label>
          <div className="team-chat-conversation-list">
            {filteredConversations.length === 0 ? (
              <p className="muted-copy">No employee conversation found.</p>
            ) : null}
            {filteredConversations.map((conversation) => (
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
            {activeMessages.map((message, messageIndex) => {
              const isOwnMessage =
                message.author_user_id === session?.user.user_id
              const receiptState = messageReceiptState(
                message,
                messageIndex,
                activeMessages,
                session?.user.user_id,
              )
              return (
                <article
                  key={message.message_id}
                  className={
                    isOwnMessage
                      ? 'team-chat-message team-chat-message-own'
                      : 'team-chat-message'
                  }
                >
                  <p className="chat-message-copy">{message.body}</p>
                  <div className="message-bubble-meta">
                    <span>{formatDateTime(message.created_at)}</span>
                    {isOwnMessage && receiptState ? (
                      <span
                        className={`message-receipt message-receipt-${receiptState}`}
                        aria-label={receiptState === 'seen' ? 'Seen' : 'Delivered'}
                      >
                        ✓✓
                      </span>
                    ) : (
                      <span>{message.author_display_name}</span>
                    )}
                  </div>
                </article>
              )
            })}
            {isSending ? (
              <article className="team-chat-message team-chat-message-own chat-message-pending">
                <p className="chat-message-copy">{draft.trim()}</p>
                <div className="message-bubble-meta">
                  <span>Sending…</span>
                  <span className="message-receipt">✓</span>
                </div>
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
