import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ArtifactProactiveSignals, ArtifactRead, IngestionJobRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'
import { Select } from '../components/Select'

export function IngestionPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const location = useLocation()
  const preferredArtifactId = (location.state as { artifactId?: string } | null)?.artifactId
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState(preferredArtifactId || '')
  const [job, setJob] = useState<IngestionJobRead | null>(null)
  const [artifactSignals, setArtifactSignals] = useState<ArtifactProactiveSignals | null>(null)
  const [manualJobId, setManualJobId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadArtifacts() {
      if (!session?.token) {
        return
      }

      try {
        const artifactList = await api.listArtifacts(session.token)
        if (!cancelled) {
          setArtifacts(artifactList)
          if (!selectedArtifactId) {
            setSelectedArtifactId(preferredArtifactId || artifactList[0]?.artifact_id || '')
          }
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load ingestion state.', 'İşleme durumu yüklenemedi.'))
        }
      }
    }

    void loadArtifacts()

    return () => {
      cancelled = true
    }
  }, [preferredArtifactId, selectedArtifactId, session?.token, t])

  useEffect(() => {
    if (!session?.token || !job || !['pending', 'running'].includes(job.status)) {
      return
    }

    const intervalId = window.setInterval(async () => {
      try {
        const refreshed = await api.getIngestionJob(session.token, job.job_id)
        setJob(refreshed)
      } catch {
        window.clearInterval(intervalId)
      }
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [job, session?.token])

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.artifact_id === selectedArtifactId) || null,
    [artifacts, selectedArtifactId],
  )

  async function handleRunIngestion() {
    if (!session?.token || !selectedArtifactId) {
      setError(t('Choose an artifact before starting an ingestion run.', 'İşlemeyi başlatmadan önce bir kaynak seçin.'))
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      const nextJob = await api.runIngestion(session.token, selectedArtifactId)
      setJob(nextJob)
      setManualJobId(nextJob.job_id)
      const [artifactList, signals] = await Promise.all([
        api.listArtifacts(session.token),
        api.getArtifactSignals(session.token, selectedArtifactId),
      ])
      setArtifacts(artifactList)
      setArtifactSignals(signals)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to start ingestion run.', 'İşleme başlatılamadı.'))
    } finally {
      setIsBusy(false)
    }
  }

  async function handleFetchJob() {
    if (!session?.token || !manualJobId) {
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      const nextJob = await api.getIngestionJob(session.token, manualJobId)
      setJob(nextJob)
      setArtifactSignals(await api.getArtifactSignals(session.token, nextJob.artifact_id))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load ingestion job.', 'İşleme işi yüklenemedi.'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Memory construction', 'Hafıza oluşturma')}
        title={t('Process a source', 'Bir kaynağı işleyin')}
        description={t('Choose a source, start processing, and review the changes it creates.', 'Bir kaynak seçin, işlemeyi başlatın ve oluşturduğu değişiklikleri inceleyin.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className="two-column-layout">
        <Panel title={t('Start memory build', 'Hafıza oluşturmayı başlat')} description={t('Creates a new processing job for the selected source.', 'Seçilen kaynak için yeni bir işleme işi oluşturur.')}>
          {artifacts.length === 0 ? (
            <EmptyState title={t('No artifacts ready', 'Hazır kaynak yok')} description={t('Sources must be stored before processing can run.', 'İşleme çalıştırılmadan önce kaynaklar kaydedilmelidir.')} />
          ) : (
            <div className="form-grid">
            <label className="field">
              <span className="field-label">{t('Artifact', 'Kaynak')}</span>
              <Select
                aria-label={t('Artifact', 'Kaynak')}
                name="artifact"
                value={selectedArtifactId}
                onValueChange={(value) => {
                  setSelectedArtifactId(value)
                  setArtifactSignals(null)
                }}
                options={artifacts.map((artifact) => ({ value: artifact.artifact_id, label: artifact.title }))}
              />
              </label>
              {selectedArtifact ? (
                <div className="panel-subtle">
                  <p className="table-primary">{selectedArtifact.title}</p>
                  <p className="muted-copy">{t('Current processing status', 'Mevcut işleme durumu')}: {formatLabel(selectedArtifact.ingestion_status)}</p>
                </div>
              ) : null}
              <button type="button" className="primary-button" onClick={() => void handleRunIngestion()} disabled={isBusy || !selectedArtifactId}>
                {isBusy ? t('Starting…', 'Başlatılıyor…') : t('Run processing', 'İşlemeyi çalıştır')}
              </button>
            </div>
          )}
        </Panel>

        <details className="employee-focus-details">
          <summary>{t('Open a job by ID', 'İş kimliğiyle çalışma aç')}</summary>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">{t('Job ID', 'İş kimliği')}</span>
              <input name="job-id" value={manualJobId} onChange={(event) => setManualJobId(event.target.value)} placeholder="job_…" autoComplete="off" spellCheck={false} />
            </label>
            <button type="button" className="secondary-button" onClick={() => void handleFetchJob()} disabled={isBusy || !manualJobId}>{t("Load status", "Durumu yükle")}</button>
          </div>
        </details>
      </div>

      {job ? (
        <Panel title={t('Current processing run', 'Mevcut işleme çalışması')} description={t('Live status for the selected source.', 'Seçilen kaynağın canlı durumu.')}>
          <div className="stack-lg">
            <div className="readiness-header">
              <div>
                <p className="table-primary">{artifacts.find((artifact) => artifact.artifact_id === job.artifact_id)?.title ?? job.artifact_id}</p>
                <p className="table-secondary">{t('Stage', 'Aşama')}: {job.stage}</p>
              </div>
                <StatusBadge value={job.status} />
            </div>
            {job.detail ? <p className="muted-copy">{job.detail}</p> : null}
            <details className="employee-focus-details">
              <summary>{t('Run details', 'Çalışma ayrıntıları')}</summary>
              <dl className="meta-list">
                <div><dt>{t('Job ID', 'İş kimliği')}</dt><dd>{job.job_id}</dd></div>
                <div><dt>{t('Artifact', 'Kaynak')}</dt><dd>{job.artifact_id}</dd></div>
                <div><dt>{t('Actor', 'Gerçekleştiren')}</dt><dd>{job.created_by}</dd></div>
                <div><dt>{t('Created', 'Oluşturuldu')}</dt><dd>{formatDateTime(job.created_at)}</dd></div>
                <div><dt>{t('Updated', 'Güncellendi')}</dt><dd>{formatDateTime(job.updated_at)}</dd></div>
              </dl>
              <p className="muted-copy">{job.detail || t('No additional detail was recorded.', 'Ek bir ayrıntı kaydedilmedi.')}</p>
            </details>
          </div>
        </Panel>
      ) : null}

      <Panel title={t('Proactive output from this processing', 'Bu işlemenin proaktif çıktısı')} description={t('Source-scoped contradiction, drift, supersession, and next-action signals generated against existing memory.', 'Mevcut hafızaya göre üretilen kaynak kapsamlı çelişki, değişim, geçersiz kılma ve sonraki eylem sinyalleri.')}>
        {!artifactSignals ? (
          <EmptyState title={t('No source signal summary loaded', 'Kaynak sinyali özeti yüklenmedi')} description={t('Run processing or load a job to see what the source changed in the memory graph.', 'Kaynağın hafıza grafiğinde neyi değiştirdiğini görmek için işlemeyi çalıştırın veya bir işi yükleyin.')} />
        ) : (
          <div className="stack-lg">
            <div className="panel-subtle">
              <p className="section-label">{t('Artifact impact summary', 'Kaynak etki özeti')}</p>
              <p className="muted-copy">{artifactSignals.summary}</p>
            </div>
            <dl className="review-ledger">
              <div><dt>{t('Contradictions', 'Çelişkiler')}</dt><dd>{artifactSignals.signal_counts.contradictions ?? 0}</dd></div>
              <div><dt>{t('Drift', 'Değişim')}</dt><dd>{artifactSignals.signal_counts.assumption_drift ?? 0}</dd></div>
              <div><dt>{t('Next actions', 'Sonraki adımlar')}</dt><dd>{artifactSignals.signal_counts.next_actions ?? 0}</dd></div>
            </dl>

            {artifactSignals.persisted_signals.length > 0 ? (
              <div className="stack-sm">
                <p className="section-label">{t('Durable signals created from this source', 'Bu kaynaktan oluşturulan kalıcı sinyaller')}</p>
                {artifactSignals.persisted_signals.slice(0, 5).map((signal) => (
                  <Link key={signal.signal_id} className="record-link panel-subtle" to={`/signals/${signal.signal_id}`}>
                    <div>
                      <p className="table-primary">{signal.title}</p>
                      <p className="table-secondary">
                        {formatLabel(signal.signal_type)} · {t('urgency', 'aciliyet')} {formatPercent(signal.urgency_score)}
                      </p>
                    </div>
                    <span className="table-secondary">{t('Open intelligence path', 'Analiz yolunu aç')}</span>
                  </Link>
                ))}
              </div>
            ) : null}

            {artifactSignals.introduced_contradictions.length === 0 &&
            artifactSignals.revealed_assumption_drift.length === 0 &&
            artifactSignals.superseded_memory.length === 0 &&
            artifactSignals.prior_relevant_work.length === 0 &&
            artifactSignals.recommended_next_actions.length === 0 ? (
              <EmptyState title={t('No grounded proactive signals', 'Kaynaklı proaktif sinyal yok')} description={t('This source was processed, but no contradiction, drift, continuity, supersession, or next action could be justified from visible evidence.', 'Bu kaynak işlendi ancak görünür kanıtlardan bir çelişki, değişim, süreklilik, geçersiz kılma veya sonraki eylem gerekçelendirilemedi.')} />
            ) : (
              <div className="stack-md">
                {artifactSignals.introduced_contradictions.slice(0, 2).map((item) => (
                  <article key={item.edge_id} className="panel-subtle stack-sm critical-card">
                    <p className="section-label">{t('Contradiction introduced by this source', 'Bu kaynağın oluşturduğu çelişki')}</p>
                    <p className="table-primary">{item.from_title} ↔ {item.to_title}</p>
                    <p className="muted-copy">{item.evidence_provenance}</p>
                  </article>
                ))}
                {artifactSignals.revealed_assumption_drift.slice(0, 2).map((item) => (
                  <article key={item.assumption_id} className="panel-subtle stack-sm drift-card">
                    <p className="section-label">{t('Assumption drift revealed', 'Ortaya çıkan varsayım değişimi')}</p>
                    <p className="table-primary">{item.title_or_label}</p>
                    <p className="table-secondary">{t('Status', 'Durum')} {formatLabel(item.status)} · {t('topic', 'konu')} {item.topic_key}</p>
                    <p className="muted-copy">{item.evidence_provenance || item.validity_notes}</p>
                  </article>
                ))}
                {artifactSignals.superseded_memory.slice(0, 2).map((item) => (
                  <article key={item.edge_id} className="panel-subtle stack-sm">
                    <p className="section-label">{t('Supersession / reopening', 'Geçersiz kılma / yeniden açma')}</p>
                    <p className="table-primary">{item.from_title} {t('supersedes', 'yerine geçer')} {item.to_title}</p>
                    <p className="muted-copy">{item.evidence_provenance}</p>
                  </article>
                ))}
                {artifactSignals.prior_relevant_work.slice(0, 3).map((item) => (
                  <article key={`${item.prior_artifact_id}-${item.related_topic}`} className="panel-subtle stack-sm">
                    <p className="section-label">{t('Prior relevant work', 'İlgili önceki çalışma')} · {t('overlap', 'örtüşme')} {formatPercent(item.overlap_score)}</p>
                    <p className="table-primary">{item.prior_artifact_title}</p>
                    <p className="muted-copy">{item.continuity_reason}</p>
                    <p className="evidence-block">{item.recommended_action}</p>
                  </article>
                ))}
                {artifactSignals.recommended_next_actions.slice(0, 3).map((item) => (
                  <article key={item.signal_id} className="panel-subtle stack-sm action-card">
                    <p className="section-label">{t('Grounded next action', 'Kaynaklı sonraki adım')} · {t('urgency', 'aciliyet')} {formatPercent(item.urgency_score)}</p>
                    <p className="table-primary">{item.title}</p>
                    <p className="evidence-block">{item.recommended_action}</p>
                    <p className="muted-copy">{item.grounded_reasoning}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
