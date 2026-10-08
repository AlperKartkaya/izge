import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { useEffect, useState, type FormEventHandler } from 'react'
import { useAuth } from '../auth/AuthContext'
import { LoadingState } from '../components/AgentPrimitives'
import { Callout, EmptyState, Panel } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import type { ArtifactRead } from '../lib/types'

function errorMessage(error: unknown) { return error instanceof Error && error.message ? error.message : 'Şirket hafızası yüklenemedi.' }

export function EmployeeMemoryPage() {
  const { session } = useAuth()
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    async function load() { try { const payload = await api.listArtifacts(session!.token); if (!cancelled) { setArtifacts(payload); setError(null) } } catch (caughtError) { if (!cancelled) setError(errorMessage(caughtError)) } finally { if (!cancelled) setLoading(false) } }
    void load()
    return () => { cancelled = true }
  }, [session])

  const submit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault(); if (!session?.token || (!file && !text.trim())) return
    setSaving(true); setError(null); setNotice(null)
    try {
      const artifact = file
        ? await api.uploadArtifact(session.token, { file, title: title.trim() || file.name, visibility_scope: 'workspace', permitted_user_ids: [] })
        : await api.createPastedText(session.token, { title: title.trim() || 'Çalışma notu', text: text.trim(), visibility_scope: 'workspace', permitted_user_ids: [] })
      if (artifact.ingestion_status === 'failed') throw new Error('Kaynak kaydedildi ancak şirket hafızasına işlenemedi.')
      setTitle(''); setText(''); setFile(null); setNotice(artifact.ingestion_status === 'completed' ? 'Kaynak eklendi ve şirket hafızasına işlendi.' : 'Kaynak eklendi; şirket hafızasına işleniyor.'); setArtifacts((current) => [artifact, ...current])
    } catch (caughtError) { setError(errorMessage(caughtError)) } finally { setSaving(false) }
  }

  return <div className="stack-lg"><header className="employee-page-header"><div><p className="eyebrow">Şirket hafızası</p><h1>Kaynaklar</h1><p>İzge’nin yanıtlarında kullanacağı dosyaları ve çalışma notlarını ekleyin.</p></div></header>{error ? <Callout tone="warning">{error}</Callout> : null}{notice ? <Callout>{notice}</Callout> : null}<div className="employee-two-column"><Panel title="Yeni kaynak" description="Bir dosya yükleyin veya kısa bir not yapıştırın."><form className="form-grid" onSubmit={submit}><label className="field"><span className="field-label">Başlık</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Örn. Ekim ürün kararı" /></label><label className="field"><span className="field-label">Dosya</span><input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><div className="auth-divider"><span>veya</span></div><label className="field"><span className="field-label">Metin notu</span><textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} disabled={Boolean(file)} placeholder="Toplantı notu, günlük kayıt veya karar metni…" /></label><button className="primary-button" type="submit" disabled={saving || (!file && !text.trim())}>{saving ? 'Ekleniyor…' : 'Hafızaya ekle'}</button></form></Panel><Panel title="Kullanılabilir kaynaklar" description="Yalnızca erişim izniniz olan kaynaklar görünür.">{loading ? <LoadingState label="Kaynaklar yükleniyor" /> : artifacts.length ? <div className="employee-source-list employee-source-list-scroll" role="region" aria-label="Kullanılabilir kaynaklar" tabIndex={0}>{artifacts.map((artifact) => <article key={artifact.artifact_id}><div><strong>{artifact.title}</strong><span>{formatDateTime(artifact.updated_at)} · {formatStatus(artifact.ingestion_status)}</span></div><SourcePreviewButton artifactId={artifact.artifact_id} title={artifact.title}>Aç</SourcePreviewButton></article>)}</div> : <EmptyState title="Henüz kaynak yok" description="İlk dosyanızı veya notunuzu ekleyin." />}</Panel></div></div>
}
