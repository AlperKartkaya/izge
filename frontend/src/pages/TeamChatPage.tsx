import { ButtonIcon } from '../components/ButtonIcon'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AgentAnswer, AgentText, ChatComposer, LoadingState, ThinkingState } from '../components/AgentPrimitives'
import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { useChatScroll } from '../components/useChatScroll'
import { Callout, EmptyState } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { buildIzgeFollowUp, focusComposerAtEnd } from '../lib/agentText'
import { formatDateTime } from '../lib/format'
import { useLanguage } from '../lib/i18n'
import type { AgentRunRead, AgentSourceRead, TeamChatMessageRead, UserRead } from '../lib/types'

type ConversationKind = 'channel' | 'direct' | 'group'
interface Conversation { id: string; title: string; kind: ConversationKind; participantUserIds: string[] }
interface ChatAttachment { artifact_id: string; title: string; filename: string; mime_type: string }
const izgeMentionPattern = /(^|\s)@[iİı]zge\b/i

function metadataString(message: TeamChatMessageRead, key: string) {
  const value = message.message_metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}
function metadataStrings(message: TeamChatMessageRead, key: string) {
  const value = message.message_metadata?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
function messageThreadId(message: TeamChatMessageRead) { return metadataString(message, 'thread_id') ?? 'company-general' }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toLocaleUpperCase('tr-TR') }
function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError && error.message ? error.message : fallback }

export function TeamChatPage() {
  const { session } = useAuth()
  const { language, t } = useLanguage()
  const [searchParams] = useSearchParams()
  const [messages, setMessages] = useState<TeamChatMessageRead[]>([])
  const [colleagues, setColleagues] = useState<UserRead[]>([])
  const [activeId, setActiveId] = useState(searchParams.get('thread') ?? 'izge-colleague')
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const dataRevision = useRef(0)
  const [agentRuns, setAgentRuns] = useState<AgentRunRead[]>([])
  const [streamedTextByRun, setStreamedTextByRun] = useState<Record<string, string>>({})
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [showDirectForm, setShowDirectForm] = useState(false)
  const [directUserId, setDirectUserId] = useState('')
  const [startedConversations, setStartedConversations] = useState<Conversation[]>([])
  const [groupName, setGroupName] = useState('')
  const [groupParticipants, setGroupParticipants] = useState<string[]>([])
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    let inFlight = false
    async function load(showLoading = false) {
      if (inFlight) return
      inFlight = true
      const revision = dataRevision.current
      if (showLoading && !cancelled) setIsLoading(true)
      try {
        const [thread, directory, runs] = await Promise.all([api.listTeamChatMessages(session!.token, 240), api.listColleagues(session!.token), api.listAgentRuns(session!.token)])
        // A stale poll must not overwrite a newer send or agent update.
        if (!cancelled && revision === dataRevision.current) {
          setMessages(thread.messages)
          setColleagues(directory.filter((user) => user.user_id !== session!.user.user_id))
          setAgentRuns(runs.filter((run) => run.kind === 'ask'))
          setLoadError(null)
        }
      } catch (caughtError) { if (!cancelled) setLoadError(errorMessage(caughtError, t('Team chat could not be loaded.', 'Ekip sohbeti yüklenemedi.'))) }
      finally { inFlight = false; if (showLoading && !cancelled) setIsLoading(false) }
    }
    void load(true)
    const timer = window.setInterval(() => void load(), 4000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [session, t])

  const pendingRun = agentRuns.find((run) => run.thread_id === activeId && (run.status === 'queued' || run.status === 'running')) ?? null
  const latestThreadRun = agentRuns.find((run) => run.thread_id === activeId) ?? null

  useEffect(() => {
    const runId = pendingRun?.run_id
    if (!runId || !session?.token) return
    const events = new EventSource(api.agentRunEventsUrl(runId), { withCredentials: true })
    const refresh = async () => {
      try {
        const run = await api.getAgentRun(session.token, runId)
        dataRevision.current += 1
        setAgentRuns((current) => [run, ...current.filter((item) => item.run_id !== run.run_id)])
        if (run.status === 'completed' || run.status === 'failed') {
          events.close()
          const thread = await api.listTeamChatMessages(session.token, 240)
          dataRevision.current += 1
          setMessages(thread.messages)
        }
      } catch (caughtError) { setError(errorMessage(caughtError, t("Izge's work status could not be retrieved.", 'İzge’nin çalışma durumu alınamadı.'))) }
    }
    events.addEventListener('delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { text?: string }
      if (payload.text) setStreamedTextByRun((current) => ({ ...current, [runId]: (current[runId] ?? '') + payload.text }))
    })
    events.addEventListener('reset', () => setStreamedTextByRun((current) => ({ ...current, [runId]: '' })))
    for (const name of ['stage', 'source', 'done', 'failed']) events.addEventListener(name, () => void refresh())
    events.onerror = () => { events.close(); void refresh() }
    return () => events.close()
  }, [pendingRun?.run_id, session, t])

  const conversations = useMemo(() => {
    const values = new Map<string, Conversation>()
    values.set('izge-colleague', { id: 'izge-colleague', title: 'İzge', kind: 'direct', participantUserIds: session ? [session.user.user_id] : [] })
    values.set('company-general', { id: 'company-general', title: t('Company-wide', 'Şirket geneli'), kind: 'channel', participantUserIds: session ? [session.user.user_id, ...colleagues.map((user) => user.user_id)] : [] })
    for (const conversation of startedConversations) values.set(conversation.id, conversation)
    for (const message of messages) {
      const id = messageThreadId(message)
      if (!values.has(id)) values.set(id, { id, title: metadataString(message, 'thread_title') ?? t('Team conversation', 'Ekip konuşması'), kind: (metadataString(message, 'thread_kind') as ConversationKind) ?? 'group', participantUserIds: metadataStrings(message, 'participant_user_ids') })
    }
    return Array.from(values.values())
  }, [colleagues, messages, session, startedConversations, t])
  const locale = language === 'en' ? 'en-GB' : 'tr-TR'
  const filteredConversations = conversations.filter((conversation) => conversation.title.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)))
  const active = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0]
  const activeMessages = messages.filter((message) => messageThreadId(message) === active?.id)

  const { ref: messagesRef, onScroll: handleMessageScroll, followLatest } = useChatScroll(activeId, JSON.stringify(activeMessages.map((message) => [message.message_id, message.body])) + (pendingRun ? `${pendingRun.run_id}:${pendingRun.stages.length}:${streamedTextByRun[pendingRun.run_id] ?? ''}` : ''))

  async function submit() {
    if (!session?.token || !active || !draft.trim() || isSending || pendingRun) return
    const body = draft.trim()
    followLatest()
    const invokesAgent = active.id === 'izge-colleague' || izgeMentionPattern.test(body)
    setDraft('')
    setIsSending(true)
    setError(null)
    try {
      if (invokesAgent) {
        const created = await api.askColleague(session.token, {
          message: body,
          client_request_id: crypto.randomUUID(),
          thread_id: active.id,
          thread_title: active.title,
          thread_kind: active.kind,
          participant_user_ids: active.participantUserIds,
        })
        const run = await api.getAgentRun(session.token, created.run_id)
        dataRevision.current += 1
        setAgentRuns((current) => [run, ...current.filter((item) => item.run_id !== run.run_id)])
        setStreamedTextByRun((current) => ({ ...current, [run.run_id]: '' }))
        const thread = await api.listTeamChatMessages(session.token, 240)
        dataRevision.current += 1
        setMessages(thread.messages)
      } else {
        const created = await api.createTeamChatMessage(session.token, body, {
          thread_id: active.id,
          thread_title: active.title,
          thread_kind: active.kind,
          message_metadata: { participant_user_ids: active.participantUserIds },
        })
        dataRevision.current += 1
        setMessages((current) => [...current, created])
      }
    } catch (caughtError) {
      setDraft(body)
      setError(errorMessage(caughtError, t('Message could not be sent.', 'Mesaj gönderilemedi.')))
    } finally { setIsSending(false) }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session?.token || !groupName.trim() || groupParticipants.length === 0 || isSending) return
    const participantUserIds = Array.from(new Set([session.user.user_id, ...groupParticipants]))
    const threadId = `group:${crypto.randomUUID()}`
    setIsSending(true)
    setError(null)
    try {
      const created = await api.createTeamChatMessage(session.token, t(`${session.user.display_name} created the group.`, `${session.user.display_name} grubu oluşturdu.`), {
        thread_id: threadId,
        thread_title: groupName.trim(),
        thread_kind: 'group',
        message_metadata: { participant_user_ids: participantUserIds, system_event: true, action: 'group_created' },
      })
      dataRevision.current += 1
      setMessages((current) => [...current, created])
      setActiveId(threadId)
      setGroupName('')
      setGroupParticipants([])
      setShowGroupForm(false)
    } catch (caughtError) {
      setError(errorMessage(caughtError, t('Group could not be created.', 'Grup oluşturulamadı.')))
    } finally { setIsSending(false) }
  }

  function startDirect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const colleague = colleagues.find((user) => user.user_id === directUserId)
    if (!session || !colleague) return
    const participantUserIds = [session.user.user_id, colleague.user_id].sort()
    const conversation = { id: `direct:${participantUserIds.join(':')}`, title: colleague.display_name, kind: 'direct' as const, participantUserIds }
    setStartedConversations((current) => current.some((item) => item.id === conversation.id) ? current : [...current, conversation])
    setActiveId(conversation.id)
    setShowDirectForm(false)
    setDirectUserId('')
    window.requestAnimationFrame(() => composerRef.current?.focus())
  }

  function messageSources(message: TeamChatMessageRead): AgentSourceRead[] {
    const value = message.message_metadata?.source_refs
    return Array.isArray(value) ? value.filter((item): item is AgentSourceRead => Boolean(item && typeof item === 'object' && 'artifact_id' in item)) : []
  }

  function messageAttachments(message: TeamChatMessageRead): ChatAttachment[] {
    const value = message.message_metadata?.attachments
    return Array.isArray(value)
      ? value.filter((item): item is ChatAttachment => Boolean(item && typeof item === 'object' && 'artifact_id' in item && 'filename' in item))
      : []
  }

  async function attachFile(file: File | undefined) {
    if (!file || !session?.token || !active || isUploading) return
    setIsUploading(true)
    setError(null)
    followLatest()
    try {
      const created = await api.attachTeamChatFile(session.token, file, {
        thread_id: active.id,
        thread_title: active.title,
        thread_kind: active.kind,
        participant_user_ids: active.participantUserIds,
      })
      dataRevision.current += 1
      setMessages((current) => [...current, created])
    } catch (caughtError) {
      setError(errorMessage(caughtError, t('The file could not be added to the conversation.', 'Dosya konuşmaya eklenemedi.')))
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function selectConversation(conversationId: string) {
    if (pendingRun) {
      setStreamedTextByRun((current) => ({ ...current, [pendingRun.run_id]: '' }))
    }
    setActiveId(conversationId)
  }

  const fillFollowUp = (question: string) => {
    setDraft(buildIzgeFollowUp(question))
    focusComposerAtEnd(composerRef.current)
  }

  return (
    <div className="team-chat-product-page">
      <header className="employee-page-header"><div><p className="eyebrow">{t('Team communication', 'Ekip iletişimi')}</p><h1>{t("Team Chat", "Ekip sohbeti")}</h1><p>{t('Talk with your colleagues; write', 'Çalışma arkadaşlarınızla konuşun; İzge’yi çağırmak için bir konuşmada')} <strong>@izge</strong> {t('in a conversation to call Izge.', 'yazın.')}</p></div></header>
      {error || loadError ? <Callout tone="warning">{error ?? loadError}</Callout> : null}
      <section className="team-chat-app" aria-label={t('Team conversations', 'Ekip konuşmaları')}>
        <aside className="team-chat-conversations panel-subtle">
          <div className="team-chat-sidebar-head"><strong><ButtonIcon name="team-chat" />{t('Conversations', 'Konuşmalar')}</strong><span className="team-chat-sidebar-actions"><button type="button" className="text-button" onClick={() => { setShowDirectForm((value) => !value); setShowGroupForm(false) }}><ButtonIcon name="add" />{t('Chat', 'Sohbet')}</button><button type="button" className="text-button" onClick={() => { setShowGroupForm((value) => !value); setShowDirectForm(false) }}><ButtonIcon name="new-group" />{t('Group', 'Grup')}</button></span></div>
          {showDirectForm ? <form className="team-chat-group-form" onSubmit={startDirect}><label className="field"><span className="field-label">{t('Colleague', 'Çalışma arkadaşı')}</span><select value={directUserId} onChange={(event) => setDirectUserId(event.target.value)} required><option value="">{t('Select', 'Seçin')}</option>{colleagues.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name}</option>)}</select></label><button type="submit" className="primary-button" disabled={!directUserId}>{t('Open chat', 'Sohbeti aç')}</button></form> : null}
          {showGroupForm ? <form className="team-chat-group-form" onSubmit={createGroup}><label className="field"><span className="field-label">{t('Group name', 'Grup adı')}</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} required /></label><fieldset><legend>{t('Participants', 'Katılımcılar')}</legend>{colleagues.map((user) => <label key={user.user_id} className="checkbox-row"><input type="checkbox" checked={groupParticipants.includes(user.user_id)} onChange={() => setGroupParticipants((current) => current.includes(user.user_id) ? current.filter((id) => id !== user.user_id) : [...current, user.user_id])} /><span>{user.display_name}</span></label>)}</fieldset><button type="submit" className="primary-button" disabled={isSending || !groupName.trim() || groupParticipants.length === 0}>{t('Create group', 'Grubu oluştur')}</button></form> : null}
          <label className="field"><span className="field-label">{t('Search conversations', 'Konuşmalarda ara')}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Izge or a colleague…', 'İzge veya çalışma arkadaşı…')} /></label>
          <div className="conversation-list">
            {filteredConversations.map((conversation) => <button type="button" key={conversation.id} className={conversation.id === active?.id ? 'conversation-item conversation-item-active' : 'conversation-item'} aria-pressed={conversation.id === active?.id} onClick={() => selectConversation(conversation.id)}><span className="conversation-avatar">{conversation.id === 'izge-colleague' ? 'İZ' : initials(conversation.title)}</span><span><strong>{conversation.title}</strong><small>{conversation.id === 'izge-colleague' ? t('Sourced answers and work tracking', 'Kaynaklı yanıt ve iş takibi') : conversation.kind === 'channel' ? t('Channel', 'Kanal') : t('Private conversation', 'Özel konuşma')}</small></span></button>)}
          </div>
        </aside>
        <div className="team-chat-thread">
          <header className="team-chat-thread-head"><span className="conversation-avatar">{active?.id === 'izge-colleague' ? 'İZ' : initials(active?.title ?? '')}</span><div><h2>{active?.title}</h2><p>{active?.id === 'izge-colleague' ? t('Your colleague with access to company memory', 'Şirket hafızasına erişebilen ekip arkadaşınız') : t('Team conversation', 'Ekip konuşması')}</p></div></header>
          <div className="team-chat-messages" ref={messagesRef} onScroll={handleMessageScroll} role="region" aria-label={t('Messages', 'Mesajlar')} tabIndex={0}>
            {isLoading ? <LoadingState label={t('Loading messages', 'Mesajlar yükleniyor')} /> : null}
            {!isLoading && activeMessages.length === 0 && !latestThreadRun ? <EmptyState title={t('Conversation ready', 'Konuşma hazır')} description={active?.id === 'izge-colleague' ? t('Ask Izge a question about company work.', 'İzge’ye şirket işleri hakkında bir soru sorun.') : t('Send the first message.', 'İlk mesajı gönderin.')} /> : null}
            {activeMessages.map((message) => {
              const own = message.author_user_id === session?.user.user_id
              const sources = messageSources(message)
              const attachments = messageAttachments(message)
              const followUps = metadataStrings(message, 'follow_ups')
              const fromIzge = message.author_display_name === 'İzge'
              const authorTitle = metadataString(message, 'author_title')
              return <article key={message.message_id} className={own ? 'team-chat-message-row team-chat-message-row-own' : 'team-chat-message-row'}><span className="team-chat-message-avatar">{fromIzge ? 'İZ' : initials(message.author_display_name)}</span><div className={own ? 'team-chat-message team-chat-message-own' : 'team-chat-message'}><span className="team-chat-message-author"><strong>{own ? t('You', 'Siz') : message.author_display_name}</strong>{authorTitle ? <small>{authorTitle}</small> : null}</span>{fromIzge ? <AgentAnswer text={message.body} sources={sources} followUps={followUps} onFollowUp={fillFollowUp} /> : message.message_metadata?.attachment_only ? null : <div className="team-chat-message-copy"><AgentText text={message.body} /></div>}{attachments.length ? <div className="team-chat-attachments">{attachments.map((attachment) => <SourcePreviewButton key={attachment.artifact_id} artifactId={attachment.artifact_id} title={attachment.title} className="team-chat-attachment"><ButtonIcon name="attach" /><span><strong>{attachment.filename}</strong><small>{t('Conversation source', 'Sohbet kaynağı')}</small></span></SourcePreviewButton>)}</div> : null}<time>{formatDateTime(message.created_at)}</time></div></article>
            })}
            {pendingRun ? <article className="team-chat-message-row"><span className="team-chat-message-avatar">İZ</span><div className="team-chat-message agent-run-message"><ThinkingState stages={pendingRun.stages} status={pendingRun.status} />{streamedTextByRun[pendingRun.run_id] ? <AgentAnswer text={streamedTextByRun[pendingRun.run_id]} sources={pendingRun.sources} active /> : null}</div></article> : null}
            {!pendingRun && latestThreadRun?.status === 'failed' ? <Callout tone="warning">{latestThreadRun.error || t('Izge could not complete this work.', 'İzge bu işi tamamlayamadı.')}</Callout> : null}
          </div>
          <input ref={fileInputRef} hidden type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => void attachFile(event.target.files?.[0])} />
          <ChatComposer value={draft} onChange={setDraft} onSubmit={() => void submit()} disabled={isSending || Boolean(pendingRun)} context={active?.id === 'izge-colleague' ? t('Company memory', 'Şirket hafızası') : t('Team conversation', 'Ekip konuşması')} label={t(`${active?.title ?? 'conversation'} message`, `${active?.title ?? 'konuşma'} mesajı`)} placeholder={active?.id === 'izge-colleague' ? t('Ask about company files, decisions, or work…', 'Şirket dosyaları, kararlar veya işler hakkında sor…') : t('Write a message or call Izge with @izge…', 'Mesaj yaz veya @izge ile İzge’yi çağır…')} mentionAutocomplete={active?.id !== 'izge-colleague'} inputRef={composerRef} onAdd={() => fileInputRef.current?.click()} addDisabled={isUploading || isSending || Boolean(pendingRun)} addLabel={isUploading ? t('Uploading file', 'Dosya yükleniyor') : t('Add file to conversation', 'Konuşmaya dosya ekle')} />
        </div>
      </section>
    </div>
  )
}
