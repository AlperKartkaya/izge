import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel } from '../lib/format'
import type { MemoryFilesystemArtifact, MemoryFilesystemRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'

function totalMemoryObjects(artifact: MemoryFilesystemArtifact) {
  return Object.values(artifact.memory_counts).reduce((sum, count) => sum + count, 0)
}

export function MemoryFilesystemPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const [filesystem, setFilesystem] = useState<MemoryFilesystemRead | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }
      try {
        const payload = await api.getMemoryFilesystem(session.token)
        if (!cancelled) {
          setFilesystem(payload)
          setSelectedArtifactId(payload.artifacts[0]?.artifact_id ?? null)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load memory file-system.', 'Hafıza dosya sistemi yüklenemedi.'))
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [session?.token, t])

  const selectedArtifact = useMemo(
    () => filesystem?.artifacts.find((artifact) => artifact.artifact_id === selectedArtifactId) ?? filesystem?.artifacts[0] ?? null,
    [filesystem, selectedArtifactId],
  )

  const totals = useMemo(() => {
    const artifacts = filesystem?.artifacts ?? []
    return {
      artifacts: artifacts.length,
      chunks: artifacts.reduce((sum, artifact) => sum + artifact.chunk_count, 0),
      memory: artifacts.reduce((sum, artifact) => sum + totalMemoryObjects(artifact), 0),
      signals: artifacts.reduce((sum, artifact) => sum + artifact.signal_count, 0),
    }
  }, [filesystem])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Memory file-system', 'Hafıza dosya sistemi')}
        title={t('See how company memory is organized', 'Şirket hafızasının nasıl düzenlendiğini görün')}
        description={t('Source artifacts become chunks, chunks become typed memory, and memory becomes graph edges, signals, traces, and evidence-backed answers. Admins can inspect physical storage paths on the Data page.', 'Kaynaklar bölümlere, bölümler türlenmiş hafızaya; hafıza da grafik bağlantılarına, sinyallere, izlere ve kanıt destekli yanıtlara dönüşür. Yöneticiler fiziksel depolama yollarını Veri sayfasında inceleyebilir.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label={t('Visible artifacts', 'Görünür kaynaklar')} value={totals.artifacts || '—'} detail={t('Source roots in your permission scope.', 'İzin alanınızdaki kaynak kökleri.')} />
        <MetricCard label={t('Indexed chunks', 'İndekslenen bölümler')} value={totals.chunks || '—'} detail={t('Retrieval leaves under the evidence substrate.', 'Kanıt katmanındaki erişim bölümleri.')} />
        <MetricCard label={t('Memory objects', 'Hafıza nesneleri')} value={totals.memory || '—'} detail={t('Decision, assumption, constraint, outcome, commitment rows.', 'Karar, varsayım, kısıt, sonuç ve taahhüt kayıtları.')} />
        <MetricCard label={t('Artifact signals', 'Kaynak sinyalleri')} value={totals.signals || '—'} detail={t('Persisted contradiction, drift, continuity, and action signals.', 'Kaydedilen çelişki, değişim, süreklilik ve eylem sinyalleri.')} />
      </section>

      <Panel title={t('Database organization guide', 'Veritabanı düzenleme rehberi')} description={t('Step-by-step organization rule for making Izge portable to any company workspace.', 'İzge’yi herhangi bir şirket çalışma alanına taşımak için adım adım düzenleme kuralı.')}>
        {filesystem ? (
          <div className="stack-sm">
            {filesystem.organization_guide.map((step) => (
              <article key={step.step} className="panel-subtle stack-sm">
                <p className="section-label">{t('Step', 'Adım')} {step.step}</p>
                <p className="table-primary">{step.title}</p>
                <p className="muted-copy">{step.description}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={t('Loading organization guide', 'Düzenleme rehberi yükleniyor')} description={t('Izge is reading the current workspace memory layers.', 'İzge mevcut çalışma alanının hafıza katmanlarını okuyor.')} />
        )}
      </Panel>

      <div className="two-column-layout wide-right-column">
        <Panel title={t('Memory roots', 'Hafıza kökleri')} description={t('The high-level folders of the internal memory database.', 'Dahili hafıza veritabanının üst düzey klasörleri.')}>
          {filesystem ? (
            <div className="stack-sm">
              {filesystem.roots.map((root) => (
                <article key={root.node_id} className="panel-subtle stack-sm">
                  <div className="timeline-card-head">
                    <p className="table-primary">{root.label}</p>
                    <StatusBadge value={root.node_type} />
                  </div>
                  <p className="table-secondary">{root.status} · {root.children_count} {t('children', 'alt öğe')}</p>
                  <p className="muted-copy">{root.description}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title={t('No roots yet', 'Henüz kök yok')} description={t('Memory roots appear after the system returns the substrate read model.', 'Sistem altyapı okuma modelini döndürdüğünde hafıza kökleri görünür.')} />
          )}
        </Panel>

        <Panel title={t('Artifact organization tree', 'Kaynak düzenleme ağacı')} description={t('Each artifact is shown with its logical locator, trust state, retrieval state, and downstream coverage.', 'Her kaynak mantıksal konumu, güven durumu, erişim durumu ve kapsamıyla gösterilir.')}>
          {!filesystem || filesystem.artifacts.length === 0 ? (
            <EmptyState title={t('No artifacts uploaded', 'Yüklenmiş kaynak yok')} description={t('Upload or paste a source, process it, and return here to inspect the memory file-system.', 'Bir kaynak yükleyin veya yapıştırın, işleyin ve hafıza dosya sistemini incelemek için buraya dönün.')} />
          ) : (
            <div className="stack-sm">
              {filesystem.artifacts.map((artifact) => (
                <button
                  key={artifact.artifact_id}
                  type="button"
                  className={selectedArtifact?.artifact_id === artifact.artifact_id ? 'timeline-card timeline-card-active' : 'timeline-card'}
                  onClick={() => setSelectedArtifactId(artifact.artifact_id)}
                >
                  <div className="timeline-card-head">
                    <p className="table-primary">{artifact.title}</p>
                    <StatusBadge value={artifact.retrieval_state} />
                  </div>
                  <p className="table-secondary">{artifact.organization_path.join(' / ')}</p>
                  <p className="muted-copy">{artifact.storage_locator}</p>
                  <div className="timeline-stats">
                    <span>{artifact.chunk_count} {t('chunks', 'bölüm')}</span>
                    <span>{totalMemoryObjects(artifact)} {t('memory objects', 'hafıza nesnesi')}</span>
                    <span>{artifact.graph_edge_count} {t('edges', 'bağlantı')}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={selectedArtifact ? t('Selected artifact substrate', 'Seçilen kaynak altyapısı') : t('Artifact substrate', 'Kaynak altyapısı')} description={t('Logical metadata for retrieval and trust; admin storage paths are available under Data.', 'Erişim ve güven için mantıksal üst veri; yönetici depolama yolları Veri bölümünde bulunur.')}>
        {selectedArtifact ? (
          <div className="stack-md">
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Logical locator', 'Mantıksal konum')}</p>
                <p className="table-primary">{selectedArtifact.storage_locator}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Checksum', 'Sağlama toplamı')}</p>
                <p className="table-primary">{selectedArtifact.checksum_sha256?.slice(0, 16) ?? t('Unavailable', 'Kullanılamıyor')}…</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Trust boundary', 'Güven sınırı')}</p>
                <p className="table-primary">{formatLabel(selectedArtifact.review_status)}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Updated', 'Güncellendi')}</p>
                <p className="table-primary">{formatDateTime(selectedArtifact.updated_at)}</p>
              </article>
            </div>

            <div className="panel-subtle stack-sm">
              <p className="section-label">{t('Trust boundary', 'Güven sınırı')}</p>
              <p className="muted-copy">{selectedArtifact.trust_boundary}</p>
            </div>

            <div className="two-column-layout">
              <div className="panel-subtle stack-sm">
                <p className="section-label">{t('Memory object coverage', 'Hafıza nesnesi kapsamı')}</p>
                {Object.entries(selectedArtifact.memory_counts).map(([kind, count]) => (
                  <div key={kind} className="stat-row">
                    <span>{formatLabel(kind)}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
              <div className="panel-subtle stack-sm">
                <p className="section-label">{t('Coverage notes', 'Kapsam notları')}</p>
                {selectedArtifact.coverage_notes.map((note) => (
                  <p key={note} className="muted-copy">{note}</p>
                ))}
              </div>
            </div>

            <Link className="secondary-button" to={`/artifacts?artifactId=${selectedArtifact.artifact_id}`}>{t('Open artifact evidence detail', 'Kaynak kanıt ayrıntısını aç')}</Link>
          </div>
        ) : (
          <EmptyState title={t('No artifact selected', 'Kaynak seçilmedi')} description={t('Choose an artifact from the organization tree to inspect its substrate metadata.', 'Altyapı üst verisini incelemek için düzenleme ağacından bir kaynak seçin.')} />
        )}
      </Panel>

      <Panel title={t('Database blueprint', 'Veritabanı planı')} description={t('How the current SQLite database should be organized for any company deployment.', 'Mevcut SQLite veritabanının herhangi bir şirket kurulumu için nasıl düzenlenmesi gerektiği.')}>
        {filesystem ? (
          <div className="stack-sm">
            {filesystem.database_blueprint.map((layer) => (
              <article key={layer.layer} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <p className="table-primary">{layer.layer}</p>
                  <p className="table-secondary">{layer.table_names.join(', ')}</p>
                </div>
                <p className="muted-copy">{layer.purpose}</p>
                <p className="table-secondary">{t('Write path', 'Yazma yolu')}: {layer.write_path}</p>
                <p className="table-secondary">{t('Read path', 'Okuma yolu')}: {layer.read_path}</p>
                <p className="evidence-block">{layer.organization_rule}</p>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
