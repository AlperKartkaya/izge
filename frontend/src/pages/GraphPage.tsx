import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { AssumptionDriftItem, ContradictionItem, GraphSummary, GraphTimelineItem } from '../lib/types'

export function GraphPage() {
  const { session } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [timelineItems, setTimelineItems] = useState<GraphTimelineItem[]>([])
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([])
  const [assumptionDrift, setAssumptionDrift] = useState<AssumptionDriftItem[]>([])
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }

      try {
        const [graphSummary, graphTimeline, contradictionList, assumptionList] = await Promise.all([
          api.getGraphSummary(session.token),
          api.getGraphTimeline(session.token),
          api.listContradictions(session.token),
          api.listAssumptionDrift(session.token),
        ])

        if (!cancelled) {
          setSummary(graphSummary)
          setTimelineItems(graphTimeline.items)
          setContradictions(contradictionList)
          setAssumptionDrift(assumptionList)
          setSelectedMemoryId(graphTimeline.items[0]?.memory_id ?? null)
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

  const selectedTimelineItem = useMemo(
    () => timelineItems.find((item) => item.memory_id === selectedMemoryId) ?? timelineItems[0] ?? null,
    [selectedMemoryId, timelineItems],
  )

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Graph & timeline"
        title="Reconstruct the history"
        description="This view starts with a timeline of remembered decisions, assumptions, constraints, outcomes, and commitments so the graph reads like institutional history rather than a database summary."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Artifacts in graph scope" value={summary?.artifact_count ?? '—'} />
        <MetricCard label="Timeline cards" value={timelineItems.length || '—'} />
        <MetricCard label="Edge families" value={Object.keys(summary?.edge_counts ?? {}).length || '—'} />
        <MetricCard label="Contradiction edges" value={contradictions.length} />
      </section>

      <div className="two-column-layout wide-right-column">
        <Panel title="Timeline of remembered changes" description="Ordered memory cards make the product read like historical reconstruction, not graph wallpaper.">
          {timelineItems.length === 0 ? (
            <EmptyState title="No timeline entries yet" description="Run ingestion on roadmap artifacts to populate the explicit institutional memory timeline." />
          ) : (
            <div className="timeline-list">
              {timelineItems.map((item) => (
                <button
                  key={`${item.memory_type}-${item.memory_id}`}
                  type="button"
                  className={selectedTimelineItem?.memory_id === item.memory_id ? 'timeline-card timeline-card-active' : 'timeline-card'}
                  onClick={() => setSelectedMemoryId(item.memory_id)}
                >
                  <div className="timeline-card-head">
                    <p className="section-label">{formatDate(item.event_timestamp)}</p>
                    <StatusBadge value={formatLabel(item.timeline_status)} />
                  </div>
                  <p className="table-primary">{item.title_or_label}</p>
                  <p className="table-secondary">{item.memory_type} · topic {item.topic_key}</p>
                  <p className="muted-copy">{item.source_artifact_title}</p>
                  <div className="timeline-stats">
                    <span>{item.related_count} linked</span>
                    <span>{item.contradiction_count} contradictions</span>
                    <span>{item.supersedes_count} supersessions</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={selectedTimelineItem ? 'Selected memory detail' : 'Timeline detail'}
          description={
            selectedTimelineItem
              ? 'Inspect evidence-bearing memory details and jump directly into the dedicated memory page.'
              : 'Select a timeline card to inspect its evidence context.'
          }
        >
          {selectedTimelineItem ? (
            <div className="stack-md">
              <div className="detail-grid">
                <article className="panel-subtle detail-card">
                  <p className="section-label">Kind</p>
                  <p className="table-primary">{selectedTimelineItem.memory_type}</p>
                </article>
                <article className="panel-subtle detail-card">
                  <p className="section-label">Observed</p>
                  <p className="table-primary">{formatDateTime(selectedTimelineItem.event_timestamp)}</p>
                </article>
              </div>

              <div className="panel-subtle stack-sm">
                <p className="section-label">Historical reading</p>
                <p className="table-primary">{selectedTimelineItem.title_or_label}</p>
                <p className="table-secondary">
                  {selectedTimelineItem.source_artifact_title} · status {formatLabel(selectedTimelineItem.timeline_status)}
                </p>
                {selectedTimelineItem.owner_label ? <p className="table-secondary">Owner: {selectedTimelineItem.owner_label}</p> : null}
                {selectedTimelineItem.due_date ? <p className="table-secondary">Due: {formatDate(selectedTimelineItem.due_date)}</p> : null}
                <p className="muted-copy">{selectedTimelineItem.evidence_span ?? 'No explicit evidence span recorded for this timeline item.'}</p>
              </div>

              <dl className="meta-list compact-meta-list">
                <div>
                  <dt>Related links</dt>
                  <dd>{selectedTimelineItem.related_count}</dd>
                </div>
                <div>
                  <dt>Contradictions</dt>
                  <dd>{selectedTimelineItem.contradiction_count}</dd>
                </div>
                <div>
                  <dt>Supersessions</dt>
                  <dd>{selectedTimelineItem.supersedes_count}</dd>
                </div>
                <div>
                  <dt>Source chunk</dt>
                  <dd>{selectedTimelineItem.source_chunk_id ?? 'Unavailable'}</dd>
                </div>
              </dl>

              <Link className="secondary-button" to={`/memory/${selectedTimelineItem.memory_type}/${selectedTimelineItem.memory_id}`}>
                Open full memory detail
              </Link>
            </div>
          ) : (
            <EmptyState title="Nothing selected" description="Choose a timeline card to inspect its evidence-bearing memory details." />
          )}
        </Panel>
      </div>

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
                  <div className="stack-sm">
                    <div className="panel-subtle stack-sm">
                      <p className="section-label">Later claim evidence</p>
                      <p className="table-secondary">{item.from_evidence.artifact_title}</p>
                      <p className="muted-copy">{item.from_evidence.excerpt}</p>
                      <p className="table-secondary">{item.from_evidence.provenance}</p>
                    </div>
                    <div className="panel-subtle stack-sm">
                      <p className="section-label">Earlier claim evidence</p>
                      <p className="table-secondary">{item.to_evidence.artifact_title}</p>
                      <p className="muted-copy">{item.to_evidence.excerpt}</p>
                      <p className="table-secondary">{item.to_evidence.provenance}</p>
                    </div>
                  </div>
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
