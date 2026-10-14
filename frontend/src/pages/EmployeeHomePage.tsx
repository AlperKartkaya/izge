import { ProgressMeter } from '../components/ProgressMeter'
import { ButtonIcon } from '../components/ButtonIcon'
import { ReviewContextCards } from '../components/ReviewContextCards'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadingState, TaskRows } from '../components/AgentPrimitives'
import { Callout, EmptyState, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { AgentRunRead, ArtifactRead, SignalRead, WorkTaskRead, WorkTaskStatus } from '../lib/types'
import { useLanguage } from '../lib/i18n'
import { homeGreeting } from '../lib/greeting'
import './employee-home.css'

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
    const events = api.subscribeAgentRunEvents(runId)
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
      <header className="employee-home-hero"><div><h1>{homeGreeting(session?.user.display_name ?? '', language, now)}</h1><p>{t('Start with the work that needs your attention.', 'Önce dikkatinizi bekleyen işlerden başlayın.')}</p></div><Link className="primary-button" to="/query">{t('Ask Izge', 'İzge’ye sor')}</Link></header>
      {error ? <Callout tone="warning">{error}</Callout> : null}
      {loading ? <LoadingState label={t('Preparing workspace', 'Çalışma alanı hazırlanıyor')} /> : (
        <div className="employee-home-summary" role="status">
          <strong>{openTasks.length ? t(`${openTasks.length} open work items`, `${openTasks.length} açık iş`) : t('No open work', 'Açık iş yok')}</strong>
          <span>{signals.length ? t(`${signals.length} changes to review`, `İncelenecek ${signals.length} değişiklik`) : t('No new changes', 'Yeni değişiklik yok')}</span>
        </div>
      )}
      <nav className="employee-home-actions" aria-label={t('Quick actions', 'Hızlı işlemler')}>
        <Link className="home-action" to="/tasks"><ButtonIcon name="tasks" />{t('Tasks', 'İşler')}</Link>
        <Link className="home-action" to="/team-chat"><ButtonIcon name="team-chat" />{t('Team chat', 'Ekip sohbeti')}</Link>
        <Link className="home-action" to="/memory"><ButtonIcon name="memory" />{t(`${artifacts.length} sources`, `${artifacts.length} kaynak`)}</Link>
        <Link className="home-action" to={recentSignals[0] ? `/signals/${recentSignals[0].signal_id}` : '/memory'}><ButtonIcon name="notifications" />{recentSignals[0] ? t('Latest change', 'Son değişiklik') : t('Explore company memory', 'Şirket hafızasını keşfet')}</Link>
      </nav>
      <div className="employee-two-column">
        <Panel title={t("Today's work", 'Bugünün işleri')} aside={<Link className="home-action" to="/tasks"><ButtonIcon name="tasks" />{t('Open all', 'Tümünü aç')}</Link>}>
          {!loading && tasks.length > 0 ? <ProgressMeter value={(tasks.length - openTasks.length) / tasks.length} label={t('Completed tasks', 'Tamamlanan işler')} detail={t(`${tasks.length - openTasks.length} of ${tasks.length}`, `${tasks.length - openTasks.length} / ${tasks.length}`)} /> : null}
          {openTasks.length ? <TaskRows tasks={openTasks.slice(0, 5)} onStatusChange={updateTask} /> : <EmptyState title={t('No open work', 'Açık iş yok')} description={t('You can add a new task or reminder.', 'Yeni bir iş veya hatırlatma ekleyebilirsiniz.')} />}
        </Panel>
        <Panel title={t("Izge's daily review", 'İzge’nin günlük değerlendirmesi')} aside={<button type="button" className="text-button" disabled={Boolean(reviewRun && (reviewRun.status === 'queued' || reviewRun.status === 'running'))} onClick={() => void startReview()}>{t('Review now', 'Şimdi değerlendir')}</button>}>
          {reviewRun && (reviewRun.status === 'queued' || reviewRun.status === 'running') ? <LoadingState label={reviewRun.stages.at(-1)?.label ?? t('Reviewing the day', 'Gün değerlendiriliyor')} /> : null}
          {reviewRun?.status === 'failed' ? <Callout tone="warning">{reviewRun.error || t('Daily review could not be completed.', 'Günlük değerlendirme tamamlanamadı.')}</Callout> : null}
          {latestReview ? <ReviewContextCards review={latestReview} /> : !reviewRun ? <EmptyState title={t('No review yet', 'Henüz değerlendirme yok')} description={t('Izge prepares an end-of-day review as daily notes and work are added.', 'Günlük not ve işler eklendikçe İzge gün sonu değerlendirmesi hazırlar.')} /> : null}
        </Panel>
      </div>
      <Panel title={t('Recent changes', 'Son değişiklikler')}>
        {recentSignals.length ? <div className="employee-signal-list">{recentSignals.slice(0, 5).map((signal) => <Link key={signal.signal_id} to={`/signals/${signal.signal_id}`}><strong>{signal.title}</strong><span>{signal.summary}</span><small>{formatDateTime(signal.created_at)}</small></Link>)}</div> : <EmptyState title={t('No new changes', 'Yeni değişiklik yok')} description={t('When Izge finds a new conflict or risk, it will appear here.', 'İzge yeni bir çelişki veya risk bulduğunda burada gösterir.')} />}
      </Panel>
    </div>
  )
}
