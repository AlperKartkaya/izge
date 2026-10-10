import { ReviewContextCards } from '../components/ReviewContextCards'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadingState, TaskRows } from '../components/AgentPrimitives'
import { Callout, EmptyState, MetricCard, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { AgentRunRead, ArtifactRead, SignalRead, WorkTaskRead, WorkTaskStatus } from '../lib/types'
import { useLanguage } from '../lib/i18n'
import { homeGreeting } from '../lib/greeting'

function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError && error.message ? error.message : fallback }

export function EmployeeHomePage() {
  const { language, t } = useLanguage()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer) }, [])
  const { session } = useAuth()
  const [tasks, setTasks] = useState<WorkTaskRead[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [signals, setSignals] = useState<SignalRead[]>([])
  const [runs, setRuns] = useState<AgentRunRead[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewRun, setReviewRun] = useState<AgentRunRead | null>(null)

  useEffect(() => {
    if (!session?.token) return
    Promise.all([api.listWorkTasks(session.token), api.listArtifacts(session.token), api.listSignals(session.token), api.listAgentRuns(session.token)])
      .then(([taskList, artifactList, signalList, runList]) => { setTasks(taskList); setArtifacts(artifactList); setSignals(signalList); setRuns(runList); setError(null) })
      .catch((caughtError) => setError(errorMessage(caughtError, t('Workspace could not be loaded.', 'Çalışma alanı yüklenemedi.'))))
      .finally(() => setLoading(false))
  }, [session?.token, t])

  async function updateTask(task: WorkTaskRead, status: WorkTaskStatus) {
    if (!session?.token) return
    try { const updated = await api.updateWorkTask(session.token, task.task_id, { status }); setTasks((current) => current.map((item) => item.task_id === updated.task_id ? updated : item)) }
    catch (caughtError) { setError(errorMessage(caughtError, t('Workspace could not be loaded.', 'Çalışma alanı yüklenemedi.'))) }
  }

  const openTasks = tasks.filter((task) => task.status !== 'done')
  const recentSignals = useMemo(() => [...signals].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)), [signals])
  const latestReview = useMemo(() => runs.filter((run) => run.kind === 'evening_review' && run.status === 'completed').sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0], [runs])

  useEffect(() => {
    const runId = reviewRun?.run_id
    const runStatus = reviewRun?.status
    if (!runId || !session?.token || runStatus === 'completed' || runStatus === 'failed') return
    const events = new EventSource(api.agentRunEventsUrl(runId), { withCredentials: true })
    const refresh = async () => {
      try {
        const next = await api.getAgentRun(session.token, runId)
        setReviewRun(next)
        if (next.status === 'completed' || next.status === 'failed') {
          setRuns((current) => [next, ...current.filter((run) => run.run_id !== next.run_id)])
          events.close()
        }
      } catch (caughtError) { setError(errorMessage(caughtError, t('Workspace could not be loaded.', 'Çalışma alanı yüklenemedi.'))) }
    }
    for (const name of ['stage', 'done', 'failed']) events.addEventListener(name, () => void refresh())
    events.onerror = () => { events.close(); void refresh() }
    return () => events.close()
  }, [reviewRun?.run_id, reviewRun?.status, session, t])

  async function startReview() {
    if (!session?.token) return
    try {
      const accepted = await api.requestEveningReview(session.token)
      setReviewRun(await api.getAgentRun(session.token, accepted.run_id))
    } catch (caughtError) { setError(errorMessage(caughtError, t('Workspace could not be loaded.', 'Çalışma alanı yüklenemedi.'))) }
  }

  return (
    <div className="stack-lg">
      <header className="employee-home-hero"><div><p className="eyebrow">{t('Your workspace', 'Çalışma alanınız')}</p><h1>{homeGreeting(session?.user.display_name ?? '', language, now)}</h1><p>{t('Izge tracks files, decisions, and work, highlighting important changes with their sources.', 'İzge dosyaları, kararları ve işleri takip eder; sizin için önemli değişiklikleri kaynaklarıyla öne çıkarır.')}</p></div><Link className="primary-button" to="/query">{t('Ask Izge', 'İzge’ye sor')}</Link></header>
      {error ? <Callout tone="warning">{error}</Callout> : null}
      {loading ? <LoadingState label={t('Preparing workspace', 'Çalışma alanı hazırlanıyor')} /> : (
        <div className="metric-grid"><MetricCard label={t('Open work', 'Açık iş')} value={openTasks.length} detail={t('Work that needs follow-up', 'Takip edilmesi gereken işler')} /><MetricCard label={t('Sources', 'Kaynak')} value={artifacts.length} detail={t('Files and notes in company memory', 'Şirket hafızasındaki dosya ve notlar')} /><MetricCard label={t('New signals', 'Yeni sinyal')} value={signals.length} detail={t('Changes, conflicts, and recommendations', 'Değişiklik, çelişki ve öneriler')} /></div>
      )}
      <div className="employee-two-column">
        <Panel title={t("Today's work", 'Bugünün işleri')} description={t('Track Izge reminders and work assigned to you here.', 'İzge hatırlatmaları ve size atanan işleri burada takip eder.')} aside={<Link to="/tasks">{t('Open all', 'Tümünü aç')}</Link>}>
          {openTasks.length ? <TaskRows tasks={openTasks.slice(0, 5)} onStatusChange={updateTask} /> : <EmptyState title={t('No open work', 'Açık iş yok')} description={t('You can add a new task or reminder.', 'Yeni bir iş veya hatırlatma ekleyebilirsiniz.')} />}
        </Panel>
        <Panel title={t("Izge's daily review", 'İzge’nin günlük değerlendirmesi')} description={t('Prepared from file, daily log, and work changes throughout the day.', 'Gün içindeki dosya, günlük ve iş değişikliklerinden hazırlanır.')} aside={<button type="button" className="text-button" disabled={Boolean(reviewRun && (reviewRun.status === 'queued' || reviewRun.status === 'running'))} onClick={() => void startReview()}>{t('Review now', 'Şimdi değerlendir')}</button>}>
          {reviewRun && (reviewRun.status === 'queued' || reviewRun.status === 'running') ? <LoadingState label={reviewRun.stages.at(-1)?.label ?? t('Reviewing the day', 'Gün değerlendiriliyor')} /> : null}
          {reviewRun?.status === 'failed' ? <Callout tone="warning">{reviewRun.error || t('Daily review could not be completed.', 'Günlük değerlendirme tamamlanamadı.')}</Callout> : null}
          {latestReview ? <ReviewContextCards review={latestReview} /> : !reviewRun ? <EmptyState title={t('No review yet', 'Henüz değerlendirme yok')} description={t('Izge prepares an end-of-day review as daily notes and work are added.', 'Günlük not ve işler eklendikçe İzge gün sonu değerlendirmesi hazırlar.')} /> : null}
        </Panel>
      </div>
      <Panel title={t('Recent changes', 'Son değişiklikler')} description={t('Decision, assumption, and work signals that need review.', 'İncelenmesi gereken karar, varsayım ve iş sinyalleri.')}>
        {recentSignals.length ? <div className="employee-signal-list">{recentSignals.slice(0, 5).map((signal) => <Link key={signal.signal_id} to={`/signals/${signal.signal_id}`}><strong>{signal.title}</strong><span>{signal.summary}</span><small>{formatDateTime(signal.created_at)}</small></Link>)}</div> : <EmptyState title={t('No new changes', 'Yeni değişiklik yok')} description={t('When Izge finds a new conflict or risk, it will appear here.', 'İzge yeni bir çelişki veya risk bulduğunda burada gösterir.')} />}
      </Panel>
    </div>
  )
}
