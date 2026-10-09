import { translate } from '../lib/language'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { OperationsHealthStatus, OperationsOverviewRead, OperationsSectionRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'

const SECTION_ORDER = [
  'database_storage',
  'artifact_index',
  'memory_freshness',
  'graph_signals',
  'worker_queue',
  'llm',
  'traces',
]

const PRIORITY_METRICS: Record<string, string[]> = {
  database_storage: ['alembic_revision', 'artifact_records', 'stored_sources', 'missing_sources', 'total_source_bytes'],
  artifact_index: ['total_artifacts', 'pending_review_count', 'completed_without_chunks', 'completed_without_memory', 'latest_artifact_update'],
  memory_freshness: ['chunk_count', 'memory_object_count', 'llm_extracted_chunk_count', 'fallback_chunk_count', 'latest_memory_update'],
  graph_signals: ['graph_edge_count', 'claim_family_count', 'claim_occurrence_count', 'active_signal_count', 'latest_signal_update'],
  worker_queue: ['total_jobs', 'claimable_count', 'expired_lease_count', 'oldest_queued_age_seconds', 'latest_job_update'],
  llm: ['gateway_status', 'configured_model', 'configured_model_available', 'enabled_feature_count', 'available_model_count'],
  traces: ['query_run_count', 'trace_step_count', 'stage_run_count', 'scenario_run_count', 'latest_query_run'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatBytes(value: unknown): string {
  if (typeof value !== 'number') {
    return 'Unavailable'
  }
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatAge(value: unknown): string {
  if (typeof value !== 'number') {
    return 'None'
  }
  if (value < 60) {
    return `${value}s`
  }
  if (value < 3600) {
    return `${Math.round(value / 60)}m`
  }
  if (value < 86400) {
    return `${Math.round(value / 3600)}h`
  }
  return `${Math.round(value / 86400)}d`
}

function formatMetricValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Unavailable'
  }
  if (key.endsWith('_bytes')) {
    return formatBytes(value)
  }
  if (key.endsWith('_age_seconds')) {
    return formatAge(value)
  }
  if (key.includes('_at') || key.includes('_update') || key.includes('_run')) {
    if (typeof value === 'string') {
      return formatDateTime(value)
    }
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'number') {
    return new Intl.NumberFormat().format(value)
  }
  if (typeof value === 'string') {
    return key.includes('status') ? formatLabel(value) : value
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== 0 && entryValue !== false && entryValue !== null && entryValue !== undefined)
    return entries.length ? entries.map(([entryKey, entryValue]) => `${formatLabel(entryKey)} ${String(entryValue)}`).join(' · ') : 'None'
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(String).join(', ') : 'None'
  }
  return String(value)
}

function severityLabel(status: OperationsHealthStatus): string {
  if (status === 'critical') {
    return 'Critical'
  }
  if (status === 'warning') {
    return translate("Needs attention", "Dikkat gerekli")
  }
  return 'Healthy'
}

function orderedSections(overview: OperationsOverviewRead): Array<[string, OperationsSectionRead]> {
  const entries = Object.entries(overview.sections)
  return entries.sort(([left], [right]) => {
    const leftIndex = SECTION_ORDER.indexOf(left)
    const rightIndex = SECTION_ORDER.indexOf(right)
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex)
  })
}

function SectionMetrics({ sectionKey, section }: { sectionKey: string; section: OperationsSectionRead }) {
  const priorityKeys = PRIORITY_METRICS[sectionKey] ?? Object.keys(section.metrics).slice(0, 6)
  const metricRows = priorityKeys
    .filter((metricKey) => Object.prototype.hasOwnProperty.call(section.metrics, metricKey))
    .map((metricKey) => ({ key: metricKey, value: section.metrics[metricKey] }))

  if (metricRows.length === 0) {
    return null
  }

  return (
    <dl className="operations-metric-list">
      {metricRows.map((metric) => (
        <div key={metric.key}>
          <dt>{formatLabel(metric.key)}</dt>
          <dd>{formatMetricValue(metric.key, metric.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function OperationsPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const [overview, setOverview] = useState<OperationsOverviewRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  async function loadOverview() {
    if (!session?.token) {
      return
    }
    setIsRefreshing(true)
    setError(null)
    try {
      setOverview(await api.getOperationsOverview(session.token))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load operations overview.', 'Operasyon özeti yüklenemedi.'))
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialOverview() {
      if (!session?.token) {
        return
      }
      try {
        const payload = await api.getOperationsOverview(session.token)
        if (!cancelled) {
          setOverview(payload)
          setError(null)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load operations overview.', 'Operasyon özeti yüklenemedi.'))
        }
      }
    }

    void loadInitialOverview()

    return () => {
      cancelled = true
    }
  }, [session?.token, t])

  const warningCount = useMemo(() => {
    if (!overview) {
      return 0
    }
    return Object.values(overview.sections).filter((section) => section.status !== 'healthy').length
  }, [overview])

  return (
    <div className="stack-xl operations-page">
      <PageIntro
        eyebrow={t('Operations', 'Operasyonlar')}
        title={t('Control room for data, memory, workers, and LLM state', 'Veri, hafıza, çalışanlar ve LLM durumu için kontrol odası')}
        description={t('A read-only admin view of what is actually running, indexed, missing, stale, queued, or ready. Use it before making infrastructure or data changes.', 'Çalışan, indekslenen, eksik, eski, sırada veya hazır durumların salt okunur yönetici görünümü. Altyapı veya veri değişikliklerinden önce kullanın.')}
        actions={
          <button type="button" className="secondary-button" onClick={() => void loadOverview()} disabled={isRefreshing || !session?.token}>
            {isRefreshing ? t('Refreshing…', 'Yenileniyor…') : t('Refresh', 'Yenile')}
          </button>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      {overview ? (
        <>
          <section className="metric-grid" aria-label={t('Operations status', 'Operasyon durumu')}>
            <MetricCard label={t('Overall status', 'Genel durum')} value={severityLabel(overview.overall_status)} detail={`${warningCount} ${t('sections need attention', 'bölüm dikkat gerektiriyor')}`} />
            <MetricCard label={t('Health score', 'Sağlık puanı')} value={formatPercent(overview.health_score)} detail={t('Derived from read-only checks; warnings lower the score.', 'Salt okunur kontrollerden hesaplanır; uyarılar puanı düşürür.')} />
            <MetricCard label={t('Workspace', 'Çalışma alanı')} value={overview.workspace_id.slice(0, 14)} detail={t('Single-company data boundary for this deployment.', 'Bu kurulumun tek şirket veri sınırı.')} />
            <MetricCard label={t('Generated', 'Oluşturuldu')} value={formatDateTime(overview.generated_at)} detail={overview.schema_version} />
          </section>

          <Panel title={t('Operator next actions', 'Operatör için sonraki adımlar')} description={t('These are the actions Izge recommends before deployment or further memory work.', 'İzge’nin kurulum veya sonraki hafıza çalışmasından önce önerdiği eylemler.')}>
            <div className="operations-action-list">
              {overview.next_actions.map((action) => (
                <article key={`${action.title}-${action.route}`} className={`panel-subtle operations-action operations-action-${action.severity}`}>
                  <div>
                    <StatusBadge value={severityLabel(action.severity)} />
                    <p className="table-primary">{action.title}</p>
                    <p className="table-secondary">{action.description}</p>
                  </div>
                  <Link className="secondary-button" to={action.route}>{t('Open', 'Aç')}</Link>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title={t('System sections', 'Sistem bölümleri')} description={t('Each section is derived from existing database and runtime state. Resolve critical and warning states before release.', 'Her bölüm mevcut veritabanı ve çalışma durumundan üretilir. Yayından önce kritik durumları ve uyarıları çözün.')}>
            <div className="operations-section-list">
              {orderedSections(overview).map(([sectionKey, section]) => (
                <article key={sectionKey} className="panel-subtle operations-section">
                  <div className="timeline-card-head">
                    <div>
                      <p className="section-label">{formatLabel(sectionKey)}</p>
                      <p className="table-primary">{section.title}</p>
                    </div>
                    <StatusBadge value={severityLabel(section.status)} />
                  </div>
                  <p className="muted-copy">{section.summary}</p>
                  <SectionMetrics sectionKey={sectionKey} section={section} />
                  {section.issues.length > 0 ? (
                    <div className="table-wrap">
                      <table className="data-table operations-issue-table">
                        <thead>
                          <tr>
                            <th>{t('Issue', 'Sorun')}</th>
                            <th>{t('Status', 'Durum')}</th>
                            <th>{t('Coverage', 'Kapsam')}</th>
                            <th>{t('Updated', 'Güncellendi')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.issues.slice(0, 6).map((issue) => (
                            <tr key={`${sectionKey}-${issue.artifact_id}-${issue.reason}`}>
                              <td>
                                <p className="table-primary">{issue.title}</p>
                                <p className="table-secondary">{issue.reason}</p>
                              </td>
                              <td>
                                <StatusBadge value={issue.ingestion_status} />
                                <p className="table-secondary">{formatLabel(issue.review_status)}</p>
                              </td>
                              <td>{issue.memory_object_count ?? '—'} {t('memory', 'hafıza')} / {issue.chunk_count ?? '—'} {t('chunks', 'bölüm')}</td>
                              <td>{formatDateTime(issue.updated_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {section.latest_jobs.length > 0 ? (
                    <div className="table-wrap">
                      <table className="data-table operations-issue-table">
                        <thead>
                          <tr>
                            <th>{t('Job', 'İş')}</th>
                            <th>{t('Status', 'Durum')}</th>
                            <th>{t('Lease', 'Kiralama')}</th>
                            <th>{t('Updated', 'Güncellendi')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.latest_jobs.slice(0, 6).map((job) => (
                            <tr key={job.job_id}>
                              <td>
                                <p className="table-primary">{job.stage_key ? formatLabel(job.stage_key) : formatLabel(job.job_kind)}</p>
                                <p className="table-secondary">{job.job_id}</p>
                              </td>
                              <td><StatusBadge value={job.status} /></td>
                              <td>{job.lease_owner ?? t('not claimed', 'atanmadı')}</td>
                              <td>{formatDateTime(job.updated_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </Panel>

          <Panel title={t('Where to act', 'Nereden işlem yapılır')} description={t('This page does not edit raw data. Use the supported surfaces below for the next safe action.', 'Bu sayfa ham veriyi düzenlemez. Sonraki güvenli eylem için aşağıdaki desteklenen alanları kullanın.')}>
            <div className="operations-link-grid">
              {overview.links.map((link) => (
                <Link key={link.route} to={link.route} className="record-link panel-subtle">
                  <p className="table-primary">{link.label}</p>
                  <p className="table-secondary">{link.description}</p>
                </Link>
              ))}
            </div>
          </Panel>
        </>
      ) : !error ? (
        <EmptyState title={t('Loading operations overview', 'Operasyon özeti yükleniyor')} description={t('Izge is reading database, storage, worker, LLM, trace, graph, and memory state.', 'İzge veritabanı, depolama, çalışan, LLM, iz, grafik ve hafıza durumunu okuyor.')} />
      ) : null}
    </div>
  )
}
