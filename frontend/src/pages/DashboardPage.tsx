import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ArtifactRead, AssumptionDriftItem, ContradictionItem, GraphSummary, NextActionSignalItem } from '../lib/types'

export function DashboardPage() {
  const { session, refreshUser } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([])
  const [assumptionDrift, setAssumptionDrift] = useState<AssumptionDriftItem[]>([])
  const [nextActions, setNextActions] = useState<NextActionSignalItem[]>([])
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
        const [graphSummary, artifactList, contradictionList, driftList, actionList] = await Promise.all([
          api.getGraphSummary(session.token),
          api.listArtifacts(session.token),
          api.listContradictions(session.token),
          api.listAssumptionDrift(session.token),
          api.listNextActions(session.token),
          refreshUser(),
        ])

        if (!cancelled) {
          setSummary(graphSummary)
          setArtifacts(artifactList)
          setContradictions(contradictionList)
          setAssumptionDrift(driftList)
          setNextActions(actionList)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load dashboard state.')
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
  }, [refreshUser, session?.token])

  const totalMemoryObjects = useMemo(
    () => Object.values(summary?.memory_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )
  const persistedSignalCount = useMemo(
    () => Object.values(summary?.signal_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Decision intelligence command board"
        title="See what changed before the team moves again"
        description="Izge turns artifacts into a hard-edged institutional record: decisions, later conflicts, drifting assumptions, evidence spans, and grounded next actions."
        actions={
          <div className="inline-actions">
            <Link className="secondary-button" to="/artifacts">
              Load evidence
            </Link>
            <Link className="primary-button" to="/query">
              Interrogate history
            </Link>
          </div>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Visible sources" value={summary?.artifact_count ?? '—'} detail="Artifacts currently available in your permitted scope." />
        <MetricCard label="Memory objects" value={totalMemoryObjects || '—'} detail="Structured decisions, assumptions, constraints, outcomes, and commitments." />
        <MetricCard label="Active tensions" value={contradictions.length + assumptionDrift.length} detail="Contradictions and assumption drift visible in your permitted scope." />
        <MetricCard label="Persisted signals" value={persistedSignalCount || nextActions.length} detail="Durable proactive signals generated from ingested artifact impact." />
      </section>

      <div className="two-column-layout">
        <Panel title="Reasoning modes, not chat modes" description="Each block is a fixed institutional-memory operation designed to expose why a recommendation is justified.">
          <div className="signal-grid">
            {[
              ['Decision lineage', 'Trace who decided what, when, and under which source record.'],
              ['Contradiction analysis', 'Make later claims visually collide with earlier commitments.'],
              ['Assumption drift', 'Mark stale assumptions as operational risk, not weak metadata.'],
              ['Next-action guidance', 'Recommend moves only after evidence, conflict, and uncertainty are visible.'],
            ].map(([item, detail]) => (
              <article key={item} className="signal-card panel-subtle">
                <p className="signal-title">{item}</p>
                <p className="muted-copy">{detail}</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="Current memory boundary" description="Scope and permissions are part of the reasoning record; hidden evidence must stay visible as a constraint.">
          <dl className="meta-list">
            <div>
              <dt>Name</dt>
              <dd>{session?.user.display_name ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{session?.user.email ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Workspace ID</dt>
              <dd>{summary?.workspace_id ?? session?.user.workspace_id ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Product stance</dt>
              <dd>Reconstruct first. Compare second. Recommend last.</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel
        title="Signals requiring a decision"
        description="Workspace-level contradiction, drift, and next-action guidance are first-class memory products, not analytics widgets."
        aside={
          <Link className="secondary-button" to="/graph">
            Inspect graph
          </Link>
        }
      >
        {contradictions.length === 0 && assumptionDrift.length === 0 && nextActions.length === 0 ? (
          <EmptyState title="No active signals yet" description="Run ingestion on demo artifacts to surface contradictions, drift, and grounded guidance." />
        ) : (
          <div className="signal-grid">
            {contradictions.slice(0, 2).map((item) => (
              <article key={item.edge_id} className="signal-card panel-subtle critical-card">
                <p className="section-label">Contradiction</p>
                <p className="signal-title">{item.from_title} ↔ {item.to_title}</p>
                <p className="muted-copy">{item.evidence_provenance}</p>
                <p className="table-secondary">Topic {item.topic_key} · confidence {formatPercent(item.confidence_score)}</p>
              </article>
            ))}
            {assumptionDrift.slice(0, 2).map((item) => (
              <article key={item.assumption_id} className="signal-card panel-subtle drift-card">
                <p className="section-label">Assumption drift</p>
                <p className="signal-title">{item.title_or_label}</p>
                <p className="muted-copy">{item.validity_notes || item.evidence_provenance || 'Later evidence weakened this assumption.'}</p>
                <p className="table-secondary">Status {formatLabel(item.status)} · topic {item.topic_key}</p>
              </article>
            ))}
            {nextActions.slice(0, 2).map((item) => (
              <article key={item.signal_id} className="signal-card panel-subtle action-card">
                <p className="section-label">Next action</p>
                <p className="signal-title">{item.title}</p>
                <p className="muted-copy">{item.recommended_action}</p>
                <p className="table-secondary">
                  Urgency {formatPercent(item.urgency_score)} · uncertainty {formatPercent(item.uncertainty_score)}
                </p>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent evidence entering memory" description="Sources are treated as inspectable provenance, not background files.">
        {isLoading ? <p className="muted-copy">Loading source inventory…</p> : null}
        {!isLoading && artifacts.length === 0 ? (
          <EmptyState title="No sources yet" description="Upload a file or submit pasted text to start reconstructing institutional memory." />
        ) : null}
        {artifacts.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Visibility</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.slice(0, 6).map((artifact) => (
                  <tr key={artifact.artifact_id}>
                    <td>
                      <div>
                        <p className="table-primary">{artifact.title}</p>
                        <p className="table-secondary">{artifact.artifact_id}</p>
                      </div>
                    </td>
                    <td>{artifact.visibility_scope}</td>
                    <td>
                      <StatusBadge value={artifact.ingestion_status} />
                    </td>
                    <td>{formatDateTime(artifact.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
