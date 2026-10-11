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
import type { AgentRunRead } from '../lib/types'

function errorMessage(error: unknown, fallback: string, t: (english: string, turkish: string) => string) {
  if (!(error instanceof ApiError)) return fallback
  if (error.status === 403) return t('You do not have permission for this action.', 'Bu işlem için yetkiniz yok.')
  if (error.status === 503) return t('The selected language model is currently unavailable.', 'Seçili dil modeli şu anda kullanılamıyor.')
  return error.message || fallback
}

export function QueryPage() {
  const { session } = useAuth()
  const { language, t } = useLanguage()
  const [searchParams] = useSearchParams()
  const threadId = searchParams.get('thread') ?? 'izge-colleague'
  const notificationRunId = searchParams.get('run')
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

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    async function loadRuns() {
      try {
        const payload = await api.listAgentRuns(session!.token, threadId)
        if (!cancelled) {
          const conversationRuns = payload.filter((run) => run.kind === 'ask' || run.kind === 'artifact_review' || run.kind === 'evening_review')
          setRuns(conversationRuns)
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

  async function ask() {
    if (!session?.token || !draft.trim() || isLoading || loadedThreadId !== threadId || isSending || activeRunId) return
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
        thread_title: runs[0]?.thread_title ?? 'İzge',
        thread_kind: runs[0]?.thread_kind ?? 'direct',
        participant_user_ids: runs[0]?.participant_user_ids ?? [session.user.user_id],
        ...agentControls.requestOptions,
      })
      const run = await api.getAgentRun(session.token, created.run_id)
      setRuns((current) => [run, ...current])
      setActiveRunId(run.run_id)
    } catch (caughtError) {
      setDraft(message)
      setError(errorMessage(caughtError, t('The question could not be sent to Izge.', 'Soru İzge’ye iletilemedi.'), t))
    } finally { setIsSending(false) }
  }

  const orderedRuns = useMemo(() => loadedThreadId === threadId ? [...runs].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)) : [], [loadedThreadId, runs, threadId])
  const fillFollowUp = (question: string) => {
    setDraft(buildIzgeFollowUp(question))
    focusComposerAtEnd(composerRef.current)
  }

  return (
    <div className="assistant-page employee-agent-page">
      <header className="employee-page-header">
        <div><p className="eyebrow">{t('Your always-on colleague', 'Uyumayan ekip arkadaşınız')}</p><h1>{t('Ask Izge', 'İzge’ye sor')}</h1><p>{t('Finds accessible sources in company files, daily logs, and tasks to answer your questions.', 'Şirket dosyalarından, günlüklerden ve görevlerden erişebildiği kaynakları bularak yanıt verir.')}</p></div>
        <span className="language-chip">{language === 'en' ? 'English' : 'Türkçe'}</span>
      </header>
      {error ? <Callout tone="warning">{error}</Callout> : null}
      <div className="agent-chat-panel">
      <section className="agent-conversation" aria-label={t('Izge conversation', 'İzge konuşması')} ref={messagesRef} onScroll={handleMessageScroll} tabIndex={0}>
        {isLoading || loadedThreadId !== threadId ? <LoadingState label={t('Loading conversations', 'Konuşmalar yükleniyor')} /> : null}
        {!isLoading && loadedThreadId === threadId && orderedRuns.length === 0 ? <EmptyState title={t('Izge is ready', 'İzge hazır')} description={t('Ask why a decision was made, what changed, or what to do next.', 'Bir kararın nedenini, son değişiklikleri veya sıradaki işi sorun.')} /> : null}
        {orderedRuns.map((run) => {
          const active = run.run_id === activeRunId
          const answer = active && streamedText ? streamedText : run.answer ?? ''
          return (
            <div className="agent-turn" key={run.run_id}>
              {run.kind === 'ask' && run.run_id !== notificationRunId ? <article className="agent-user-message"><strong>{t('You', 'Siz')}</strong><div><AgentText text={run.question} /></div><time>{formatDateTime(run.created_at)}</time></article> : null}
              <article className="agent-assistant-message">
                <div className="agent-message-author"><span className="agent-avatar">İZ</span><strong>İzge</strong></div>
                {run.stages.length ? <ThinkingState key={`${run.run_id}-${run.status}`} stages={run.stages} status={run.status} /> : null}
                {run.status === 'queued' && run.stages.length === 0 ? <LoadingState label={t('Work queued', 'İş sıraya alındı')} /> : null}
                {answer ? <AgentAnswer text={answer} sources={run.sources} followUps={run.follow_ups} active={active && run.status === 'running'} onFollowUp={fillFollowUp} /> : null}
                {run.status === 'failed' ? <Callout tone="warning">{run.error || t('Izge could not complete this work.', 'İzge bu işi tamamlayamadı.')}</Callout> : null}
              </article>
            </div>
          )
        })}
      </section>
      <ChatComposer value={draft} onChange={setDraft} onSubmit={() => void ask()} disabled={isLoading || loadedThreadId !== threadId || isSending || Boolean(activeRunId)} inputRef={composerRef} mentionAutocomplete leading={<AgentControls controls={agentControls} disabled={isSending || Boolean(activeRunId)} />} />
      </div>
    </div>
  )
}
