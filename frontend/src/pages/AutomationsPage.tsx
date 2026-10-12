import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ButtonIcon } from '../components/ButtonIcon'
import { LoadingState } from '../components/AgentPrimitives'
import { Callout, EmptyState, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { automationFrequencyLabel, automationRunStatusLabel, istanbulDateInput, istanbulStartToIso, nextRunRemaining } from '../lib/automationSchedule'
import { formatDateTime } from '../lib/format'
import { useLanguage } from '../lib/i18n'
import type { AutomationFrequency, AutomationRead } from '../lib/types'

const templates = [
  ['Günlük iş özeti', 'Bugünkü işleri, açık riskleri ve yarın için önerilen öncelikleri özetle.', '16:00', 'Daily work summary', 'Summarize today\'s work, open risks, and recommended priorities for tomorrow.'],
  ['Faturalanmamış işleri kontrol et', 'Sözleşmeler, müşteri talepleri, tamamlanan işler ve faturalar arasında ücretlendirilmemiş olabilecek ek işleri kontrol et.', '17:00', 'Check unbilled work', 'Compare contracts, customer requests, completed work, and invoices for potentially unbilled extra work.'],
  ['Unutulan müşteri taleplerini bul', 'Müşteri konuşmalarındaki söz verilmiş ancak sorumlusu veya takip işi olmayan talepleri bul.', '09:00', 'Find forgotten customer requests', 'Find promised customer requests that have no owner or follow-up task.'],
  ['Müşteri kaybı riskini kontrol et', 'Tekrar eden ve çözülemeyen müşteri sorunlarını birleştir; müşteri kaybı riski taşıyanları bildir.', '09:30', 'Check customer churn risk', 'Combine recurring unresolved customer issues and report those that pose a churn risk.'],
  ['Teklif dosyalarını kontrol et', 'Aktif teklif ve ihale şartlarındaki zorunlu belgeleri hazırlanan dosyalarla karşılaştır; eksikleri bildir.', '15:00', 'Check proposal files', 'Compare mandatory active proposal and tender documents with prepared files and report what is missing.'],
  ['Tekrarlayan sorunları bul', 'Olay kayıtlarında tekrar eden problemleri, geçici müdahaleleri ve çözülmemiş kök nedenleri bul.', '16:30', 'Find recurring problems', 'Find recurring problems, temporary interventions, and unresolved root causes in incident records.'],
  ['Bekleyen ekip işlerini bul', 'Başka ekip veya kişi onayı bekleyen ancak karşı tarafa açıkça aktarılmamış işleri bul.', '10:00', 'Find stalled team work', 'Find work waiting for another team or person that was not clearly handed over.'],
] as const

const frequencies: AutomationFrequency[] = ['hourly', 'every_6_hours', 'daily', 'weekly']
function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError && error.message ? error.message : fallback }

export function AutomationsPage() {
  const { language, t } = useLanguage()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<AutomationRead[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [frequency, setFrequency] = useState<AutomationFrequency>('daily')
  const [startDate, setStartDate] = useState(() => istanbulDateInput())
  const [scheduleTime, setScheduleTime] = useState('16:00')
  const [now, setNow] = useState(() => new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const mutationVersion = useRef(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    const load = async () => {
      const version = mutationVersion.current
      try {
        const loaded = await api.listAutomations(session.token)
        if (!cancelled && version === mutationVersion.current) { setItems(loaded); setError(null) }
      } catch (caughtError) {
        if (!cancelled) setError(errorMessage(caughtError, t('Automations could not be loaded.', 'Otomasyonlar yüklenemedi.')))
      } finally { if (!cancelled) setIsLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => { setNow(new Date()); void load() }, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [session?.token, t])

  function selectTemplate(template: (typeof templates)[number]) {
    setTitle(t(template[3], template[0]))
    setPrompt(t(template[4], template[1]))
    setFrequency('daily')
    setScheduleTime(template[2])
    setShowForm(true)
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session?.token) return
    mutationVersion.current += 1
    setBusyId('new'); setError(null)
    try {
      const created = await api.createAutomation(session.token, {
        title: title.trim(), prompt: prompt.trim(), frequency, schedule_time: scheduleTime,
        starts_at: istanbulStartToIso(startDate, scheduleTime),
      })
      setItems((current) => [created, ...current])
      setShowForm(false); setTitle(''); setPrompt(''); setFrequency('daily'); setScheduleTime('16:00')
    } catch (caughtError) { setError(errorMessage(caughtError, t('Automation could not be created.', 'Otomasyon oluşturulamadı.'))) }
    finally { setBusyId(null) }
  }

  async function toggle(item: AutomationRead) {
    if (!session?.token) return
    mutationVersion.current += 1
    setBusyId(item.automation_id); setError(null)
    try {
      const updated = await api.updateAutomation(session.token, item.automation_id, { enabled: !item.enabled })
      setItems((current) => current.map((value) => value.automation_id === updated.automation_id ? updated : value))
    } catch (caughtError) { setError(errorMessage(caughtError, t('Automation could not be updated.', 'Otomasyon güncellenemedi.'))) }
    finally { setBusyId(null) }
  }

  async function run(item: AutomationRead) {
    if (!session?.token) return
    mutationVersion.current += 1
    setBusyId(item.automation_id); setError(null)
    try {
      const created = await api.runAutomation(session.token, item.automation_id)
      navigate(`/query?thread=${encodeURIComponent(created.thread_id)}&run=${encodeURIComponent(created.run_id)}`)
    } catch (caughtError) { setError(errorMessage(caughtError, t('Automation could not be started.', 'Otomasyon başlatılamadı.'))) }
    finally { setBusyId(null) }
  }

  async function remove(item: AutomationRead) {
    if (confirmDeleteId !== item.automation_id) { setConfirmDeleteId(item.automation_id); return }
    if (!session?.token) return
    mutationVersion.current += 1
    setBusyId(item.automation_id); setError(null)
    try {
      await api.deleteAutomation(session.token, item.automation_id)
      setItems((current) => current.filter((value) => value.automation_id !== item.automation_id))
      setConfirmDeleteId(null)
    } catch (caughtError) { setError(errorMessage(caughtError, t('Automation could not be deleted.', 'Otomasyon silinemedi.'))) }
    finally { setBusyId(null) }
  }

  function openHistory(item: AutomationRead) {
    navigate(`/query?thread=${encodeURIComponent(`automation:${item.automation_id}`)}${item.last_run_id ? `&run=${encodeURIComponent(item.last_run_id)}` : ''}`)
  }

  return <div className="stack-lg automations-page">
    <header className="employee-page-header">
      <div><h1>{t('Automations', 'Otomasyonlar')}</h1><p>{t('Schedule recurring checks and review their results.', 'Tekrarlanan kontrolleri planlayın, sonuçlarını inceleyin.')}</p></div>
      <button type="button" className="primary-button icon-button" aria-label={t('New automation', 'Yeni otomasyon')} title={t('New automation', 'Yeni otomasyon')} onClick={() => setShowForm((value) => !value)}><ButtonIcon name="add" /></button>
    </header>
    {error ? <Callout tone="warning">{error}</Callout> : null}
    {showForm ? <Panel title={t('New automation', 'Yeni otomasyon')} description={t('Choose an example or describe the check Izge should perform.', 'Bir örnek seçin veya İzge’nin yapacağı kontrolü yazın.')}>
      <div className="automation-templates">{templates.map((template) => <button type="button" key={template[0]} onClick={() => selectTemplate(template)}><strong>{t(template[3], template[0])}</strong><small>{template[2]}</small></button>)}<button type="button" disabled title={t('Email connection has not been configured yet', 'E-posta bağlantısı henüz kurulmadı')}><strong>{t('Email check', 'E-posta kontrolü')}</strong><small>{t('Connection required', 'Bağlantı gerekli')}</small></button></div>
      <form className="form-grid automation-form" onSubmit={create}>
        <label className="field"><span className="field-label">{t('Title', 'Başlık')}</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        <label className="field"><span className="field-label">{t('What should Izge check?', 'İzge neyi kontrol etsin?')}</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} required /></label>
        <div className="automation-schedule-fields">
          <label className="field"><span className="field-label">{t('Frequency', 'Sıklık')}</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as AutomationFrequency)}>{frequencies.map((value) => <option key={value} value={value}>{automationFrequencyLabel(value, language)}</option>)}</select></label>
          <label className="field"><span className="field-label">{t('Start date', 'Başlangıç tarihi')}</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <label className="field"><span className="field-label">{t('Start time (Istanbul)', 'Başlangıç saati (İstanbul)')}</span><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} required /></label>
        </div>
        <button type="submit" className="primary-button" disabled={busyId === 'new'}>{busyId === 'new' ? t('Creating…', 'Oluşturuluyor…') : t('Create active automation', 'Aktif otomasyon oluştur')}</button>
      </form>
    </Panel> : null}
    <Panel title={t('Routine tasks', 'Rutin işler')}>
      {isLoading ? <LoadingState label={t('Loading automations', 'Otomasyonlar yükleniyor')} /> : items.length ? <div className="automation-list">{items.map((item) => {
        const remaining = nextRunRemaining(item.next_run_at, now, language)
        return <article key={item.automation_id} className="automation-item">
          <div className="automation-item-copy">
            <div className="automation-status-line"><span className={item.enabled ? 'status-badge' : 'status-badge status-muted'}>{item.enabled ? t('Active', 'Aktif') : t('Stopped', 'Durduruldu')}</span>{item.enabled && remaining ? <span>{remaining}</span> : null}</div>
            <strong>{item.title}</strong>
            <details className="automation-instructions"><summary>{t('What Izge checks', 'İzge’nin kontrol ettiği')}</summary><p>{item.prompt}</p></details>
            <div className="automation-run-state"><span>{automationFrequencyLabel(item.frequency, language)} · {item.schedule_time} {t('Istanbul time', 'İstanbul saati')}</span>{item.last_run_id && item.last_run_status ? <button type="button" onClick={() => openHistory(item)}>{item.last_run_at ? `${automationRunStatusLabel(item.last_run_status, language)} · ${formatDateTime(item.last_run_at)}` : automationRunStatusLabel(item.last_run_status, language)}</button> : <span>{t('Not run yet', 'Henüz çalışmadı')}</span>}</div>
          </div>
          <div className="automation-actions">
            <button type="button" className="secondary-button" disabled={busyId === item.automation_id} onClick={() => void run(item)}><ButtonIcon name="run" />{t('Run now', 'Hemen çalıştır')}</button>
            <button type="button" className="secondary-button" disabled={busyId === item.automation_id} onClick={() => void toggle(item)}><ButtonIcon name={item.enabled ? 'pause' : 'run'} />{item.enabled ? t('Stop', 'Durdur') : t('Resume', 'Devam ettir')}</button>
            <button type="button" className={`text-button icon-button automation-danger-action${confirmDeleteId === item.automation_id ? ' automation-delete-confirm' : ''}`} disabled={busyId === item.automation_id} aria-label={confirmDeleteId === item.automation_id ? t('Confirm delete', 'Silmeyi onayla') : t('Delete automation', 'Otomasyonu sil')} title={confirmDeleteId === item.automation_id ? t('Click again to confirm', 'Onaylamak için tekrar tıklayın') : t('Delete automation', 'Otomasyonu sil')} onBlur={() => setConfirmDeleteId(null)} onClick={() => void remove(item)}><ButtonIcon name="delete" /></button>
          </div>
        </article>
      })}</div> : <EmptyState title={t('No automations yet', 'Henüz otomasyon yok')} description={t('Start with a daily summary or choose a check for your scenario.', 'Günlük özetle başlayabilir veya senaryonuza uygun bir kontrol seçebilirsiniz.')} />}
    </Panel>
  </div>
}
