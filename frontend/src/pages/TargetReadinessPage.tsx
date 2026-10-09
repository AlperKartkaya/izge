import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatPercent } from '../lib/format'
import type { ReadinessAreaStatus, TargetReadinessAreaRead, TargetReadinessRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'

function areaCardClass(status: ReadinessAreaStatus): string {
  if (status === 'implemented') {
    return 'panel-subtle stack-sm action-card'
  }
  if (status === 'planned') {
    return 'panel-subtle stack-sm critical-card'
  }
  return 'panel-subtle stack-sm drift-card'
}

function snapshotValue(snapshot: Record<string, unknown> | undefined, key: string): string | number {
  const value = snapshot?.[key]
  if (typeof value === 'number' || typeof value === 'string') {
    return value
  }
  return '—'
}

function statusCount(readiness: TargetReadinessRead | null, status: ReadinessAreaStatus): number {
  return readiness?.status_counts[status] ?? 0
}

function topGaps(areas: TargetReadinessAreaRead[]) {
  return [...areas]
    .filter((area) => area.status !== 'implemented' || area.remaining_work.length > 0)
    .sort((left, right) => left.score - right.score)
    .slice(0, 4)
}

export function TargetReadinessPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const [readiness, setReadiness] = useState<TargetReadinessRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }
      setIsLoading(true)
      setError(null)
      try {
        const payload = await api.getTargetReadiness(session.token)
        if (!cancelled) {
          setReadiness(payload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load target readiness.', 'Hedef hazırlık durumu yüklenemedi.'))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [session?.token, t])

  const gaps = useMemo(() => topGaps(readiness?.areas ?? []), [readiness?.areas])
  const snapshot = readiness?.current_workspace_snapshot

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Operational readiness', 'Operasyonel hazırlık')}
        title={t('Check company-portable memory-system coverage', 'Şirketler arası taşınabilir hafıza sistemi kapsamını kontrol edin')}
        description={t('This page maps product requirements to current workspace proof: evidence substrate, temporal graph, typed context packets, bounded orchestration, private AI discipline, scenario support, and Docker portability.', 'Bu sayfa ürün gereksinimlerini mevcut çalışma alanı kanıtlarıyla eşler: kanıt altyapısı, zamansal grafik, türlenmiş bağlam paketleri, sınırlı orkestrasyon, özel yapay zekâ disiplini, senaryo desteği ve Docker taşınabilirliği.')}
        actions={
          <div className="inline-actions">
            <Link className="secondary-button" to="/memory-filesystem">{t("Inspect memory FS", "Hafıza dosya sistemini incele")}</Link>
            <Link className="primary-button" to="/orchestration">{t("Inspect orchestration", "İş akışını incele")}</Link>
          </div>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label={t('Target score', 'Hedef puanı')} value={readiness ? formatPercent(readiness.target_score) : '—'} detail={t('Average of implemented, partial, and planned target areas.', 'Tamamlanan, kısmi ve planlanan hedef alanlarının ortalaması.')} />
        <MetricCard label={t('Implemented', 'Tamamlandı')} value={readiness ? statusCount(readiness, 'implemented') : '—'} detail={t('Requirements reflected in the current product surface with proof routes.', 'Kanıt yollarıyla mevcut ürün yüzeyine yansıyan gereksinimler.')} />
        <MetricCard label={t('Partial', 'Kısmi')} value={readiness ? statusCount(readiness, 'partial') : '—'} detail={t('Visible foundations exist, but stronger persistence, runtime, and evaluation remain.', 'Görünür temeller var ancak daha güçlü kalıcılık, çalışma zamanı ve değerlendirme gerekiyor.')} />
        <MetricCard label={t('Planned', 'Planlandı')} value={readiness ? statusCount(readiness, 'planned') : '—'} detail={t('Known target work not yet ready to claim.', 'Henüz tamamlandığı söylenemeyen bilinen hedef işleri.')} />
        <MetricCard label={t('Workspace proof', 'Çalışma alanı kanıtı')} value={snapshotValue(snapshot, 'memory_object_count')} detail={t('Typed memory objects currently visible in this workspace.', 'Bu çalışma alanında görünen türlenmiş hafıza nesneleri.')} />
      </section>

      <Panel title={t('Current workspace evidence snapshot', 'Mevcut çalışma alanı kanıt özeti')} description={t('Fast proof that the readiness score is grounded in real workspace state, not static copy.', 'Hazırlık puanının sabit metne değil gerçek çalışma alanı durumuna dayandığının hızlı kanıtı.')}>
        {readiness ? (
          <div className="detail-grid">
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('Artifacts', 'Kaynaklar')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'visible_artifact_count')}</p>
              <p className="muted-copy">{t('Visible sources in the current permission scope.', 'Mevcut izin alanındaki görünür kaynaklar.')}</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('Chunks', 'Bölümler')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'indexed_chunk_count')}</p>
              <p className="muted-copy">{t('Retrieval leaves under the internal memory file-system.', 'Dahili hafıza dosya sistemi altındaki erişim bölümleri.')}</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('Stage runs', 'Aşama çalışmaları')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'stage_run_count')}</p>
              <p className="muted-copy">{t('Persisted bounded orchestration ledger rows.', 'Kaydedilen sınırlı orkestrasyon kayıtları.')}</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('Stage packet traces', 'Aşama paketi izleri')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'stage_packet_trace_count')}</p>
              <p className="muted-copy">{t('Bounded local sub-agent packet executions.', 'Sınırlı yerel alt ajan paketi çalışmaları.')}</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('Temporal families', 'Zamansal aileler')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'claim_family_count')}</p>
              <p className="muted-copy">{t('Persisted claim-family projection rows.', 'Kaydedilen ifade ailesi yansıtma kayıtları.')}</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('Scenario runs', 'Senaryo çalışmaları')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'scenario_run_count')}</p>
              <p className="muted-copy">{t('Stored scenario packets available for replay.', 'Yeniden oynatılabilir kayıtlı senaryo paketleri.')}</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('LLM gateway', 'LLM geçidi')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'local_llm_gateway_status')}</p>
              <p className="muted-copy">{t('Live readiness when local/private AI flags are enabled.', 'Yerel/özel yapay zekâ etkinleştirildiğinde canlı hazırlık durumu.')}</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">{t('Signals', 'Sinyaller')}</p>
              <p className="table-primary">{snapshotValue(snapshot, 'active_signal_count')}</p>
              <p className="muted-copy">{t('Evidence-backed contradiction, drift, continuity, or next-action outputs.', 'Kanıt destekli çelişki, değişim, süreklilik veya sonraki eylem çıktıları.')}</p>
            </article>
          </div>
        ) : (
          <EmptyState title={isLoading ? t('Loading readiness', 'Hazırlık durumu yükleniyor') : t('No readiness payload', 'Hazırlık verisi yok')} description={t('Izge is reading the current workspace proof state.', 'İzge mevcut çalışma alanı kanıt durumunu okuyor.')} />
        )}
      </Panel>

      <Panel title={t('Requirement coverage', 'Gereksinim kapsamı')} description={t('Each area states the requirement, current product reflection, proof routes, and remaining work before the target is complete.', 'Her alan hedef tamamlanmadan önce gereksinimi, mevcut ürün karşılığını, kanıt yollarını ve kalan işi gösterir.')}>
        {readiness ? (
          <div className="stack-sm">
            {readiness.areas.map((area) => (
              <article key={area.area_key} className={areaCardClass(area.status)}>
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{formatPercent(area.score)} {t('complete', 'tamamlandı')}</p>
                    <p className="table-primary">{area.title}</p>
                  </div>
                  <StatusBadge value={area.status} />
                </div>
                <p className="muted-copy">{area.promise}</p>
                <p className="evidence-block">{t('Current product state', 'Mevcut ürün durumu')}: {area.demo_reflection}</p>

                <div className="two-column-layout">
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">{t('Proof signals', 'Kanıt sinyalleri')}</p>
                    {area.proof_signals.map((signal) => (
                      <p key={`${area.area_key}-${signal.label}`} className="table-secondary">
                        {signal.label}: <strong>{signal.value}</strong>{signal.route ? ` · ${signal.route}` : ''}
                      </p>
                    ))}
                  </div>
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">{t('Product surfaces', 'Ürün yüzeyleri')}</p>
                    {area.demo_surfaces.map((surface) => (
                      <p key={`${area.area_key}-${surface}`} className="table-secondary">{surface}</p>
                    ))}
                  </div>
                </div>

                <div className="panel-subtle stack-sm">
                  <p className="section-label">{t('Remaining work', 'Kalan iş')}</p>
                  {area.remaining_work.map((item) => <p key={item} className="muted-copy">{item}</p>)}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="two-column-layout">
        <Panel title={t('Closest gaps', 'En yakın eksikler')} description={t('The lowest-scored or still-active gaps that define the next implementation passes.', 'Sonraki uygulama adımlarını belirleyen düşük puanlı veya hâlâ etkin eksikler.')}>
          {gaps.length > 0 ? (
            <div className="stack-sm">
              {gaps.map((area) => (
                <article key={area.area_key} className="panel-subtle stack-sm">
                  <div className="timeline-card-head">
                    <p className="table-primary">{area.title}</p>
                    <p className="table-secondary">{formatPercent(area.score)}</p>
                  </div>
                  {area.remaining_work.slice(0, 2).map((item) => <p key={item} className="muted-copy">{item}</p>)}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title={t('No gaps ranked yet', 'Henüz sıralanmış eksik yok')} description={t('Readiness gaps appear after the system returns target areas.', 'Sistem hedef alanlarını döndürdüğünde hazırlık eksikleri görünür.')} />
          )}
        </Panel>

        <Panel title={t('Next best passes', 'Sonraki en iyi adımlar')} description={t('Implementation order that preserves the evidence-first architecture.', 'Kanıt öncelikli mimariyi koruyan uygulama sırası.')}>
          {readiness ? (
            <div className="stack-sm">
              {readiness.next_best_passes.map((item, index) => (
                <article key={item} className="panel-subtle stack-sm">
                  <p className="section-label">{t('Pass', 'Adım')} {index + 1}</p>
                  <p className="muted-copy">{item}</p>
                </article>
              ))}
              <p className="table-secondary">{t('Gate', 'Kontrol')}: {readiness.evaluator_gate.name}</p>
              <p className="evidence-block">{t('Updated', 'Güncellendi')} {formatDateTime(readiness.generated_at)} · {t('schema', 'şema')} {readiness.schema_version}</p>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  )
}
