import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ReadinessAreaStatus, TargetReadinessAreaRead, TargetReadinessRead } from '../lib/types'

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
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load target readiness.')
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
  }, [session?.token])

  const gaps = useMemo(() => topGaps(readiness?.areas ?? []), [readiness?.areas])
  const snapshot = readiness?.current_workspace_snapshot

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Target readiness / promise coverage"
        title="See how close Izge is to the company-portable memory-system target"
        description="This page maps the public website and PRD promises to what the demo can prove right now: evidence substrate, temporal graph, typed context packets, bounded orchestration, private AI discipline, scenario support, and Docker portability."
        actions={
          <div className="inline-actions">
            <Link className="secondary-button" to="/memory-filesystem">
              Inspect memory FS
            </Link>
            <Link className="primary-button" to="/orchestration">
              Inspect orchestration
            </Link>
          </div>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Target score" value={readiness ? formatPercent(readiness.target_score) : '—'} detail="Average of implemented, partial, and planned target areas." />
        <MetricCard label="Implemented" value={readiness ? statusCount(readiness, 'implemented') : '—'} detail="Promises reflected in the current demo with proof routes." />
        <MetricCard label="Partial" value={readiness ? statusCount(readiness, 'partial') : '—'} detail="Visible foundations exist, but stronger persistence/runtime/eval remains." />
        <MetricCard label="Planned" value={readiness ? statusCount(readiness, 'planned') : '—'} detail="Known target work not yet ready to claim." />
        <MetricCard label="Workspace proof" value={snapshotValue(snapshot, 'memory_object_count')} detail="Typed memory objects currently visible in this workspace." />
      </section>

      <Panel title="Current workspace evidence snapshot" description="Fast proof that the readiness score is grounded in real workspace state, not static marketing copy.">
        {readiness ? (
          <div className="detail-grid">
            <article className="panel-subtle detail-card">
              <p className="section-label">Artifacts</p>
              <p className="table-primary">{snapshotValue(snapshot, 'visible_artifact_count')}</p>
              <p className="muted-copy">Visible sources in the current permission scope.</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">Chunks</p>
              <p className="table-primary">{snapshotValue(snapshot, 'indexed_chunk_count')}</p>
              <p className="muted-copy">Retrieval leaves under the internal memory file-system.</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">Stage runs</p>
              <p className="table-primary">{snapshotValue(snapshot, 'stage_run_count')}</p>
              <p className="muted-copy">Persisted bounded orchestration ledger rows.</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">Stage packet traces</p>
              <p className="table-primary">{snapshotValue(snapshot, 'stage_packet_trace_count')}</p>
              <p className="muted-copy">Bounded local sub-agent packet executions.</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">Temporal families</p>
              <p className="table-primary">{snapshotValue(snapshot, 'claim_family_count')}</p>
              <p className="muted-copy">Persisted claim-family projection rows.</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">Scenario runs</p>
              <p className="table-primary">{snapshotValue(snapshot, 'scenario_run_count')}</p>
              <p className="muted-copy">Stored scenario packets available for replay.</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">LLM gateway</p>
              <p className="table-primary">{snapshotValue(snapshot, 'local_llm_gateway_status')}</p>
              <p className="muted-copy">Live readiness when local/private AI flags are enabled.</p>
            </article>
            <article className="panel-subtle detail-card">
              <p className="section-label">Signals</p>
              <p className="table-primary">{snapshotValue(snapshot, 'active_signal_count')}</p>
              <p className="muted-copy">Evidence-backed contradiction, drift, continuity, or next-action outputs.</p>
            </article>
          </div>
        ) : (
          <EmptyState title={isLoading ? 'Loading readiness' : 'No readiness payload'} description="Izge is reading the current workspace proof state." />
        )}
      </Panel>

      <Panel title="Promise-to-demo coverage" description="Each area states the promise, the current demo reflection, proof routes, and the remaining work before we should call the target fully done.">
        {readiness ? (
          <div className="stack-sm">
            {readiness.areas.map((area) => (
              <article key={area.area_key} className={areaCardClass(area.status)}>
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{formatPercent(area.score)} complete</p>
                    <p className="table-primary">{area.title}</p>
                  </div>
                  <StatusBadge value={formatLabel(area.status)} />
                </div>
                <p className="muted-copy">{area.promise}</p>
                <p className="evidence-block">Demo reflection: {area.demo_reflection}</p>

                <div className="two-column-layout">
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">Proof signals</p>
                    {area.proof_signals.map((signal) => (
                      <p key={`${area.area_key}-${signal.label}`} className="table-secondary">
                        {signal.label}: <strong>{signal.value}</strong>{signal.route ? ` · ${signal.route}` : ''}
                      </p>
                    ))}
                  </div>
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">Demo surfaces</p>
                    {area.demo_surfaces.map((surface) => (
                      <p key={`${area.area_key}-${surface}`} className="table-secondary">{surface}</p>
                    ))}
                  </div>
                </div>

                <div className="panel-subtle stack-sm">
                  <p className="section-label">Remaining work</p>
                  {area.remaining_work.map((item) => <p key={item} className="muted-copy">{item}</p>)}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="two-column-layout">
        <Panel title="Closest gaps" description="The lowest-scored or still-active gaps that define the next implementation passes.">
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
            <EmptyState title="No gaps ranked yet" description="Readiness gaps appear after the backend returns target areas." />
          )}
        </Panel>

        <Panel title="Next best passes" description="Implementation order that preserves the evidence-first architecture instead of jumping into agent theater.">
          {readiness ? (
            <div className="stack-sm">
              {readiness.next_best_passes.map((item, index) => (
                <article key={item} className="panel-subtle stack-sm">
                  <p className="section-label">Pass {index + 1}</p>
                  <p className="muted-copy">{item}</p>
                </article>
              ))}
              <p className="table-secondary">Gate: {readiness.evaluator_gate.name}</p>
              <p className="evidence-block">Updated {formatDateTime(readiness.generated_at)} · schema {readiness.schema_version}</p>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  )
}
