import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadingState } from '../components/AgentPrimitives'
import { Callout, EmptyState, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { AutomationRead } from '../lib/types'

const templates = [
  ['Günlük iş özeti', 'Bugünkü işleri, açık riskleri ve yarın için önerilen öncelikleri özetle.', '16:00'],
  ['Faturalanmamış işleri kontrol et', 'Sözleşmeler, müşteri talepleri, tamamlanan işler ve faturalar arasında ücretlendirilmemiş olabilecek ek işleri kontrol et.', '17:00'],
  ['Unutulan müşteri taleplerini bul', 'Müşteri konuşmalarındaki söz verilmiş ancak sorumlusu veya takip işi olmayan talepleri bul.', '09:00'],
  ['Müşteri kaybı riskini kontrol et', 'Tekrar eden ve çözülemeyen müşteri sorunlarını birleştir; müşteri kaybı riski taşıyanları bildir.', '09:30'],
  ['Teklif dosyalarını kontrol et', 'Aktif teklif ve ihale şartlarındaki zorunlu belgeleri hazırlanan dosyalarla karşılaştır; eksikleri bildir.', '15:00'],
  ['Tekrarlayan sorunları bul', 'Olay kayıtlarında tekrar eden problemleri, geçici müdahaleleri ve çözülmemiş kök nedenleri bul.', '16:30'],
  ['Bekleyen ekip işlerini bul', 'Başka ekip veya kişi onayı bekleyen ancak karşı tarafa açıkça aktarılmamış işleri bul.', '10:00'],
] as const

function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError && error.message ? error.message : fallback }

export function AutomationsPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<AutomationRead[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [scheduleTime, setScheduleTime] = useState('16:00')
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.token) return
    api.listAutomations(session.token).then(setItems).catch((caughtError) => setError(errorMessage(caughtError, 'Otomasyonlar yüklenemedi.'))).finally(() => setIsLoading(false))
  }, [session?.token])

  function selectTemplate(template: (typeof templates)[number]) {
    setTitle(template[0]); setPrompt(template[1]); setScheduleTime(template[2]); setShowForm(true)
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session?.token) return
    setBusyId('new'); setError(null)
    try {
      const created = await api.createAutomation(session.token, { title: title.trim(), prompt: prompt.trim(), schedule_time: scheduleTime })
      setItems((current) => [...current, created]); setShowForm(false); setTitle(''); setPrompt(''); setScheduleTime('16:00')
    } catch (caughtError) { setError(errorMessage(caughtError, 'Otomasyon oluşturulamadı.')) }
    finally { setBusyId(null) }
  }

  async function toggle(item: AutomationRead) {
    if (!session?.token) return
    setBusyId(item.automation_id)
    try {
      const updated = await api.updateAutomation(session.token, item.automation_id, { enabled: !item.enabled })
      setItems((current) => current.map((value) => value.automation_id === updated.automation_id ? updated : value))
    } catch (caughtError) { setError(errorMessage(caughtError, 'Otomasyon güncellenemedi.')) }
    finally { setBusyId(null) }
  }

  async function run(item: AutomationRead) {
    if (!session?.token) return
    setBusyId(item.automation_id)
    try {
      const created = await api.runAutomation(session.token, item.automation_id)
      navigate(`/query?thread=${encodeURIComponent(created.thread_id)}&run=${encodeURIComponent(created.run_id)}`)
    } catch (caughtError) { setError(errorMessage(caughtError, 'Otomasyon başlatılamadı.')) }
    finally { setBusyId(null) }
  }

  return <div className="stack-lg automations-page">
    <header className="employee-page-header"><div><p className="eyebrow">İzge sizin için takipte</p><h1>Otomasyonlar</h1><p>İzge’nin her gün belirlediğiniz saatte kontrol edeceği rutin işleri yönetin.</p></div><button type="button" className="primary-button" onClick={() => setShowForm((value) => !value)}>+ Yeni otomasyon</button></header>
    {error ? <Callout tone="warning">{error}</Callout> : null}
    {showForm ? <Panel title="Yeni otomasyon" description="Bir örnek seçin veya İzge’nin yapacağı kontrolü yazın."><div className="automation-templates">{templates.map((template) => <button type="button" key={template[0]} onClick={() => selectTemplate(template)}><strong>{template[0]}</strong><small>{template[2]}</small></button>)}<button type="button" disabled title="Mailbox bağlantısı henüz kurulmadı"><strong>Mailbox kontrolü</strong><small>Bağlantı gerekli</small></button></div><form className="form-grid automation-form" onSubmit={create}><label className="field"><span className="field-label">Başlık</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label className="field"><span className="field-label">İzge neyi kontrol etsin?</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} required /></label><label className="field"><span className="field-label">Her gün (İstanbul)</span><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} required /></label><button type="submit" className="primary-button" disabled={busyId === 'new'}>{busyId === 'new' ? 'Oluşturuluyor…' : 'Otomasyonu oluştur'}</button></form></Panel> : null}
    <Panel title="Rutin işler" description="Etkin otomasyonlar İstanbul saatine göre çalışır.">{isLoading ? <LoadingState label="Otomasyonlar yükleniyor" /> : items.length ? <div className="automation-list">{items.map((item) => <article key={item.automation_id} className="automation-item"><div><span className={item.enabled ? 'status-badge' : 'status-badge status-muted'}>{item.enabled ? 'Etkin' : 'Duraklatıldı'}</span><strong>{item.title}</strong><p>{item.prompt}</p><small>Her gün {item.schedule_time} · {item.last_run_at ? `Son çalışma ${formatDateTime(item.last_run_at)}` : 'Henüz çalışmadı'}</small></div><div className="automation-actions"><button type="button" className="secondary-button" disabled={busyId === item.automation_id} onClick={() => void run(item)}>Şimdi çalıştır</button><button type="button" className="text-button" disabled={busyId === item.automation_id} onClick={() => void toggle(item)}>{item.enabled ? 'Duraklat' : 'Etkinleştir'}</button></div></article>)}</div> : <EmptyState title="Henüz otomasyon yok" description="Günlük özetle başlayabilir veya senaryonuza uygun bir kontrol seçebilirsiniz." />}</Panel>
  </div>
}
