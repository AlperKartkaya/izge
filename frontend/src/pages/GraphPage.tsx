import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatPercent } from '../lib/format'
import type { AssumptionDriftItem, ContradictionItem, GraphSummary } from '../lib/types'

export function GraphPage() {
  const { session } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([])
  const [assumptionDrift, setAssumptionDrift] = useState<AssumptionDriftItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }

      try {
        const [graphSummary, contradictionList, assumptionList] = await Promise.all([
          api.getGraphSummary(session.token),
          api.listContradictions(session.token),
          api.listAssumptionDrift(session.token),
        ])

        if (!cancelled) {
          setSummary(graphSummary)
          setContradictions(contradictionList)
          setAssumptionDrift(assumptionList)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load graph overview.')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [session?.token])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Graph & timeline"
        title="Review structural signals"
        description="This view concentrates explicit graph counts and the two analytical side-lists the backend already exposes: contradictions and assumption drift."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Artifacts in graph scope" value={summary?.artifact_count ?? '—'} />
        <MetricCard label="Memory families" value={Object.keys(summary?.memory_counts ?? {}).length || '—'} />
        <MetricCard label="Edge families" value={Object.keys(summary?.edge_counts ?? {}).length || '—'} />
        <MetricCard label="Contradiction edges" value={contradictions.length} />
      </section>

      <div className="two-column-layout">
        <Panel title="Memory composition" description="Counts of persisted memory objects across the explicit graph model.">
          {summary ? (
            <div className="stack-sm">
              {Object.entries(summary.memory_counts).map(([label, count]) => (
                <div key={label} className="stat-row">
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Awaiting graph summary" description="Summary counts will appear once the backend response resolves." />
          )}
        </Panel>

        <Panel title="Edge composition" description="Relationship coverage persisted in `graph_edges`.">
          {summary ? (
            <div className="stack-sm">
              {Object.entries(summary.edge_counts).map(([label, count]) => (
                <div key={label} className="stat-row">
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Awaiting edge counts" description="Edge-family counts will populate once the backend returns graph summary data." />
          )}
        </Panel>
      </div>

      <div className="two-column-layout">
        <Panel title="Contradictions" description="Visible `CONTRADICTS` edges surfaced by `/api/contradictions`.">
          {contradictions.length === 0 ? (
            <EmptyState title="No contradiction edges" description="No contradiction records are currently visible in your scope." />
          ) : (
            <div className="stack-sm">
              {contradictions.map((item) => (
                <article key={item.edge_id} className="panel-subtle stack-sm">
                  <p className="table-primary">{item.from_title} → {item.to_title}</p>
                  <p className="table-secondary">{item.from_type} {item.relation_label} {item.to_type} · topic {item.topic_key}</p>
                  <p className="muted-copy">{item.evidence_span || `Edge ${item.edge_id}`}</p>
                  {item.evidence_provenance ? <p className="table-secondary">{item.evidence_provenance}</p> : null}
                  {item.ranking_basis.length > 0 ? <p className="table-secondary">Ranked for: {item.ranking_basis.join(', ')}</p> : null}
                  {item.uncertainty_note ? <p className="muted-copy">{item.uncertainty_note}</p> : null}
                  <p className="muted-copy">Confidence {formatPercent(item.confidence_score)}</p>
                </article>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Assumption drift" description="Assumptions marked stale, reversed, or weakening by the backend analysis list.">
          {assumptionDrift.length === 0 ? (
            <EmptyState title="No drift signals" description="No visible assumption drift items are currently available." />
          ) : (
            <div className="stack-sm">
              {assumptionDrift.map((item) => (
                <article key={item.assumption_id} className="panel-subtle stack-sm">
                  <p className="table-primary">{item.title_or_label}</p>
                  <p className="table-secondary">{item.status} · {item.assumption_id} · topic {item.topic_key}</p>
                  <p className="muted-copy">{item.validity_notes || 'No validity notes recorded.'}</p>
                  {item.supporting_signal_title ? <p className="table-secondary">Compared with: {item.supporting_signal_type} · {item.supporting_signal_title}</p> : null}
                  {item.evidence_span ? <p className="muted-copy">{item.evidence_span}</p> : null}
                  {item.evidence_provenance ? <p className="table-secondary">{item.evidence_provenance}</p> : null}
                  {item.ranking_basis.length > 0 ? <p className="table-secondary">Ranked for: {item.ranking_basis.join(', ')}</p> : null}
                  {item.uncertainty_note ? <p className="muted-copy">{item.uncertainty_note}</p> : null}
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
