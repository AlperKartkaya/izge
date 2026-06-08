import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEventHandler,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { TeamChatMessageRead, TeamChatTypingUserRead, UserRead } from '../lib/types'

interface ConversationSummary {
  id: string
  title: string
  description: string
  icon: string
  kind: ConversationKind
  searchText: string
  lastMessage: TeamChatMessageRead | null
  messages: TeamChatMessageRead[]
  participantHandles?: string[]
}

type ConversationKind = 'channel' | 'direct' | 'group'

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

const CHAT_HISTORY_SEED_VERSION = 'northstar-employee-assistant-v4'

function assistantThreadsStorageKey(
  workspaceId: string | undefined,
  userId: string | undefined,
) {
  return `izge-chat-threads:${workspaceId || 'workspace'}:${userId || 'user'}`
}

function assistantThreadsVersionStorageKey(
  workspaceId: string | undefined,
  userId: string | undefined,
) {
  return `izge-chat-threads-version:${workspaceId || 'workspace'}:${userId || 'user'}`
}

function importAssistantThreadForUser(
  currentUser: UserRead,
  snapshot: unknown,
  options: {
    joinSystemMessage?: string
    collaboration?: Record<string, unknown>
    fallbackUserAuthorDisplayName?: string
    fallbackUserAuthorId?: string
  } = {},
) {
  if (!snapshot || typeof snapshot !== 'object') {
    return false
  }
  const candidate = snapshot as Record<string, unknown>
  const rawMessages = Array.isArray(candidate.messages) ? candidate.messages : []
  const messages: Record<string, unknown>[] = rawMessages
    .filter(
      (message): message is Record<string, unknown> =>
        Boolean(
          message &&
            typeof message === 'object' &&
            typeof (message as Record<string, unknown>).content === 'string',
        ),
    )
    .map((message) => {
      const role = message.role === 'assistant' || message.role === 'system' ? message.role : 'user'
      return {
        ...message,
        role,
        authorDisplayName:
          typeof message.authorDisplayName === 'string'
            ? message.authorDisplayName
            : role === 'assistant'
              ? 'Izge'
              : role === 'user'
                ? options.fallbackUserAuthorDisplayName
                : undefined,
        authorUserId:
          typeof message.authorUserId === 'string'
            ? message.authorUserId
            : role === 'user'
              ? options.fallbackUserAuthorId
              : undefined,
      }
    })
  if (options.joinSystemMessage) {
    messages.push({
      id: `system-cowork-join-${String(options.collaboration?.sessionId ?? candidate.id ?? Date.now())}-${currentUser.user_id}`,
      role: 'system',
      content: options.joinSystemMessage,
      createdAt: new Date().toISOString(),
      systemKind: 'cowork_joined',
      authorDisplayName: 'System',
    })
  }
  const importedThread = {
    ...candidate,
    id:
      typeof candidate.id === 'string'
        ? candidate.id
        : `shared-${Date.now()}`,
    title:
      typeof candidate.title === 'string' && candidate.title.trim()
        ? candidate.title
        : 'Shared Izge chat',
    createdAt:
      typeof candidate.createdAt === 'string'
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
    collaboration:
      options.collaboration && typeof options.collaboration.sessionId === 'string'
        ? options.collaboration
        : candidate.collaboration,
  }
  const storageKey = assistantThreadsStorageKey(
    currentUser.workspace_id,
    currentUser.user_id,
  )
  const versionKey = assistantThreadsVersionStorageKey(
    currentUser.workspace_id,
    currentUser.user_id,
  )
  let existingThreads: unknown[] = []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    existingThreads = Array.isArray(parsed) ? parsed : []
  } catch {
    existingThreads = []
  }
  const remainingThreads = existingThreads.filter(
    (thread) =>
      !thread ||
      typeof thread !== 'object' ||
      (thread as Record<string, unknown>).id !== importedThread.id,
  )
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([importedThread, ...remainingThreads].slice(0, 16)),
  )
  window.localStorage.setItem(versionKey, CHAT_HISTORY_SEED_VERSION)
  return true
}

function assistantSnapshotTitle(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') {
    return 'Shared Izge chat'
  }
  const title = (snapshot as Record<string, unknown>).title
  return typeof title === 'string' && title.trim()
    ? title
    : 'Shared Izge chat'
}

function metadataString(
  message: TeamChatMessageRead,
  key: string,
): string | null {
  const value = message.message_metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metadataStringArray(
  message: TeamChatMessageRead,
  key: string,
): string[] {
  const value = message.message_metadata?.[key]
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : []
}

function employeeByHandle(handle: string | null | undefined) {
  return handle
    ? EMPLOYEE_DIRECTORY.find((employee) => employee.handle === handle)
    : undefined
}

function employeeByDisplayName(displayName: string | null | undefined) {
  return displayName
    ? EMPLOYEE_DIRECTORY.find((employee) => employee.displayName === displayName)
    : undefined
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

function directThreadIncludesUser(
  threadId: string,
  currentUser: UserRead | undefined,
) {
  const currentHandle = employeeHandleForUser(currentUser)
  if (!currentHandle || !threadId.startsWith('direct:')) {
    return false
  }
  return threadId.replace(/^direct:/, '').split('-').includes(currentHandle)
}

function groupThreadIncludesUser(
  participantHandles: string[] | undefined,
  currentUser: UserRead | undefined,
) {
  const currentHandle = employeeHandleForUser(currentUser)
  if (!currentHandle) {
    return false
  }
  return !participantHandles?.length || participantHandles.includes(currentHandle)
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

function groupConversationDescription(participantHandles: string[] | undefined) {
  if (!participantHandles?.length) {
    return 'Group conversation'
  }
  return participantHandles
    .map((handle) => employeeByHandle(handle)?.displayName ?? handle)
    .join(', ')
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
): ConversationKind {
  const metadataKind = metadataString(message, 'thread_kind')
  if (metadataKind === 'group' || threadIdForMessage(message).startsWith('group:')) {
    return 'group'
  }
  if (metadataKind === 'direct' || threadIdForMessage(message).startsWith('direct:')) {
    return 'direct'
  }
  return 'channel'
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
    const participantHandles = metadataStringArray(message, 'participant_handles')
    if (currentUser?.role !== 'Admin' && threadKind === 'channel') {
      return
    }
    if (
      currentUser?.role !== 'Admin' &&
      threadKind === 'direct' &&
      !directThreadIncludesUser(threadId, currentUser)
    ) {
      return
    }
    if (
      currentUser?.role !== 'Admin' &&
      threadKind === 'group' &&
      !groupThreadIncludesUser(participantHandles, currentUser)
    ) {
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
          : threadKind === 'group'
            ? groupConversationDescription(participantHandles)
          : 'Conversation'),
      icon:
        existing?.icon ||
        (threadId.startsWith('direct:')
          ? directConversationIcon(threadId, currentUser)
          : threadKind === 'group'
            ? 'GR'
            : initials(title)),
      kind: existing?.kind || threadKind,
      searchText: existing?.searchText || `${title} ${threadId}`,
      lastMessage: message,
      messages: nextMessages,
      participantHandles: existing?.participantHandles || participantHandles,
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

function messageAction(message: TeamChatMessageRead): string | null {
  const action = message.message_metadata?.action
  return typeof action === 'string' ? action : null
}

function isSystemMessage(message: TeamChatMessageRead) {
  return (
    message.message_metadata?.system_event === true ||
    messageAction(message) === 'assistant_cowork_accept' ||
    messageAction(message) === 'group_created'
  )
}

function assistantJoinSystemCopy(
  message: TeamChatMessageRead,
  currentUserId: string | undefined,
) {
  const actorUserId =
    typeof message.message_metadata?.actor_user_id === 'string'
      ? message.message_metadata.actor_user_id
      : message.author_user_id
  const actorName =
    typeof message.message_metadata?.actor_display_name === 'string'
      ? message.message_metadata.actor_display_name
      : message.author_display_name
  if (actorUserId === currentUserId) {
    return 'You entered the shared chat.'
  }
  return `${actorName} entered the shared chat.`
}

function systemMessageCopy(
  message: TeamChatMessageRead,
  currentUserId: string | undefined,
) {
  if (messageAction(message) === 'assistant_cowork_accept') {
    return assistantJoinSystemCopy(message, currentUserId)
  }
  if (messageAction(message) === 'group_created') {
    return message.author_user_id === currentUserId
      ? `You created ${metadataString(message, 'thread_title') ?? 'this group'}.`
      : message.body
  }
  return message.body
}

function conversationPreview(message: TeamChatMessageRead) {
  if (messageAction(message) === 'assistant_cowork_accept') {
    return 'Entered shared assistant chat'
  }
  if (messageAction(message) === 'assistant_chat_share') {
    return `Assistant chat: ${assistantSnapshotTitle(message.message_metadata?.assistant_thread_snapshot)}`
  }
  if (messageAction(message) === 'assistant_cowork_invite') {
    return `Cowork proposal: ${assistantSnapshotTitle(message.message_metadata?.assistant_thread_snapshot)}`
  }
  return message.body
}

export function TeamChatPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const lastTypingSentAtRef = useRef(0)
  const [messages, setMessages] = useState<TeamChatMessageRead[]>([])
  const [activeConversationId, setActiveConversationId] =
    useState('company-general')
  const [draft, setDraft] = useState('')
  const [conversationSearch, setConversationSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<TeamChatTypingUserRead[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isGroupComposerOpen, setIsGroupComposerOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedGroupHandles, setSelectedGroupHandles] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false

    async function loadThread(showLoading = false) {
      if (!session?.token) {
        return
      }

      if (showLoading) {
        setIsLoading(true)
      }
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
        if (!cancelled && showLoading) {
          setIsLoading(false)
        }
      }
    }

    void loadThread(true)
    const interval = window.setInterval(() => void loadThread(false), 3600)

    return () => {
      cancelled = true
      window.clearInterval(interval)
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
  const currentEmployeeHandle = employeeHandleForUser(session?.user)
  const groupParticipantOptions = EMPLOYEE_DIRECTORY.filter(
    (employee) => employee.handle !== currentEmployeeHandle,
  )

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [activeConversationId, activeMessages.length, isSending])

  useEffect(() => {
    if (!session?.token || !activeConversation.id) {
      queueMicrotask(() => setTypingUsers([]))
      return
    }

    let cancelled = false
    async function loadTyping() {
      if (!session?.token) {
        return
      }
      try {
        const payload = await api.listTeamChatTyping(
          session.token,
          activeConversation.id,
          activeConversation.kind,
        )
        if (!cancelled) {
          setTypingUsers(payload.typing)
        }
      } catch {
        if (!cancelled) {
          setTypingUsers([])
        }
      }
    }

    void loadTyping()
    const interval = window.setInterval(() => void loadTyping(), 1800)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeConversation.id, activeConversation.kind, session?.token])

  useEffect(() => {
    if (!session?.token || !draft.trim()) {
      return
    }
    const now = Date.now()
    if (now - lastTypingSentAtRef.current < 2200) {
      return
    }
    lastTypingSentAtRef.current = now
    void api.markTeamChatTyping(
      session.token,
      activeConversation.id,
      activeConversation.kind,
    )
  }, [activeConversation.id, activeConversation.kind, draft, session?.token])

  async function handleAssistantThreadAction(message: TeamChatMessageRead) {
    if (!session?.user || !session.token) {
      return
    }
    const snapshot = message.message_metadata?.assistant_thread_snapshot
    const collabSessionId =
      typeof message.message_metadata?.collab_session_id === 'string'
        ? message.message_metadata.collab_session_id
        : null
    const imported = importAssistantThreadForUser(session.user, snapshot, {
      joinSystemMessage:
        messageAction(message) === 'assistant_cowork_invite'
          ? 'You entered the shared chat.'
          : undefined,
      collaboration:
        messageAction(message) === 'assistant_cowork_invite' && collabSessionId
          ? {
              sessionId: collabSessionId,
              threadId: activeConversation.id,
              threadTitle: activeConversation.title,
              participants: [
                message.author_user_id,
                session.user.user_id,
              ].filter(Boolean),
            }
          : undefined,
      fallbackUserAuthorDisplayName: message.author_display_name,
      fallbackUserAuthorId: message.author_user_id,
    })
    if (!imported) {
      setError('This assistant handoff does not include a readable chat.')
      return
    }
    if (message.message_metadata?.action === 'assistant_cowork_invite') {
      try {
        const created = await api.createTeamChatMessage(
          session.token,
          `${session.user.display_name} entered the shared chat.`,
          {
            thread_id: activeConversation.id,
            thread_title: activeConversation.title,
            thread_kind: activeConversation.kind,
            message_metadata: {
              action: 'assistant_cowork_accept',
              system_event: true,
              system_event_type: 'assistant_cowork_joined',
              actor_user_id: session.user.user_id,
              actor_display_name: session.user.display_name,
              collab_session_id: collabSessionId,
              assistant_thread_snapshot: snapshot,
            },
          },
        )
        setMessages((current) => [...current, created])
      } catch {
        // Import already succeeded; posting acceptance is a best-effort signal.
      }
    }
    navigate('/query')
  }

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
        message_metadata:
          activeConversation.kind === 'group'
            ? {
                participant_handles:
                  activeConversation.participantHandles ??
                  selectedGroupHandles,
              }
            : undefined,
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

  function toggleGroupParticipant(handle: string) {
    setSelectedGroupHandles((current) =>
      current.includes(handle)
        ? current.filter((candidate) => candidate !== handle)
        : [...current, handle],
    )
  }

  const handleCreateGroup: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token || !session.user || !currentEmployeeHandle) {
      return
    }
    const title = groupName.trim()
    const participantHandles = Array.from(
      new Set([currentEmployeeHandle, ...selectedGroupHandles]),
    )
    if (!title || participantHandles.length < 2) {
      setError('Choose a group name and at least one colleague.')
      return
    }
    const threadId = `group:${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 54)}-${Date.now().toString(36)}`
    setIsSending(true)
    setError(null)
    try {
      const created = await api.createTeamChatMessage(
        session.token,
        `${session.user.display_name} created ${title}.`,
        {
          thread_id: threadId,
          thread_title: title,
          thread_kind: 'group',
          message_metadata: {
            action: 'group_created',
            system_event: true,
            system_event_type: 'group_created',
            participant_handles: participantHandles,
          },
        },
      )
      setMessages((current) => [...current, created])
      setActiveConversationId(threadId)
      setGroupName('')
      setSelectedGroupHandles([])
      setIsGroupComposerOpen(false)
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : 'Unable to create group.',
      )
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="full-chat-page team-chat-product-page">
      <header className="assistant-topbar team-chat-topbar team-chat-topbar-compact" />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="team-chat-app" aria-label="Employee conversations">
        <aside
          className="team-chat-conversations panel-subtle"
          aria-label="Conversation list"
        >
          <div className="team-chat-conversations-head">
            <p className="section-label">Conversations</p>
            <span className="team-chat-head-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Create a group chat"
                onClick={() => setIsGroupComposerOpen((current) => !current)}
              >
                +
              </button>
              <span className="conversation-count">
                {filteredConversations.length}
              </span>
            </span>
          </div>
          <label className="field team-chat-search-field">
            <span className="field-label">Search chats</span>
            <input
              type="search"
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="employee1, launch room…"
            />
          </label>
          {isGroupComposerOpen ? (
            <form className="team-chat-group-form" onSubmit={handleCreateGroup}>
              <label className="field">
                <span className="field-label">Group name</span>
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="e.g. Launch handoff"
                  maxLength={80}
                />
              </label>
              <fieldset className="team-chat-group-people">
                <legend className="field-label">Add colleagues</legend>
                {groupParticipantOptions.map((employee) => (
                  <label key={employee.handle} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedGroupHandles.includes(employee.handle)}
                      onChange={() => toggleGroupParticipant(employee.handle)}
                    />
                    <span>{employee.displayName}</span>
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                className="secondary-button"
                disabled={isSending}
              >
                Create group
              </button>
            </form>
          ) : null}
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
                      ? conversationPreview(conversation.lastMessage)
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
                  : activeConversation.kind === 'group'
                    ? 'Group chat'
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
              if (isSystemMessage(message)) {
                return (
                  <article
                    key={message.message_id}
                    className="team-chat-system-message"
                  >
                    <span>{systemMessageCopy(message, session?.user.user_id)}</span>
                  </article>
                )
              }
              const receiptState = messageReceiptState(
                message,
                messageIndex,
                activeMessages,
                session?.user.user_id,
              )
              const senderAvatar =
                employeeByDisplayName(message.author_display_name)?.icon ??
                initials(message.author_display_name)
              return (
                <div
                  key={message.message_id}
                  className={
                    isOwnMessage
                      ? 'team-chat-message-row team-chat-message-row-own'
                      : 'team-chat-message-row'
                  }
                >
                  {!isOwnMessage ? (
                    <span
                      className="team-chat-message-avatar"
                      title={message.author_display_name}
                      aria-hidden="true"
                    >
                      {senderAvatar}
                    </span>
                  ) : null}
                  <article
                    className={
                      isOwnMessage
                        ? 'team-chat-message team-chat-message-own'
                        : 'team-chat-message'
                    }
                  >
                    <p className="chat-message-copy">{message.body}</p>
                    {messageAction(message) === 'assistant_chat_share' ||
                    messageAction(message) === 'assistant_cowork_invite' ? (
                      <div className="team-chat-assistant-card">
                        <span>
                          {messageAction(message) === 'assistant_cowork_invite'
                            ? 'Cowork proposal'
                            : 'Assistant chat'}
                        </span>
                        <strong>
                          {assistantSnapshotTitle(
                            message.message_metadata?.assistant_thread_snapshot,
                          )}
                        </strong>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            void handleAssistantThreadAction(message)
                          }
                        >
                          {messageAction(message) === 'assistant_cowork_invite'
                            ? 'Accept and open'
                            : 'Open in assistant'}
                        </button>
                      </div>
                    ) : null}
                    <div className="message-bubble-meta">
                      <span>{formatDateTime(message.created_at)}</span>
                      {isOwnMessage && receiptState ? (
                        <span
                          className={`message-receipt message-receipt-${receiptState}`}
                          aria-label={receiptState === 'seen' ? 'Seen' : 'Delivered'}
                        >
                          ✓✓
                        </span>
                      ) : null}
                    </div>
                  </article>
                </div>
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
            {typingUsers.length > 0 ? (
              <article className="team-chat-typing-row">
                <span className="typing-pen" aria-hidden="true">
                  ✎
                </span>
                <span>
                  {typingUsers.map((user) => user.display_name).join(', ')}{' '}
                  writing…
                </span>
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
