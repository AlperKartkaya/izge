import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AgentAnswer, AgentText, ChatComposer, LoadingState, ThinkingState } from '../components/AgentPrimitives'
import { useChatScroll } from '../components/useChatScroll'
import { Callout, EmptyState } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { AgentRunRead } from '../lib/types'

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback
  if (error.status === 403) return 'Bu işlem için yetkiniz yok.'
  if (error.status === 503) return 'Yerel dil modeli şu anda kullanılamıyor.'
  return error.message || fallback
}

export function QueryPage() {
  const { session } = useAuth()
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
        if (!cancelled) { setRuns([]); setLoadedThreadId(threadId); setError(errorMessage(caughtError, 'İzge konuşmaları yüklenemedi.')) }
      } finally { if (!cancelled) setIsLoading(false) }
    }
    void loadRuns()
    return () => { cancelled = true }
  }, [session, threadId])

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
        setError(errorMessage(caughtError, 'İzge’nin çalışma durumu alınamadı.'))
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
  }, [activeRunId, activeRunThreadId, session?.token, threadId])

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
      })
      const run = await api.getAgentRun(session.token, created.run_id)
      setRuns((current) => [run, ...current])
      setActiveRunId(run.run_id)
    } catch (caughtError) {
      setDraft(message)
      setError(errorMessage(caughtError, 'Soru İzge’ye iletilemedi.'))
    } finally { setIsSending(false) }
  }

  const orderedRuns = useMemo(() => loadedThreadId === threadId ? [...runs].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)) : [], [loadedThreadId, runs, threadId])
  const fillFollowUp = (question: string) => {
    setDraft(`@izge ${question}`)
    window.requestAnimationFrame(() => composerRef.current?.focus())
  }

  return (
    <div className="assistant-page employee-agent-page">
      <header className="employee-page-header">
        <div><p className="eyebrow">Uyumayan ekip arkadaşınız</p><h1>İzge’ye sor</h1><p>Şirket dosyalarından, günlüklerden ve görevlerden erişebildiği kaynakları bularak yanıt verir.</p></div>
        <span className="language-chip">Türkçe</span>
      </header>
      {error ? <Callout tone="warning">{error}</Callout> : null}
      <div className="agent-chat-panel">
      <section className="agent-conversation" aria-label="İzge konuşması" ref={messagesRef} onScroll={handleMessageScroll} tabIndex={0}>
        {isLoading || loadedThreadId !== threadId ? <LoadingState label="Konuşmalar yükleniyor" /> : null}
        {!isLoading && loadedThreadId === threadId && orderedRuns.length === 0 ? <EmptyState title="İzge hazır" description="Bir kararın nedenini, son değişiklikleri veya sıradaki işi sorun." /> : null}
        {orderedRuns.map((run) => {
          const active = run.run_id === activeRunId
          const answer = active && streamedText ? streamedText : run.answer ?? ''
          return (
            <div className="agent-turn" key={run.run_id}>
              {run.kind === 'ask' && run.run_id !== notificationRunId ? <article className="agent-user-message"><strong>Siz</strong><div><AgentText text={run.question} /></div><time>{formatDateTime(run.created_at)}</time></article> : null}
              <article className="agent-assistant-message">
                <div className="agent-message-author"><span className="agent-avatar">İZ</span><strong>İzge</strong></div>
                {(run.status === 'queued' || run.status === 'running') ? <ThinkingState stages={run.stages} status={run.status} /> : null}
                {run.status === 'queued' && run.stages.length === 0 ? <LoadingState label="İş sıraya alındı" /> : null}
                {answer ? <AgentAnswer text={answer} sources={run.sources} followUps={run.follow_ups} active={active && run.status === 'running'} onFollowUp={fillFollowUp} /> : null}
                {run.status === 'failed' ? <Callout tone="warning">{run.error || 'İzge bu işi tamamlayamadı.'}</Callout> : null}
              </article>
            </div>
          )
        })}
      </section>
      <ChatComposer value={draft} onChange={setDraft} onSubmit={() => void ask()} disabled={isLoading || loadedThreadId !== threadId || isSending || Boolean(activeRunId)} inputRef={composerRef} mentionAutocomplete />
      </div>
    </div>
  )
}
