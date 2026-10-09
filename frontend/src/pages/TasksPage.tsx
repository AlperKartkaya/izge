import { useEffect, useState, type FormEventHandler } from 'react'
import { useAuth } from '../auth/AuthContext'
import { LoadingState, TaskRows } from '../components/AgentPrimitives'
import { Callout, EmptyState, Panel } from '../components/ui'
import { api } from '../lib/api'
import type { UserRead, WorkTaskRead, WorkTaskStatus } from '../lib/types'
import { useLanguage } from '../lib/i18n'

function toIso(value: string) { return value ? new Date(`${value}+03:00`).toISOString() : null }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback }

export function TasksPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const [tasks, setTasks] = useState<WorkTaskRead[]>([])
  const [colleagues, setColleagues] = useState<UserRead[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState(session?.user.user_id ?? '')
  const [dueAt, setDueAt] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [logText, setLogText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    async function load() {
      try {
        const [taskList, directory] = await Promise.all([api.listWorkTasks(session!.token), api.listColleagues(session!.token)])
        if (!cancelled) { setTasks(taskList); setColleagues([session!.user, ...directory.filter((user) => user.user_id !== session!.user.user_id)]); setError(null) }
      } catch (caughtError) { if (!cancelled) setError(errorMessage(caughtError, t('Work could not be loaded.', 'İşler yüklenemedi.'))) }
      finally { if (!cancelled) setIsLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [session, t])

  const createTask: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token || !title.trim()) return
    setIsSaving(true); setError(null); setNotice(null)
    try {
      const task = await api.createWorkTask(session.token, { title: title.trim(), description: description.trim() || null, assignee_user_id: assignee || null, due_at: toIso(dueAt), remind_at: toIso(remindAt), source_artifact_ids: [] })
      setTasks((current) => [task, ...current]); setTitle(''); setDescription(''); setDueAt(''); setRemindAt(''); setNotice(t('Task created.', 'İş oluşturuldu.'))
    } catch (caughtError) { setError(errorMessage(caughtError, t('Task could not be created.', 'İş oluşturulamadı.'))) }
    finally { setIsSaving(false) }
  }

  async function updateStatus(task: WorkTaskRead, status: WorkTaskStatus) {
    if (!session?.token) return
    try {
      const updated = await api.updateWorkTask(session.token, task.task_id, { status })
      setTasks((current) => current.map((item) => item.task_id === updated.task_id ? updated : item))
    } catch (caughtError) { setError(errorMessage(caughtError, t('Task status could not be updated.', 'İş durumu güncellenemedi.'))) }
  }

  const saveLog: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token || !logText.trim()) return
    setIsSaving(true); setError(null); setNotice(null)
    try {
      const day = new Intl.DateTimeFormat(t('en-US', 'tr-TR'), { dateStyle: 'long', timeZone: 'Europe/Istanbul' }).format(new Date())
      const artifact = await api.createPastedText(session.token, { title: `${session.user.display_name} · ${t('Daily work note', 'Günlük çalışma notu')} · ${day}`, text: logText.trim(), visibility_scope: 'workspace', permitted_user_ids: [] })
      if (artifact.ingestion_status === 'failed') throw new Error(t('The daily note was saved but could not be processed into company memory.', 'Günlük not kaydedildi ancak şirket hafızasına işlenemedi.'))
      setLogText(''); setNotice(artifact.ingestion_status === 'completed' ? t('Daily note saved and processed into company memory.', 'Günlük not kaydedildi ve şirket hafızasına işlendi.') : t('Daily note saved; it is being processed into company memory.', 'Günlük not kaydedildi; şirket hafızasına işleniyor.'))
    } catch (caughtError) { setError(errorMessage(caughtError, t('Daily note could not be saved.', 'Günlük not kaydedilemedi.'))) }
    finally { setIsSaving(false) }
  }

  return (
    <div className="stack-lg">
      <header className="employee-page-header"><div><p className="eyebrow">{t('Daily work', 'Günlük çalışma')}</p><h1>{t('My work', 'İşlerim')}</h1><p>{t('Keep your work, reminders, and notes for Izge to review at the end of the day in one place.', 'İşlerinizi, hatırlatmalarınızı ve gün sonunda İzge’nin değerlendireceği çalışma notlarınızı tek yerde tutun.')}</p></div></header>
      {error ? <Callout tone="warning">{error}</Callout> : null}{notice ? <Callout>{notice}</Callout> : null}
      <div className="employee-two-column">
        <Panel title={t('Open work', 'Açık işler')} description={t('Use the status control to move work between open, in progress, and completed.', 'Bir işi açık, devam ediyor ve tamamlandı durumları arasında taşımak için durum kontrolünü kullanın.')}>
          {isLoading ? <LoadingState label={t('Loading work', 'İşler yükleniyor')} /> : tasks.length ? <TaskRows tasks={tasks} onStatusChange={updateStatus} /> : <EmptyState title={t('No work yet', 'Henüz iş yok')} description={t('Create your first task using the form on the right.', 'İlk işinizi sağdaki formdan oluşturun.')} />}
        </Panel>
        <Panel title={t('New task', 'Yeni iş')} description={t('Add an owner, due time, and reminder if needed.', 'Gerekliyse sorumlu, bitiş ve hatırlatma zamanı ekleyin.')}>
          <form className="form-grid" onSubmit={createTask}>
            <label className="field"><span className="field-label">{t('Task title', 'İş başlığı')}</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
            <label className="field"><span className="field-label">{t('Description', 'Açıklama')}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
            <label className="field"><span className="field-label">{t('Owner', 'Sorumlu')}</span><select value={assignee} onChange={(event) => setAssignee(event.target.value)}>{colleagues.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name}</option>)}</select></label>
            <div className="form-grid form-grid-two"><label className="field"><span className="field-label">{t('Due time (Istanbul)', 'Bitiş zamanı (İstanbul)')}</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><label className="field"><span className="field-label">{t('Reminder (Istanbul)', 'Hatırlatma (İstanbul)')}</span><input type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} /></label></div>
            <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? t('Saving…', 'Kaydediliyor…') : t('Create task', 'İşi oluştur')}</button>
          </form>
        </Panel>
      </div>
      <Panel title={t('Daily work note', 'Günlük çalışma notu')} description={t('Write what you did today. Izge uses this record as a source in later questions and the end-of-day review.', 'Bugün yaptıklarınızı yazın. İzge bu kaydı sonraki sorularında ve gün sonu değerlendirmesinde kaynak olarak kullanır.')}>
        <form className="daily-log-form" onSubmit={saveLog}><label className="field"><span className="field-label">{t('What did you do today, what changed, and where are you blocked?', 'Bugün ne yaptınız, ne değişti, nerede takıldınız?')}</span><textarea value={logText} onChange={(event) => setLogText(event.target.value)} rows={5} minLength={10} required /></label><button type="submit" className="primary-button" disabled={isSaving}>{isSaving ? t('Saving…', 'Kaydediliyor…') : t('Save daily note', 'Günlük notu kaydet')}</button></form>
      </Panel>
    </div>
  )
}
