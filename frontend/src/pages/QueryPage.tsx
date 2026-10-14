import { ButtonIcon } from '../components/ButtonIcon'
import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { IzgeLogo } from '../components/IzgeLogo'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AgentAnswer, AgentText, ChatComposer, LoadingState, ThinkingState } from '../components/AgentPrimitives'
import { AgentControls } from '../components/AgentControls'
import { useAgentControls } from '../components/useAgentControls'
import { useChatScroll } from '../components/useChatScroll'
import { Callout, EmptyState } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { buildIzgeFollowUp, focusComposerAtEnd } from '../lib/agentText'
import { formatDateTime } from '../lib/format'
import { useLanguage } from '../lib/i18n'
import type { AgentRunRead, AssistantConversationRead, TeamChatMessageRead } from '../lib/types'
import './query-replies.css'

function errorMessage(error: unknown, fallback: string, t: (english: string, turkish: string) => string) {
  if (!(error instanceof ApiError)) return fallback
  if (error.status === 403) return t('You do not have permission for this action.', 'Bu işlem için yetkiniz yok.')
  if (error.status === 503) return t('The selected language model is currently unavailable.', 'Seçili dil modeli şu anda kullanılamıyor.')
  return error.message || fallback
}

function metadataString(message: TeamChatMessageRead, key: string) {
  const value = message.message_metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export function QueryPage() {
  const { session } = useAuth()
  const { language, t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const threadId = searchParams.get('thread') ?? 'izge-colleague'
  const notificationRunId = searchParams.get('run')
  const [conversations, setConversations] = useState<AssistantConversationRead[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [chatMessages, setChatMessages] = useState<TeamChatMessageRead[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isManaging, setIsManaging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [runs, setRuns] = useState<AgentRunRead[]>([])
  const [draft, setDraft] = useState(searchParams.get('prompt') ?? '')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [streamedText, setStreamedText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<TeamChatMessageRead | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const agentControls = useAgentControls(session?.token, session?.user.user_id)
  const activeRunThreadId = runs.find((run) => run.run_id === activeRunId)?.thread_id
  const { ref: messagesRef, onScroll: handleMessageScroll, followLatest } = useChatScroll(threadId, JSON.stringify(runs.map((run) => [run.run_id, run.status, run.answer, run.stages.length])) + streamedText)

  const currentConversation = conversations.find((item) => item.thread_id === threadId)
  const readOnly = Boolean(currentConversation?.archived_at)

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    api.listAssistantConversations(session.token, true).then((items) => { if (!cancelled) setConversations(items) }).catch(() => { if (!cancelled) setError(t('Conversation history could not be loaded.', 'Konuşma geçmişi yüklenemedi.')) })
    return () => { cancelled = true }
  }, [session?.token, t, threadId])

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    async function loadRuns() {
      try {
        const [payload, chat] = await Promise.all([api.listAgentRuns(session!.token, threadId), api.listTeamChatMessages(session!.token, 200, threadId)])
        if (!cancelled) {
          const conversationRuns = payload.filter((run) => run.kind === 'ask' || run.kind === 'artifact_review' || run.kind === 'evening_review')
          setRuns(conversationRuns)
          setChatMessages(chat.messages.filter((message) => metadataString(message, 'thread_id') === threadId))
          setLoadedThreadId(threadId)
          setStreamedText(conversationRuns.find((run) => run.status === 'queued' || run.status === 'running')?.answer ?? '')
          setActiveRunId(conversationRuns.find((run) => run.status === 'queued' || run.status === 'running')?.run_id ?? null)
          setError(null)
        }
      } catch (caughtError) {
        if (!cancelled) { setRuns([]); setLoadedThreadId(threadId); setError(errorMessage(caughtError, t('Izge conversations could not be loaded.', 'İzge konuşmaları yüklenemedi.'), t)) }
      } finally { if (!cancelled) setIsLoading(false) }
    }
    void loadRuns()
    return () => { cancelled = true }
  }, [session, t, threadId])

  useEffect(() => {
    if (!activeRunId || activeRunThreadId !== threadId || !session?.token) return
    let closed = false
    const events = api.subscribeAgentRunEvents(activeRunId)
    const refresh = async () => {
      if (closed) return
      try {
        const run = await api.getAgentRun(session.token, activeRunId)
        if (closed) return
        setRuns((current) => [run, ...current.filter((item) => item.run_id !== run.run_id)])
        if (run.status === 'completed' || run.status === 'failed') {
          setActiveRunId(null)
          setStreamedText('')
          api.listAssistantConversations(session.token, true).then(setConversations).catch(() => {})
          events.close()
          try {
            const chat = await api.listTeamChatMessages(session.token, 200, threadId)
            if (!closed) setChatMessages(chat.messages.filter((message) => metadataString(message, 'thread_id') === threadId))
          } catch {
            if (!closed) setError(t('The completed conversation could not be refreshed.', 'Tamamlanan konuşma yenilenemedi.'))
          }
        }
      } catch (caughtError) {
        setError(errorMessage(caughtError, t("Izge's work status could not be retrieved.", 'İzge’nin çalışma durumu alınamadı.'), t))
      }
    }
    events.addEventListener('delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { text?: string }
      if (payload.text) setStreamedText((current) => current + payload.text)
    })
    events.addEventListener('snapshot', (event) => {
      const run = JSON.parse((event as MessageEvent).data) as AgentRunRead
      setStreamedText(run.answer ?? '')
      void refresh()
    })
    events.addEventListener('reset', () => setStreamedText(''))
    for (const eventName of ['stage', 'source', 'done', 'failed']) events.addEventListener(eventName, () => void refresh())
    events.onerror = () => { events.close(); void refresh() }
    return () => { closed = true; events.close() }
  }, [activeRunId, activeRunThreadId, session?.token, t, threadId])

  function selectThread(next: string) {
    setSearchParams({ thread: next })
    setDraft(''); setError(null); setStreamedText(''); setActiveRunId(null); setReplyingTo(null)
    setLoadedThreadId(null)
  }

  async function manageConversation(action: 'new' | 'rename' | 'archive' | 'delete', conversation?: AssistantConversationRead) {
    if (!session?.token || isManaging) return
    if (action === 'delete' && !window.confirm(t('Delete this conversation from your history? Company files will be kept.', 'Bu konuşma geçmişinizden silinsin mi? Şirket dosyaları korunacak.'))) return
    const renamedTitle = action === 'rename' && conversation
      ? window.prompt(t('Conversation title', 'Konuşma başlığı'), conversation.title)?.trim()
      : null
    if (action === 'rename' && (!renamedTitle || renamedTitle === conversation?.title)) return
    setIsManaging(true); setError(null)
    try {
      if (action === 'new') {
        const created = await api.createAssistantConversation(session.token)
        setConversations((items) => [created, ...items.filter((item) => item.conversation_id !== created.conversation_id)]); selectThread(created.thread_id)
      } else if (conversation) {
        if (action === 'rename') {
          const updated = await api.updateAssistantConversation(session.token, conversation.conversation_id, { title: renamedTitle! })
          setConversations((items) => items.map((item) => item.conversation_id === updated.conversation_id ? updated : item))
        } else if (action === 'archive') {
          const updated = await api.updateAssistantConversation(session.token, conversation.conversation_id, { archived: !conversation.archived_at })
          setConversations((items) => items.map((item) => item.conversation_id === updated.conversation_id ? updated : item))
        } else {
          await api.deleteAssistantConversation(session.token, conversation.conversation_id)
          const items = conversations.filter((item) => item.conversation_id !== conversation.conversation_id)
          setConversations(items)
          if (conversation.thread_id === threadId) {
            const next = items.find((item) => !item.archived_at)
            if (next) selectThread(next.thread_id)
            else { const created = await api.createAssistantConversation(session.token); setConversations((items) => [created, ...items.filter((item) => item.conversation_id !== created.conversation_id)]); selectThread(created.thread_id) }
          }
        }
      }
    } catch (caughtError) { setError(errorMessage(caughtError, t('The conversation could not be updated.', 'Konuşma güncellenemedi.'), t)) }
    finally { setIsManaging(false) }
  }

  async function attachFile(file: File | undefined) {
    if (!file || !session?.token || isUploading || readOnly) return
    setIsUploading(true); setError(null)
    const targetThread = threadId
    try {
      let conversation = currentConversation
      if (!conversation) {
        // The legacy personal thread is lazily registered by the history endpoint.
        conversation = (await api.listAssistantConversations(session.token, true)).find((item) => item.thread_id === targetThread)
      }
      if (!conversation) throw new Error('Conversation unavailable')
      const message = await api.attachAssistantConversationFile(session.token, conversation.conversation_id, file)
      setChatMessages((items) => [...items, message]); followLatest()
    } catch (caughtError) { setError(errorMessage(caughtError, t('The file could not be added.', 'Dosya eklenemedi.'), t)) }
    finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  async function ask() {
    if (!session?.token || !draft.trim() || isLoading || loadedThreadId !== threadId || isSending || activeRunId || readOnly) return
    const message = draft.trim()
    followLatest()
    setDraft('')
    setIsSending(true)
    setError(null)
    setStreamedText('')
    try {
      const created = await api.askColleague(session.token, {
        message,
        client_request_id: crypto.randomUUID(),
        thread_id: threadId,
        thread_title: currentConversation?.title ?? runs[0]?.thread_title ?? 'İzge',
        thread_kind: runs[0]?.thread_kind ?? 'direct',
        participant_user_ids: runs[0]?.participant_user_ids ?? [session.user.user_id],
        reply_to_message_id: replyingTo?.message_id,
        ...agentControls.requestOptions,
      })
      const run = await api.getAgentRun(session.token, created.run_id)
      setRuns((current) => [run, ...current]); setStreamedText(run.answer ?? '')
      setActiveRunId(run.status === 'queued' || run.status === 'running' ? run.run_id : null)
      try {
        const chat = await api.listTeamChatMessages(session.token, 200, threadId)
        setChatMessages(chat.messages.filter((item) => metadataString(item, 'thread_id') === threadId))
      } catch {
        setError(t('The conversation could not be refreshed.', 'Konuşma yenilenemedi.'))
      }
      setReplyingTo(null)
      api.listAssistantConversations(session.token, true).then(setConversations).catch(() => {})
    } catch (caughtError) {
      setDraft(message)
      setError(errorMessage(caughtError, t('The question could not be sent to Izge.', 'Soru İzge’ye iletilemedi.'), t))
    } finally { setIsSending(false) }
  }

  const attachments = useMemo(() => chatMessages.filter((message) => Array.isArray(message.message_metadata?.attachments)), [chatMessages])
  const messagesByRun = useMemo(() => {
    const grouped = new Map<string, { question?: TeamChatMessageRead; answer?: TeamChatMessageRead }>()
    for (const message of chatMessages) {
      const runId = metadataString(message, 'colleague_run_id')
      if (!runId) continue
      const pair = grouped.get(runId) ?? {}
      if (message.is_authored_by_current_user) pair.question = message
      else if (message.author_display_name === 'İzge') pair.answer = message
      grouped.set(runId, pair)
    }
    return grouped
  }, [chatMessages])
  const orderedRuns = useMemo(() => loadedThreadId === threadId ? [...runs].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)) : [], [loadedThreadId, runs, threadId])
  const entries = useMemo(() => [
    ...orderedRuns.map((run) => ({ kind: 'run' as const, id: run.run_id, date: run.created_at, run })),
    ...attachments.filter((message) => loadedThreadId === threadId && message.message_metadata?.thread_id === threadId).map((message) => ({ kind: 'attachment' as const, id: message.message_id, date: message.created_at, message })),
  ].sort((left, right) => Date.parse(left.date) - Date.parse(right.date)), [attachments, loadedThreadId, orderedRuns, threadId])
  const currentConversationEmpty = !isLoading && loadedThreadId === threadId && runs.length === 0 && attachments.length === 0 && !readOnly
  const fillFollowUp = (question: string) => {
    setDraft(buildIzgeFollowUp(question))
    focusComposerAtEnd(composerRef.current)
  }
  const startReply = (message: TeamChatMessageRead) => {
    setReplyingTo(message)
    window.requestAnimationFrame(() => composerRef.current?.focus())
  }

  return (
    <div className="assistant-page employee-agent-page">
      <header className="employee-page-header">
        <div><h1>{t('Ask Izge', 'İzge’ye sor')}</h1></div>
        <div className="query-header-actions"><span className="language-chip">{language === 'en' ? 'English' : 'Türkçe'}</span></div>
      </header>
      {error ? <Callout tone="warning">{error}</Callout> : null}
      <section className={`team-chat-app query-chat-app${sidebarCollapsed ? ' team-chat-app-collapsed' : ''}`}>
      <aside className="team-chat-conversations query-history" aria-label={t('Izge conversations', 'İzge konuşmaları')}>
        <div className="team-chat-sidebar-head"><button type="button" className="icon-button conversation-collapse" aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? t('Expand conversations', 'Konuşmaları genişlet') : t('Collapse conversations', 'Konuşmaları daralt')} onClick={() => setSidebarCollapsed((value) => !value)}><span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span></button><strong><ButtonIcon name="ask-izge" />{t('Izge conversations', 'İzge konuşmaları')}</strong><div className="query-history-actions"><button type="button" className="text-button" aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? t('Active', 'Aktif') : t('Archived', 'Arşiv')}</button><button type="button" className="icon-button" aria-label={t('New conversation', 'Yeni konuşma')} title={currentConversationEmpty ? t('Send a message before opening another conversation.', 'Yeni bir konuşma açmadan önce bu konuşmaya mesaj gönderin.') : t('New conversation', 'Yeni konuşma')} disabled={isManaging || isUploading || isSending || currentConversationEmpty} onClick={() => void manageConversation('new')}><ButtonIcon name="add" /></button></div></div>
        <div className="conversation-list">{conversations.filter((item) => Boolean(item.archived_at) === showArchived).map((item) => <article key={item.conversation_id} className={`query-history-item${item.thread_id === threadId ? ' query-history-item-active' : ''}`}>
          <button type="button" className="conversation-item query-history-select" title={sidebarCollapsed ? item.title : undefined} aria-label={item.title} aria-pressed={item.thread_id === threadId} disabled={isUploading || isSending} onClick={() => selectThread(item.thread_id)}><span className="conversation-avatar"><IzgeLogo /></span><span><strong>{item.title}</strong><small>{formatDateTime(item.updated_at)}</small></span></button>
          <div className="query-history-item-actions"><button type="button" className="icon-button" disabled={isManaging || isUploading || isSending} aria-label={t('Rename conversation', 'Konuşmayı yeniden adlandır')} title={t('Rename conversation', 'Konuşmayı yeniden adlandır')} onClick={() => void manageConversation('rename', item)}><ButtonIcon name="edit" /></button><button type="button" className="icon-button" disabled={isManaging || isUploading || isSending || (item.thread_id === threadId && Boolean(activeRunId))} aria-label={item.archived_at ? t('Restore conversation', 'Konuşmayı geri al') : t('Archive conversation', 'Konuşmayı arşivle')} title={item.archived_at ? t('Restore conversation', 'Konuşmayı geri al') : t('Archive conversation', 'Konuşmayı arşivle')} onClick={() => void manageConversation('archive', item)}><ButtonIcon name={item.archived_at ? 'refresh' : 'save'} /></button><button type="button" className="icon-button" disabled={isManaging || isUploading || isSending || (item.thread_id === threadId && Boolean(activeRunId))} aria-label={t('Delete conversation', 'Konuşmayı sil')} title={t('Delete conversation', 'Konuşmayı sil')} onClick={() => void manageConversation('delete', item)}><ButtonIcon name="delete" /></button></div>
        </article>)}</div>
      </aside>
      <div className="agent-chat-panel">
      <section className="agent-conversation" aria-label={t('Izge conversation', 'İzge konuşması')} ref={messagesRef} onScroll={handleMessageScroll} tabIndex={0}>
        {isLoading || loadedThreadId !== threadId ? <LoadingState label={t('Loading conversations', 'Konuşmalar yükleniyor')} /> : null}
        {!isLoading && loadedThreadId === threadId && entries.length === 0 && !isSending ? <EmptyState title={t('Izge is ready', 'İzge hazır')} description={t('Ask why a decision was made, what changed, or what to do next.', 'Bir kararın nedenini, son değişiklikleri veya sıradaki işi sorun.')} /> : null}
        {entries.map((entry) => {
          if (entry.kind === 'attachment') {
            const attached = entry.message.message_metadata?.attachments as { artifact_id: string; title: string; filename: string }[]
            return <article className="agent-user-message" key={entry.id}><strong>{t('You', 'Siz')}</strong>{attached.map((file) => <SourcePreviewButton key={file.artifact_id} artifactId={file.artifact_id} title={file.title} className="team-chat-attachment"><ButtonIcon name="attach" /><span>{file.filename}</span></SourcePreviewButton>)}<time>{formatDateTime(entry.date)}</time></article>
          }
          const run = entry.run
          const active = run.run_id === activeRunId
          const answer = active && streamedText ? streamedText : run.answer ?? ''
          const persistedMessages = messagesByRun.get(run.run_id)
          const questionMessage = persistedMessages?.question
          const answerMessage = persistedMessages?.answer
          const canReply = run.status === 'completed'
          return (
            <div className="agent-turn" key={run.run_id}>
              {run.kind === 'ask' && run.run_id !== notificationRunId ? <article className="agent-user-message query-reply-target">{canReply && questionMessage ? <button type="button" className="query-reply-button" aria-label={t('Reply to your message', 'Mesajınıza yanıt ver')} onClick={() => startReply(questionMessage)}>{t('Reply', 'Yanıtla')}</button> : null}<strong>{t('You', 'Siz')}</strong>{questionMessage?.reply_to ? <blockquote className="query-reply-quote"><strong>{questionMessage.reply_to.author_display_name}</strong><span>{questionMessage.reply_to.body}</span></blockquote> : null}<div><AgentText text={run.question} /></div><time>{formatDateTime(run.created_at)}</time></article> : null}
              <article className="agent-assistant-message query-reply-target">
                {canReply && answerMessage ? <button type="button" className="query-reply-button" aria-label={t('Reply to Izge', 'İzge’ye yanıt ver')} onClick={() => startReply(answerMessage)}>{t('Reply', 'Yanıtla')}</button> : null}
                <div className="agent-message-author"><span className="agent-avatar"><IzgeLogo /></span><strong>İzge</strong></div>
                {run.stages.length || active ? <ThinkingState key={`${run.run_id}-${run.status}`} stages={run.stages} status={run.status} /> : null}
                {run.status === 'queued' && run.stages.length === 0 ? <LoadingState label={t('Work queued', 'İş sıraya alındı')} /> : null}
                {answer ? <AgentAnswer text={answer} sources={run.sources} followUps={run.follow_ups} active={active && run.status === 'running'} onFollowUp={fillFollowUp} /> : null}
                {run.status === 'failed' ? <Callout tone="warning">{run.error || t('Izge could not complete this work.', 'İzge bu işi tamamlayamadı.')}</Callout> : null}
              </article>
            </div>
          )
        })}
        {isSending ? <div className="query-send-loading"><ThinkingState stages={[]} status="queued" /></div> : null}
      </section>
      {readOnly ? <p className="query-archived-note">{t('This conversation is archived. Restore it to continue.', 'Bu konuşma arşivlendi. Devam etmek için geri alın.')}</p> : null}
      <input ref={fileInputRef} hidden type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => void attachFile(event.target.files?.[0])} />
      <div className="query-composer-wrap">{replyingTo ? <div className="query-reply-preview"><span><strong>{replyingTo.author_display_name}</strong><small>{replyingTo.body}</small></span><button type="button" aria-label={t('Cancel reply', 'Yanıtı iptal et')} onClick={() => setReplyingTo(null)}>×</button></div> : null}<ChatComposer onAdd={() => fileInputRef.current?.click()} addDisabled={isUploading || readOnly} addLabel={isUploading ? t('Uploading file', 'Dosya yükleniyor') : t('Add files', 'Dosya ekle')} value={draft} onChange={setDraft} onSubmit={() => void ask()} disabled={isLoading || loadedThreadId !== threadId || isSending || isUploading || readOnly || Boolean(activeRunId)} inputRef={composerRef} mentionAutocomplete tools={agentControls} leading={<AgentControls controls={agentControls} disabled={isSending || Boolean(activeRunId)} />} /></div>
      </div>
      </section>
    </div>
  )
}
