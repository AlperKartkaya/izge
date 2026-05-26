import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type {
  AssumptionDriftItem,
  ContradictionItem,
  GraphNeighborhood,
  GraphSummary,
  GraphTimelineItem,
  NextActionSignalItem,
  SignalRead,
  TemporalGraphLink,
  TemporalGraphOccurrence,
  TemporalGraphRead,
} from '../lib/types'

interface InteractiveGraphNode {
  id: string
  kind: 'artifact' | 'memory'
  label: string
  subtitle: string
  x: number
  y: number
  memoryType?: string
  memoryId?: string
  occurrence?: TemporalGraphOccurrence
  artifactId?: string
  artifactTitle?: string
  confidenceScore?: number
}

interface InteractiveGraphEdge {
  id: string
  fromId: string
  toId: string
  edgeType: string
  confidenceScore: number
  sourceLink?: TemporalGraphLink
}

interface InteractiveGraphModel {
  nodes: InteractiveGraphNode[]
  edges: InteractiveGraphEdge[]
}

function truncateGraphLabel(value: string, limit = 30): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function buildInteractiveGraph(temporalGraph: TemporalGraphRead | null): InteractiveGraphModel {
  if (!temporalGraph || temporalGraph.occurrences.length === 0) {
    return { nodes: [], edges: [] }
  }

  const artifactMap = new Map<string, string>()
  temporalGraph.occurrences.forEach((occurrence) => {
    artifactMap.set(occurrence.source_artifact_id, occurrence.source_artifact_title)
  })
  const artifactEntries = Array.from(artifactMap.entries()).slice(0, 8)
  const visibleOccurrences = temporalGraph.occurrences.slice(0, 32)
  const nodes: InteractiveGraphNode[] = []

  artifactEntries.forEach(([artifactId, artifactTitle], index) => {
    const denominator = Math.max(artifactEntries.length - 1, 1)
    nodes.push({
      id: `artifact:${artifactId}`,
      kind: 'artifact',
      label: artifactTitle,
      subtitle: 'Source artifact',
      x: 110,
      y: 90 + (index / denominator) * 420,
      artifactId,
      artifactTitle,
    })
  })

  const centerX = 575
  const centerY = 300
  const radiusX = 325
  const radiusY = 220
  visibleOccurrences.forEach((occurrence, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(visibleOccurrences.length, 1)) * Math.PI * 2
    nodes.push({
      id: occurrence.occurrence_id,
      kind: 'memory',
      label: occurrence.title_or_label,
      subtitle: `${formatLabel(occurrence.memory_type)} · ${formatLabel(occurrence.status)}`,
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
      memoryType: occurrence.memory_type,
      memoryId: occurrence.memory_id,
      occurrence,
      artifactId: occurrence.source_artifact_id,
      artifactTitle: occurrence.source_artifact_title,
      confidenceScore: occurrence.confidence_score,
    })
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: InteractiveGraphEdge[] = visibleOccurrences
    .filter((occurrence) => nodeIds.has(`artifact:${occurrence.source_artifact_id}`))
    .map((occurrence) => ({
      id: `source:${occurrence.occurrence_id}`,
      fromId: `artifact:${occurrence.source_artifact_id}`,
      toId: occurrence.occurrence_id,
      edgeType: 'source_artifact',
      confidenceScore: occurrence.confidence_score,
    }))

  temporalGraph.links.forEach((link) => {
    if (nodeIds.has(link.from_occurrence_id) && nodeIds.has(link.to_occurrence_id)) {
      edges.push({
        id: link.edge_id,
        fromId: link.from_occurrence_id,
        toId: link.to_occurrence_id,
        edgeType: link.edge_type,
        confidenceScore: link.confidence_score,
        sourceLink: link,
      })
    }
  })

  return { nodes, edges }
}

export function GraphPage() {
  const { session } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [timelineItems, setTimelineItems] = useState<GraphTimelineItem[]>([])
  const [neighborhood, setNeighborhood] = useState<GraphNeighborhood | null>(null)
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([])
  const [assumptionDrift, setAssumptionDrift] = useState<AssumptionDriftItem[]>([])
  const [nextActions, setNextActions] = useState<NextActionSignalItem[]>([])
  const [persistedSignals, setPersistedSignals] = useState<SignalRead[]>([])
  const [temporalGraph, setTemporalGraph] = useState<TemporalGraphRead | null>(null)
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null)
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null)
  const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState<string | null>(null)
  const [isNeighborhoodLoading, setIsNeighborhoodLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }

      try {
        const [graphSummary, graphTimeline, contradictionList, assumptionList, actionList, signalList, temporalGraphPayload] = await Promise.all([
          api.getGraphSummary(session.token),
          api.getGraphTimeline(session.token),
          api.listContradictions(session.token),
          api.listAssumptionDrift(session.token),
          api.listNextActions(session.token),
          api.listSignals(session.token),
          api.getTemporalGraph(session.token, 80),
        ])

        if (!cancelled) {
          setSummary(graphSummary)
          setTimelineItems(graphTimeline.items)
          setContradictions(contradictionList)
          setAssumptionDrift(assumptionList)
          setNextActions(actionList)
          setPersistedSignals(signalList)
          setTemporalGraph(temporalGraphPayload)
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
  const interactiveGraph = useMemo(() => buildInteractiveGraph(temporalGraph), [temporalGraph])
  const selectedGraphNode = useMemo(
    () => (selectedGraphEdgeId ? null : (interactiveGraph.nodes.find((node) => node.id === selectedGraphNodeId) ?? interactiveGraph.nodes[0] ?? null)),
    [interactiveGraph.nodes, selectedGraphEdgeId, selectedGraphNodeId],
  )
  const selectedGraphEdge = useMemo(
    () => interactiveGraph.edges.find((edge) => edge.id === selectedGraphEdgeId) ?? null,
    [interactiveGraph.edges, selectedGraphEdgeId],
  )
  const nodeById = useMemo(() => new Map(interactiveGraph.nodes.map((node) => [node.id, node])), [interactiveGraph.nodes])

  useEffect(() => {
    let cancelled = false

    async function loadNeighborhood() {
      if (!session?.token || !selectedTimelineItem) {
        if (!cancelled) {
          setNeighborhood(null)
        }
        return
      }

      setIsNeighborhoodLoading(true)

      try {
        const payload = await api.getGraphNeighborhood(session.token, selectedTimelineItem.memory_type, selectedTimelineItem.memory_id)
        if (!cancelled) {
          setNeighborhood(payload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setNeighborhood(null)
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load graph neighborhood.')
        }
      } finally {
        if (!cancelled) {
          setIsNeighborhoodLoading(false)
        }
      }
    }

    void loadNeighborhood()

    return () => {
      cancelled = true
    }
  }, [selectedTimelineItem, session?.token])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Lineage / contradiction / drift"
        title="Reconstruct how the record changed"
        description="This view treats the graph as institutional history: remembered decisions, assumptions, constraints, outcomes, commitments, conflict edges, and drift warnings."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Trusted sources" value={summary?.artifact_count ?? '—'} />
        <MetricCard label="Timeline cards" value={timelineItems.length || '—'} />
        <MetricCard label="Relationship types" value={Object.keys(summary?.edge_counts ?? {}).length || '—'} />
        <MetricCard label="Contradictions surfaced" value={contradictions.length} />
        <MetricCard label="Persisted signals" value={persistedSignals.length || nextActions.length} />
        <MetricCard label="Temporal claims" value={temporalGraph?.occurrences.length ?? '—'} detail={`${temporalGraph?.families.length ?? 0} persisted families`} />
      </section>

      <Panel
        title="Interactive evidence graph"
        description="A live projection of how source artifacts feed memory nodes and how orchestration links those nodes into conflict, drift, and guidance context."
      >
        {interactiveGraph.nodes.length > 0 ? (
          <div className="graph-interactive-shell">
            <div className="graph-svg-panel" aria-label="Interactive artifact and memory graph">
              <svg className="graph-svg-canvas" viewBox="0 0 980 620" role="img" aria-labelledby="interactive-graph-title interactive-graph-description">
                <title id="interactive-graph-title">Izge artifact and memory graph</title>
                <desc id="interactive-graph-description">
                  Source artifact nodes sit on the left and connect to extracted memory nodes. Relationship edges connect memory nodes used by the orchestration runtime.
                </desc>
                <defs>
                  <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {interactiveGraph.edges.map((edge) => {
                  const fromNode = nodeById.get(edge.fromId)
                  const toNode = nodeById.get(edge.toId)
                  if (!fromNode || !toNode) {
                    return null
                  }
                  return (
                    <g key={edge.id}>
                      <line
                        className={selectedGraphEdge?.id === edge.id ? 'graph-svg-edge graph-svg-edge-active' : 'graph-svg-edge'}
                        x1={fromNode.x}
                        y1={fromNode.y}
                        x2={toNode.x}
                        y2={toNode.y}
                        markerEnd="url(#graph-arrow)"
                        onClick={() => {
                          setSelectedGraphEdgeId(edge.id)
                          setSelectedGraphNodeId(null)
                        }}
                      />
                    </g>
                  )
                })}
                {interactiveGraph.nodes.map((node) => (
                  <g
                    key={node.id}
                    className={selectedGraphNode?.id === node.id ? 'graph-svg-node graph-svg-node-active' : `graph-svg-node graph-svg-node-${node.kind}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.kind === 'artifact' ? 'Artifact' : 'Memory'} node: ${node.label}`}
                    transform={`translate(${node.x} ${node.y})`}
                    onClick={() => {
                      setSelectedGraphNodeId(node.id)
                      setSelectedGraphEdgeId(null)
                      if (node.memoryId) {
                        setSelectedMemoryId(node.memoryId)
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedGraphNodeId(node.id)
                        setSelectedGraphEdgeId(null)
                        if (node.memoryId) {
                          setSelectedMemoryId(node.memoryId)
                        }
                      }
                    }}
                  >
                    <circle className="graph-node-halo" r={node.kind === 'artifact' ? 28 : 22} />
                    <circle className="graph-node-circle" r={node.kind === 'artifact' ? 17 : 14} />
                    <text className="graph-node-label" x={node.kind === 'artifact' ? 26 : 20} y="-3">
                      {truncateGraphLabel(node.label)}
                    </text>
                    <text className="graph-node-subtitle" x={node.kind === 'artifact' ? 26 : 20} y="14">
                      {truncateGraphLabel(node.subtitle, 24)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <aside className="graph-detail-panel panel-subtle" aria-label="Selected graph item detail">
              {selectedGraphEdge ? (
                <div className="stack-md">
                  <div>
                    <p className="section-label">Selected edge</p>
                    <h4 className="section-title">{formatLabel(selectedGraphEdge.edgeType)}</h4>
                    <p className="table-secondary">Confidence {formatPercent(selectedGraphEdge.confidenceScore)}</p>
                  </div>
                  <dl className="meta-list compact-meta-list">
                    <div>
                      <dt>From</dt>
                      <dd>{nodeById.get(selectedGraphEdge.fromId)?.label ?? selectedGraphEdge.fromId}</dd>
                    </div>
                    <div>
                      <dt>To</dt>
                      <dd>{nodeById.get(selectedGraphEdge.toId)?.label ?? selectedGraphEdge.toId}</dd>
                    </div>
                    <div>
                      <dt>Evidence artifact</dt>
                      <dd>{selectedGraphEdge.sourceLink?.evidence_artifact_id ?? 'Source projection'}</dd>
                    </div>
                  </dl>
                  <p className="muted-copy">
                    Edges show how Izge's graph context lets orchestration compare claims, detect contradictions, and carry evidence into answer synthesis.
                  </p>
                </div>
              ) : selectedGraphNode ? (
                <div className="stack-md">
                  <div>
                    <p className="section-label">{selectedGraphNode.kind === 'artifact' ? 'Source artifact' : 'Memory node'}</p>
                    <h4 className="section-title">{selectedGraphNode.label}</h4>
                    <p className="table-secondary">{selectedGraphNode.subtitle}</p>
                  </div>
                  {selectedGraphNode.kind === 'artifact' && selectedGraphNode.artifactId ? (
                    <div className="graph-detail-actions inline-actions">
                      <a className="primary-button" href={api.artifactPreviewUrl(selectedGraphNode.artifactId)} target="_blank" rel="noreferrer">
                        Preview artifact
                      </a>
                      <a className="secondary-button" href={api.artifactDownloadUrl(selectedGraphNode.artifactId)}>
                        Download
                      </a>
                    </div>
                  ) : null}
                  {selectedGraphNode.kind === 'memory' && selectedGraphNode.memoryType && selectedGraphNode.memoryId ? (
                    <div className="stack-sm">
                      <p className="muted-copy">{selectedGraphNode.occurrence?.evidence_span ?? 'No evidence span recorded for this occurrence.'}</p>
                      <dl className="meta-list compact-meta-list">
                        <div>
                          <dt>Source</dt>
                          <dd>{selectedGraphNode.artifactTitle}</dd>
                        </div>
                        <div>
                          <dt>Observed</dt>
                          <dd>{formatDateTime(selectedGraphNode.occurrence?.observed_at)}</dd>
                        </div>
                        <div>
                          <dt>Confidence</dt>
                          <dd>{formatPercent(selectedGraphNode.confidenceScore ?? 0)}</dd>
                        </div>
                      </dl>
                      <div className="graph-detail-actions inline-actions">
                        <Link className="primary-button" to={`/memory/${selectedGraphNode.memoryType}/${selectedGraphNode.memoryId}`}>
                          Open memory
                        </Link>
                        {selectedGraphNode.artifactId ? (
                          <a className="secondary-button" href={api.artifactPreviewUrl(selectedGraphNode.artifactId)} target="_blank" rel="noreferrer">
                            Preview source
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState title="Select a node" description="Hover nodes to enlarge them, then click to inspect artifact and memory details." />
              )}
            </aside>
          </div>
        ) : (
          <EmptyState
            title="No graph projection yet"
            description="Run ingestion on company artifacts to create source nodes, extracted memory nodes, and orchestration-ready relationships."
          />
        )}
      </Panel>

      <Panel
        title="Temporal knowledge graph"
        description="Claim occurrences are grouped across time so a company can see first-seen, active, contested, stale, and superseded memory instead of a flat document search result."
      >
        {temporalGraph && temporalGraph.occurrences.length > 0 ? (
          <div className="stack-sm">
            <dl className="meta-list compact-meta-list">
              <div>
                <dt>Persisted families</dt>
                <dd>{temporalGraph.families.length}</dd>
              </div>
              <div>
                <dt>Visible occurrences</dt>
                <dd>{temporalGraph.occurrences.length}</dd>
              </div>
              <div>
                <dt>Temporal links</dt>
                <dd>{temporalGraph.links.length}</dd>
              </div>
              <div>
                <dt>Projection sync</dt>
                <dd>{String(temporalGraph.sync_summary.synced ?? '—')}</dd>
              </div>
            </dl>
            <div className="stack-sm">
              {temporalGraph.families.slice(0, 4).map((family) => (
                <article key={family.family_id} className="panel-subtle stack-sm">
                  <div className="timeline-card-head">
                    <div>
                      <p className="section-label">Claim family · {family.memory_type}</p>
                      <p className="table-primary">{family.title_or_label}</p>
                    </div>
                    <StatusBadge value={formatLabel(family.status)} />
                  </div>
                  <p className="table-secondary">
                    {family.claim_family_key} · {family.occurrence_count} occurrence(s) · latest {formatDateTime(family.latest_seen_at)}
                  </p>
                </article>
              ))}
            </div>
            {temporalGraph.occurrences.slice(0, 8).map((occurrence) => (
              <Link
                key={occurrence.occurrence_id}
                className="record-link panel-subtle"
                to={`/memory/${occurrence.memory_type}/${occurrence.memory_id}`}
              >
                <div>
                  <p className="table-primary">{occurrence.title_or_label}</p>
                  <p className="table-secondary">
                    {formatLabel(occurrence.status)} · {occurrence.memory_type} · {formatDateTime(occurrence.observed_at)}
                  </p>
                  <p className="muted-copy">
                    {occurrence.source_artifact_title} · family {occurrence.claim_family_key} · valid {formatDateTime(occurrence.valid_from)}
                    {occurrence.valid_to ? ` → ${formatDateTime(occurrence.valid_to)}` : ' → now'}
                  </p>
                </div>
                <span className="table-secondary">Confidence {formatPercent(occurrence.confidence_score)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No temporal claim occurrences"
            description="Run ingestion on company artifacts to populate time-aware decisions, assumptions, constraints, outcomes, and commitments."
          />
        )}
      </Panel>

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
          title={selectedTimelineItem ? 'Selected historical detail' : 'Timeline detail'}
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
                Open full historical detail
              </Link>
            </div>
          ) : (
            <EmptyState title="Nothing selected" description="Choose a timeline card to inspect its evidence-bearing memory details." />
          )}
        </Panel>
      </div>

      <Panel title="Graph neighborhood" description="Immediate neighbors show what this memory object was based on, constrained by, contradicted by, or linked to — with evidence attached to each edge.">
        {isNeighborhoodLoading ? <p className="muted-copy">Loading neighborhood…</p> : null}
        {!isNeighborhoodLoading && (!neighborhood || neighborhood.neighbors.length === 0) ? (
          <EmptyState title="No neighboring memory objects" description="This timeline item has no visible immediate graph neighbors in the current permission scope." />
        ) : null}
        {neighborhood && neighborhood.neighbors.length > 0 ? (
          <div className="stack-sm">
            {neighborhood.neighbors.map((neighbor) => (
              <article key={neighbor.edge_id} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <p className="table-primary">{formatLabel(neighbor.edge_type)} · {neighbor.direction === 'outgoing' ? 'from selected item' : 'into selected item'}</p>
                  <p className="table-secondary">Confidence {formatPercent(neighbor.confidence_score)}</p>
                </div>
                <Link className="record-link" to={`/memory/${neighbor.related_memory_type}/${neighbor.related_memory_id}`}>
                  <div>
                    <p className="table-primary">{neighbor.related_title_or_label}</p>
                    <p className="table-secondary">{neighbor.related_memory_type} · topic {neighbor.related_topic_key}</p>
                    {neighbor.related_status ? <p className="table-secondary">Status {formatLabel(neighbor.related_status)}</p> : null}
                  </div>
                </Link>
                {neighbor.evidence_artifact_title ? <p className="table-secondary">{neighbor.evidence_artifact_title}</p> : null}
                {neighbor.evidence_span ? <p className="muted-copy">{neighbor.evidence_span}</p> : null}
                {neighbor.evidence_provenance ? <p className="table-secondary">{neighbor.evidence_provenance}</p> : null}
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

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

        <Panel title="Relationship composition" description="Relationship coverage persisted in the explicit decision graph.">
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

      <Panel title="Persisted signal composition" description="Durable proactive signal records created by ingestion-time intelligence. Counts remain permission-aware through source artifact visibility.">
        {summary && Object.keys(summary.signal_counts).length > 0 ? (
          <div className="two-column-layout">
            <div className="stack-sm">
              {Object.entries(summary.signal_counts).map(([label, count]) => (
                <div key={label} className="stat-row">
                  <span>{formatLabel(label)}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
            <div className="stack-sm">
              {persistedSignals.slice(0, 5).map((signal) => (
                <Link key={signal.signal_id} className="record-link panel-subtle" to={`/signals/${signal.signal_id}`}>
                  <div>
                    <p className="table-primary">{signal.title}</p>
                    <p className="table-secondary">
                      {formatLabel(signal.signal_type)} · {signal.source_artifact_title ?? signal.source_artifact_id ?? 'unknown source'}
                    </p>
                  </div>
                  <span className="table-secondary">Urgency {formatPercent(signal.urgency_score)}</span>
                </Link>
              ))}
              {persistedSignals.length === 0 ? <p className="muted-copy">Counts exist, but no signal rows are visible in this permission scope.</p> : null}
            </div>
          </div>
        ) : (
          <EmptyState title="No persisted signals yet" description="Run ingestion on artifacts that interact with existing memory to persist contradiction, drift, supersession, and next-action signals." />
        )}
      </Panel>

      <div className="two-column-layout">
        <Panel title="Contradictions" description="Visible contradiction relationships surfaced from the explicit memory graph. These conflicts are first-class product events.">
          {contradictions.length === 0 ? (
            <EmptyState title="No contradiction edges" description="No contradiction records are currently visible in your scope." />
          ) : (
            <div className="stack-sm">
              {contradictions.map((item) => (
                <article key={item.edge_id} className="panel-subtle stack-sm critical-card">
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

        <Panel title="Assumption drift" description="Assumptions marked stale, reversed, or weakening by the memory-analysis surface.">
          {assumptionDrift.length === 0 ? (
            <EmptyState title="No drift signals" description="No visible assumption drift items are currently available." />
          ) : (
            <div className="stack-sm">
              {assumptionDrift.map((item) => (
                <article key={item.assumption_id} className="panel-subtle stack-sm drift-card">
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

      <Panel title="Recommended next actions" description="Guidance derived from active contradiction, drift, and open-commitment signals. This is the path forward layer, not a generic task list.">
        {nextActions.length === 0 ? (
          <EmptyState title="No next-action signals" description="No visible guidance can be grounded from the current memory graph yet." />
        ) : (
          <div className="stack-sm">
            {nextActions.map((item) => (
              <article key={item.signal_id} className="panel-subtle stack-sm action-card">
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">Next action · topic {item.related_topic}</p>
                    <p className="table-primary">{item.title}</p>
                  </div>
                  <p className="table-secondary">Urgency {formatPercent(item.urgency_score)} · uncertainty {formatPercent(item.uncertainty_score)}</p>
                </div>
                <p className="evidence-block">{item.recommended_action}</p>
                <p className="muted-copy">{item.grounded_reasoning}</p>
                {item.supporting_evidence.length > 0 ? (
                  <div className="stack-sm">
                    <p className="section-label">Evidence behind the action</p>
                    {item.supporting_evidence.slice(0, 2).map((evidence) => (
                      <article key={`${item.signal_id}-${evidence.artifact_id}-${evidence.chunk_id ?? 'root'}`} className="panel-subtle stack-sm">
                        <p className="table-secondary">{evidence.artifact_title} · {evidence.evidence_kind}</p>
                        <p className="muted-copy">{evidence.excerpt}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
                {item.supporting_memory_objects.length > 0 ? (
                  <p className="table-secondary">
                    Memory support: {item.supporting_memory_objects.map((memory) => `${formatLabel(memory.memory_type)}:${memory.title_or_label}`).join(' · ')}
                  </p>
                ) : null}
                {item.ranking_basis.length > 0 ? <p className="table-secondary">Ranked for: {item.ranking_basis.join(', ')}</p> : null}
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
