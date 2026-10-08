import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadingState } from '../components/AgentPrimitives'
import { Callout, EmptyState, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import type { SignalDetail } from '../lib/types'

export function SignalDetailPage() {
  const { signalId = '' } = useParams()
  const { session } = useAuth()
  const [detail, setDetail] = useState<SignalDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.token || !signalId) return
    let cancelled = false
    api.getSignal(session.token, signalId)
      .then((payload) => { if (!cancelled) setDetail(payload) })
      .catch((caughtError) => { if (!cancelled) setError(caughtError instanceof ApiError && caughtError.message ? caughtError.message : 'Değişiklik ayrıntısı yüklenemedi.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session?.token, signalId])

  return <div className="stack-lg">
    <header className="employee-page-header"><div><p className="eyebrow">İzge’nin tespiti</p><h1>{detail?.title ?? 'Değişiklik ayrıntısı'}</h1><p>Bu tespitin dayandığı kaynakları ve İzge’nin önerisini inceleyin.</p></div><Link className="secondary-button" to="/">Ana sayfaya dön</Link></header>
    {error ? <Callout tone="warning">{error}</Callout> : null}
    {loading ? <LoadingState label="Ayrıntı yükleniyor" /> : null}
    {!loading && !detail && !error ? <EmptyState title="Değişiklik bulunamadı" description="Bu kayıt erişim alanınızda olmayabilir." /> : null}
    {detail ? <>
      <Panel title="Ne değişti?" description={`${formatStatus(detail.signal_type)} · ${formatDateTime(detail.updated_at)}`}><div className="stack-md"><p className="table-primary">{detail.summary}</p><p className="muted-copy">{detail.grounded_reasoning}</p>{detail.recommended_action ? <div className="panel-subtle action-card"><p className="section-label">Önerilen sonraki adım</p><p>{detail.recommended_action}</p></div> : null}</div></Panel>
      <Panel title="Kaynaklar" description="İzge bu tespiti erişebildiğiniz aşağıdaki kayıtlara dayandırdı.">{detail.supporting_evidence.length ? <div className="employee-source-list">{detail.supporting_evidence.map((evidence, index) => <article key={`${evidence.artifact_id}-${evidence.chunk_id}-${index}`}><div><strong>{evidence.artifact_title}</strong><span>{evidence.excerpt}</span></div><SourcePreviewButton artifactId={evidence.artifact_id} title={evidence.artifact_title}>Aç</SourcePreviewButton></article>)}</div> : <EmptyState title="Görünür kaynak yok" description="Bu kayıt için erişebildiğiniz bir kaynak alıntısı bulunmuyor." />}</Panel>
    </> : null}
  </div>
}
