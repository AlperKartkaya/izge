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

function errorMessage(error: unknown, fallback: string, t: (english: string, turkish: string) => string) {
  if (!(error instanceof ApiError)) return fallback
  if (error.status === 403) return t('You do not have permission for this action.', 'Bu işlem için yetkiniz yok.')
  if (error.status === 503) return t('The selected language model is currently unavailable.', 'Seçili dil modeli şu anda kullanılamıyor.')
  return error.message || fallback
}

export function QueryPage() {
  const { session } = useAuth()
  const { language, t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const threadId = searchParams.get('thread') ?? 'izge-colleague'
  const notificationRunId = searchParams.get('run')
  const [conversations, setConversations] = useState<AssistantConversationRead[]>([])
  const [historyOpen, setHistoryOpen] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [attachments, setAttachments] = useState<TeamChatMessageRead[]>([])
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
          setAttachments(chat.messages.filter((message) => message.message_metadata?.thread_id === threadId && Array.isArray(message.message_metadata?.attachments)))
          setLoadedThreadId(threadId)
          setStreamedText('')
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
    const events = new EventSource(api.agentRunEventsUrl(activeRunId), { withCredentials: true })
    const refresh = async () => {
      if (closed) return
      try {
        const run = await api.getAgentRun(session.token, activeRunId)
        if (closed) return
        setRuns((current) => [run, ...current.filter((item) => item.run_id !== run.run_id)])
        if (run.status === 'completed' || run.status === 'failed') {
          setActiveRunId(null)
          setStreamedText('')
          events.close()
        }
      } catch (caughtError) {
        setError(errorMessage(caughtError, t("Izge's work status could not be retrieved.", 'İzge’nin çalışma durumu alınamadı.'), t))
      }
    }
    events.addEventListener('delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { text?: string }
      if (payload.text) setStreamedText((current) => current + payload.text)
    })
    events.addEventListener('reset', () => setStreamedText(''))
    for (const eventName of ['stage', 'source', 'done', 'failed']) events.addEventListener(eventName, () => void refresh())
    events.onerror = () => { events.close(); void refresh() }
    return () => { closed = true; events.close() }
  }, [activeRunId, activeRunThreadId, session?.token, t, threadId])

  function selectThread(next: string) {
    setSearchParams({ thread: next })
    setDraft(''); setError(null); setStreamedText(''); setActiveRunId(null)
    setLoadedThreadId(null)
  }

  async function manageConversation(action: 'new' | 'archive' | 'delete', conversation?: AssistantConversationRead) {
    if (!session?.token || isManaging) return
    if (action === 'delete' && !window.confirm(t('Delete this conversation from your history? Company files will be kept.', 'Bu konuşma geçmişinizden silinsin mi? Şirket dosyaları korunacak.'))) return
    setIsManaging(true); setError(null)
    try {
      if (action === 'new') {
        const created = await api.createAssistantConversation(session.token)
        setConversations((items) => [created, ...items]); selectThread(created.thread_id)
      } else if (conversation) {
        if (action === 'archive') {
          const updated = await api.updateAssistantConversation(session.token, conversation.conversation_id, { archived: !conversation.archived_at })
          setConversations((items) => items.map((item) => item.conversation_id === updated.conversation_id ? updated : item))
        } else {
          await api.deleteAssistantConversation(session.token, conversation.conversation_id)
          const items = conversations.filter((item) => item.conversation_id !== conversation.conversation_id)
          setConversations(items)
          if (conversation.thread_id === threadId) {
            const next = items.find((item) => !item.archived_at)
            if (next) selectThread(next.thread_id)
            else { const created = await api.createAssistantConversation(session.token); setConversations((items) => [created, ...items]); selectThread(created.thread_id) }
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
      setAttachments((items) => [...items, message]); followLatest()
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
        ...agentControls.requestOptions,
      })
      const run = await api.getAgentRun(session.token, created.run_id)
      setRuns((current) => [run, ...current])
      setActiveRunId(run.run_id)
      api.listAssistantConversations(session.token, true).then(setConversations).catch(() => {})
    } catch (caughtError) {
      setDraft(message)
      setError(errorMessage(caughtError, t('The question could not be sent to Izge.', 'Soru İzge’ye iletilemedi.'), t))
    } finally { setIsSending(false) }
  }

  const orderedRuns = useMemo(() => loadedThreadId === threadId ? [...runs].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)) : [], [loadedThreadId, runs, threadId])
  const entries = useMemo(() => [
    ...orderedRuns.map((run) => ({ kind: 'run' as const, id: run.run_id, date: run.created_at, run })),
    ...attachments.filter((message) => loadedThreadId === threadId && message.message_metadata?.thread_id === threadId).map((message) => ({ kind: 'attachment' as const, id: message.message_id, date: message.created_at, message })),
  ].sort((left, right) => Date.parse(left.date) - Date.parse(right.date)), [attachments, loadedThreadId, orderedRuns, threadId])
  const fillFollowUp = (question: string) => {
    setDraft(buildIzgeFollowUp(question))
    focusComposerAtEnd(composerRef.current)
  }

  return (
    <div className="assistant-page employee-agent-page">
      <header className="employee-page-header">
        <div><p className="eyebrow">{t('Your always-on colleague', 'Uyumayan ekip arkadaşınız')}</p><h1>{t('Ask Izge', 'İzge’ye sor')}</h1><p>{t('Finds accessible sources in company files, daily logs, and tasks to answer your questions.', 'Şirket dosyalarından, günlüklerden ve görevlerden erişebildiği kaynakları bularak yanıt verir.')}</p></div>
        <div className="query-header-actions"><button type="button" className="icon-button" aria-label={t('Show conversation history', 'Konuşma geçmişini göster')} title={t('Show conversation history', 'Konuşma geçmişini göster')} aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}><ButtonIcon name="team-chat" /></button><button type="button" className="icon-button" aria-label={t('New conversation', 'Yeni konuşma')} title={t('New conversation', 'Yeni konuşma')} disabled={isManaging || isUploading || isSending} onClick={() => void manageConversation('new')}><ButtonIcon name="add" /></button><span className="language-chip">{language === 'en' ? 'English' : 'Türkçe'}</span></div>
      </header>
      {error ? <Callout tone="warning">{error}</Callout> : null}
      <div className={`query-chat-layout${historyOpen ? ' query-chat-layout-history' : ''}`}>
      {historyOpen ? <aside className="query-history" aria-label={t('Conversation history', 'Konuşma geçmişi')}>
        <div className="query-history-head"><strong>{t('Conversations', 'Konuşmalar')}</strong><button type="button" className="text-button" aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? t('Active', 'Aktif') : t('Archived', 'Arşiv')}</button></div>
        <div className="conversation-list">{conversations.filter((item) => Boolean(item.archived_at) === showArchived).map((item) => <article key={item.conversation_id} className={`query-history-item${item.thread_id === threadId ? ' query-history-item-active' : ''}`}>
          <button type="button" className="query-history-select" disabled={isUploading || isSending} onClick={() => selectThread(item.thread_id)}><strong>{item.title}</strong><small>{formatDateTime(item.updated_at)}</small></button>
          <div><button type="button" className="icon-button" disabled={isManaging || isUploading || isSending || (item.thread_id === threadId && Boolean(activeRunId))} aria-label={item.archived_at ? t('Restore conversation', 'Konuşmayı geri al') : t('Archive conversation', 'Konuşmayı arşivle')} title={item.archived_at ? t('Restore conversation', 'Konuşmayı geri al') : t('Archive conversation', 'Konuşmayı arşivle')} onClick={() => void manageConversation('archive', item)}><ButtonIcon name={item.archived_at ? 'refresh' : 'save'} /></button><button type="button" className="icon-button" disabled={isManaging || isUploading || isSending || (item.thread_id === threadId && Boolean(activeRunId))} aria-label={t('Delete conversation', 'Konuşmayı sil')} title={t('Delete conversation', 'Konuşmayı sil')} onClick={() => void manageConversation('delete', item)}><ButtonIcon name="delete" /></button></div>
        </article>)}</div>
      </aside> : null}
      <div className="agent-chat-panel">
      <section className="agent-conversation" aria-label={t('Izge conversation', 'İzge konuşması')} ref={messagesRef} onScroll={handleMessageScroll} tabIndex={0}>
        {isLoading || loadedThreadId !== threadId ? <LoadingState label={t('Loading conversations', 'Konuşmalar yükleniyor')} /> : null}
        {!isLoading && loadedThreadId === threadId && entries.length === 0 ? <EmptyState title={t('Izge is ready', 'İzge hazır')} description={t('Ask why a decision was made, what changed, or what to do next.', 'Bir kararın nedenini, son değişiklikleri veya sıradaki işi sorun.')} /> : null}
        {entries.map((entry) => {
          if (entry.kind === 'attachment') {
            const attached = entry.message.message_metadata?.attachments as { artifact_id: string; title: string; filename: string }[]
            return <article className="agent-user-message" key={entry.id}><strong>{t('You', 'Siz')}</strong>{attached.map((file) => <SourcePreviewButton key={file.artifact_id} artifactId={file.artifact_id} title={file.title} className="team-chat-attachment"><ButtonIcon name="attach" /><span>{file.filename}</span></SourcePreviewButton>)}<time>{formatDateTime(entry.date)}</time></article>
          }
          const run = entry.run
          const active = run.run_id === activeRunId
          const answer = active && streamedText ? streamedText : run.answer ?? ''
          return (
            <div className="agent-turn" key={run.run_id}>
              {run.kind === 'ask' && run.run_id !== notificationRunId ? <article className="agent-user-message"><strong>{t('You', 'Siz')}</strong><div><AgentText text={run.question} /></div><time>{formatDateTime(run.created_at)}</time></article> : null}
              <article className="agent-assistant-message">
                <div className="agent-message-author"><span className="agent-avatar"><IzgeLogo /></span><strong>İzge</strong></div>
                {run.stages.length ? <ThinkingState key={`${run.run_id}-${run.status}`} stages={run.stages} status={run.status} /> : null}
                {run.status === 'queued' && run.stages.length === 0 ? <LoadingState label={t('Work queued', 'İş sıraya alındı')} /> : null}
                {answer ? <AgentAnswer text={answer} sources={run.sources} followUps={run.follow_ups} active={active && run.status === 'running'} onFollowUp={fillFollowUp} /> : null}
                {run.status === 'failed' ? <Callout tone="warning">{run.error || t('Izge could not complete this work.', 'İzge bu işi tamamlayamadı.')}</Callout> : null}
              </article>
            </div>
          )
        })}
      </section>
      {readOnly ? <p className="query-archived-note">{t('This conversation is archived. Restore it to continue.', 'Bu konuşma arşivlendi. Devam etmek için geri alın.')}</p> : null}
      <input ref={fileInputRef} hidden type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => void attachFile(event.target.files?.[0])} />
      <ChatComposer onAdd={() => fileInputRef.current?.click()} addDisabled={isUploading || readOnly} addLabel={isUploading ? t('Uploading file', 'Dosya yükleniyor') : t('Add files', 'Dosya ekle')} value={draft} onChange={setDraft} onSubmit={() => void ask()} disabled={isLoading || loadedThreadId !== threadId || isSending || isUploading || readOnly || Boolean(activeRunId)} inputRef={composerRef} mentionAutocomplete tools={agentControls} leading={<AgentControls controls={agentControls} disabled={isSending || Boolean(activeRunId)} />} />
      </div>
      </div>
    </div>
  )
}
