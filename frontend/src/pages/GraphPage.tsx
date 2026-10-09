import { translate } from '../lib/language'
import { SourcePreviewButton } from '../components/SourcePreviewButton'
import {
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { useLanguage } from '../lib/i18n'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  Callout,
  EmptyState,
  MetricCard,
  PageIntro,
  Panel,
  StatusBadge,
} from '../components/ui'
import { api, ApiError } from '../lib/api'
import {
  formatDate,
  formatDateTime,
  formatLabel,
  formatPercent,
} from '../lib/format'
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

interface GraphViewport {
  x: number
  y: number
  scale: number
}

interface GraphDragState {
  pointerId: number
  startClientX: number
  startClientY: number
  originX: number
  originY: number
}

const GRAPH_VIEWBOX_WIDTH = 980
const GRAPH_VIEWBOX_HEIGHT = 620
const GRAPH_MIN_SCALE = 0.55
const GRAPH_MAX_SCALE = 3.4

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function truncateGraphLabel(value: string, limit = 30): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

type GraphClusterKey =
  | 'launch'
  | 'security'
  | 'customer'
  | 'engineering'
  | 'operations'
  | 'general'

const GRAPH_CLUSTER_ANCHORS: Record<
  GraphClusterKey,
  { x: number; y: number; label: string }
> = {
  launch: { x: 260, y: 210, label: "Launch cluster" },
  security: { x: 675, y: 190, label: "Security cluster" },
  customer: { x: 690, y: 430, label: "Customer cluster" },
  engineering: { x: 455, y: 315, label: "Engineering cluster" },
  operations: { x: 265, y: 455, label: "Operations cluster" },
  general: { x: 500, y: 520, label: "Company memory" },
}

function graphClusterKey(title: string): GraphClusterKey {
  const normalizedTitle = title.toLowerCase()
  if (
    normalizedTitle.includes('security') ||
    normalizedTitle.includes('payroll') ||
    normalizedTitle.includes('access') ||
    normalizedTitle.includes('pii')
  ) {
    return 'security'
  }
  if (
    normalizedTitle.includes('support') ||
    normalizedTitle.includes('customer') ||
    normalizedTitle.includes('faq') ||
    normalizedTitle.includes('escalation')
  ) {
    return 'customer'
  }
  if (
    normalizedTitle.includes('engineering') ||
    normalizedTitle.includes('analytics') ||
    normalizedTitle.includes('incident') ||
    normalizedTitle.includes('vendor')
  ) {
    return 'engineering'
  }
  if (
    normalizedTitle.includes('finance') ||
    normalizedTitle.includes('hiring') ||
    normalizedTitle.includes('coverage') ||
    normalizedTitle.includes('people') ||
    normalizedTitle.includes('pto') ||
    normalizedTitle.includes('remote')
  ) {
    return 'operations'
  }
  if (
    normalizedTitle.includes('roadmap') ||
    normalizedTitle.includes('onboarding') ||
    normalizedTitle.includes('strategy') ||
    normalizedTitle.includes('runbook') ||
    normalizedTitle.includes('launch')
  ) {
    return 'launch'
  }
  return 'general'
}

function buildInteractiveGraph(
  temporalGraph: TemporalGraphRead | null,
): InteractiveGraphModel {
  if (!temporalGraph || temporalGraph.occurrences.length === 0) {
    return { nodes: [], edges: [] }
  }

  const artifactMap = new Map<string, string>()
  temporalGraph.occurrences.forEach((occurrence) => {
    artifactMap.set(
      occurrence.source_artifact_id,
      occurrence.source_artifact_title,
    )
  })
  const artifactEntries = Array.from(artifactMap.entries()).slice(0, 14)
  const visibleArtifactIds = new Set(artifactEntries.map(([artifactId]) => artifactId))
  const occurrencesByArtifact = new Map<string, TemporalGraphOccurrence[]>()
  temporalGraph.occurrences
    .filter((occurrence) => visibleArtifactIds.has(occurrence.source_artifact_id))
    .slice(0, 72)
    .forEach((occurrence) => {
      const current = occurrencesByArtifact.get(occurrence.source_artifact_id) ?? []
      if (current.length < 7) {
        current.push(occurrence)
        occurrencesByArtifact.set(occurrence.source_artifact_id, current)
      }
    })
  const nodes: InteractiveGraphNode[] = []
  const visibleOccurrences: TemporalGraphOccurrence[] = []

  const artifactEntriesByCluster = new Map<
    GraphClusterKey,
    Array<[string, string]>
  >()
  artifactEntries.forEach((entry) => {
    const key = graphClusterKey(entry[1])
    artifactEntriesByCluster.set(key, [
      ...(artifactEntriesByCluster.get(key) ?? []),
      entry,
    ])
  })

  Array.from(artifactEntriesByCluster.entries()).forEach(([clusterKey, entries]) => {
    const anchor = GRAPH_CLUSTER_ANCHORS[clusterKey]
    entries.forEach(([artifactId, artifactTitle], index) => {
      const angle = -Math.PI / 2 + (index / Math.max(entries.length, 1)) * Math.PI * 2
      const radius = entries.length === 1 ? 0 : 62 + Math.min(entries.length, 4) * 8
      const artifactX = anchor.x + Math.cos(angle) * radius
      const artifactY = anchor.y + Math.sin(angle) * radius * 0.72
      const artifactOccurrences = occurrencesByArtifact.get(artifactId) ?? []
      nodes.push({
        id: `artifact:${artifactId}`,
        kind: 'artifact',
        label: artifactTitle,
        subtitle: GRAPH_CLUSTER_ANCHORS[clusterKey].label,
        x: clamp(artifactX, 80, GRAPH_VIEWBOX_WIDTH - 80),
        y: clamp(artifactY, 86, GRAPH_VIEWBOX_HEIGHT - 76),
        artifactId,
        artifactTitle,
      })

      artifactOccurrences.forEach((occurrence, occurrenceIndex) => {
        visibleOccurrences.push(occurrence)
        const occurrenceAngle =
          -Math.PI / 2 +
          (occurrenceIndex / Math.max(artifactOccurrences.length, 1)) *
            Math.PI *
            2
        const occurrenceRadius =
          occurrence.memory_type === 'constraint' ||
          occurrence.memory_type === 'decision'
            ? 54
            : 72
        nodes.push({
          id: occurrence.occurrence_id,
          kind: 'memory',
          label: occurrence.title_or_label,
          subtitle: `${formatLabel(occurrence.memory_type)} · ${formatLabel(occurrence.status)}`,
          x: clamp(
            artifactX + Math.cos(occurrenceAngle) * occurrenceRadius,
            42,
            GRAPH_VIEWBOX_WIDTH - 42,
          ),
          y: clamp(
            artifactY + Math.sin(occurrenceAngle) * occurrenceRadius,
            42,
            GRAPH_VIEWBOX_HEIGHT - 42,
          ),
          memoryType: occurrence.memory_type,
          memoryId: occurrence.memory_id,
          occurrence,
          artifactId: occurrence.source_artifact_id,
          artifactTitle: occurrence.source_artifact_title,
          confidenceScore: occurrence.confidence_score,
        })
      })
    })
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const occurrenceArtifactById = new Map(
    visibleOccurrences.map((occurrence) => [
      occurrence.occurrence_id,
      occurrence.source_artifact_id,
    ]),
  )
  const edges: InteractiveGraphEdge[] = []
  const artifactEdgeKeys = new Set<string>()

  visibleOccurrences.forEach((occurrence) => {
    const fromId = `artifact:${occurrence.source_artifact_id}`
    if (!nodeIds.has(fromId) || !nodeIds.has(occurrence.occurrence_id)) {
      return
    }
    edges.push({
      id: `source:${occurrence.occurrence_id}`,
      fromId,
      toId: occurrence.occurrence_id,
      edgeType: 'source_artifact',
      confidenceScore: occurrence.confidence_score,
    })
  })

  temporalGraph.links.forEach((link) => {
    const fromArtifactId = occurrenceArtifactById.get(link.from_occurrence_id)
    const toArtifactId = occurrenceArtifactById.get(link.to_occurrence_id)
    if (!fromArtifactId || !toArtifactId || fromArtifactId === toArtifactId) {
      return
    }
    const fromId = `artifact:${fromArtifactId}`
    const toId = `artifact:${toArtifactId}`
    if (!nodeIds.has(fromId) || !nodeIds.has(toId)) {
      return
    }
    const [leftArtifactId, rightArtifactId] = [fromArtifactId, toArtifactId].sort()
    const edgeKey = `${leftArtifactId}:${rightArtifactId}:${link.edge_type}`
    if (artifactEdgeKeys.has(edgeKey)) {
      return
    }
    artifactEdgeKeys.add(edgeKey)
    edges.push({
      id: `artifact-link:${edgeKey}`,
      fromId,
      toId,
      edgeType: link.edge_type,
      confidenceScore: link.confidence_score,
      sourceLink: link,
    })
  })

  return { nodes, edges }
}

export function GraphPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [timelineItems, setTimelineItems] = useState<GraphTimelineItem[]>([])
  const [neighborhood, setNeighborhood] = useState<GraphNeighborhood | null>(
    null,
  )
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([])
  const [assumptionDrift, setAssumptionDrift] = useState<AssumptionDriftItem[]>(
    [],
  )
  const [nextActions, setNextActions] = useState<NextActionSignalItem[]>([])
  const [persistedSignals, setPersistedSignals] = useState<SignalRead[]>([])
  const [temporalGraph, setTemporalGraph] = useState<TemporalGraphRead | null>(
    null,
  )
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null)
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(
    null,
  )
  const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState<string | null>(
    null,
  )
  const [hoveredGraphNodeId, setHoveredGraphNodeId] = useState<string | null>(
    null,
  )
  const [graphViewport, setGraphViewport] = useState<GraphViewport>({
    x: 0,
    y: 0,
    scale: 1,
  })
  const [graphDragState, setGraphDragState] = useState<GraphDragState | null>(
    null,
  )
  const [isNeighborhoodLoading, setIsNeighborhoodLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }

      try {
        const [
          graphSummary,
          graphTimeline,
          contradictionList,
          assumptionList,
          actionList,
          signalList,
          temporalGraphPayload,
        ] = await Promise.all([
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
          setError(
            caughtError instanceof ApiError
              ? caughtError.message
              : t('Unable to load graph overview.', 'Grafik özeti yüklenemedi.'),
          )
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [session?.token, t])

  const selectedTimelineItem = useMemo(
    () =>
      timelineItems.find((item) => item.memory_id === selectedMemoryId) ??
      timelineItems[0] ??
      null,
    [selectedMemoryId, timelineItems],
  )
  const interactiveGraph = useMemo(
    () => buildInteractiveGraph(temporalGraph),
    [temporalGraph],
  )
  const selectedGraphNode = useMemo(
    () =>
      selectedGraphEdgeId
        ? null
        : (interactiveGraph.nodes.find(
            (node) => node.id === selectedGraphNodeId,
          ) ?? null),
    [interactiveGraph.nodes, selectedGraphEdgeId, selectedGraphNodeId],
  )
  const selectedGraphEdge = useMemo(
    () =>
      interactiveGraph.edges.find((edge) => edge.id === selectedGraphEdgeId) ??
      null,
    [interactiveGraph.edges, selectedGraphEdgeId],
  )
  const nodeById = useMemo(
    () => new Map(interactiveGraph.nodes.map((node) => [node.id, node])),
    [interactiveGraph.nodes],
  )

  function zoomGraph(
    multiplier: number,
    center = { x: GRAPH_VIEWBOX_WIDTH / 2, y: GRAPH_VIEWBOX_HEIGHT / 2 },
  ) {
    setGraphViewport((current) => {
      const nextScale = clamp(
        current.scale * multiplier,
        GRAPH_MIN_SCALE,
        GRAPH_MAX_SCALE,
      )
      const scaleRatio = nextScale / current.scale
      return {
        scale: nextScale,
        x: center.x - (center.x - current.x) * scaleRatio,
        y: center.y - (center.y - current.y) * scaleRatio,
      }
    })
  }

  function resetGraphViewport() {
    setGraphViewport({ x: 0, y: 0, scale: 1 })
    setGraphDragState(null)
  }

  function handleGraphWheel(event: ReactWheelEvent<SVGSVGElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      return
    }
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const center = {
      x: ((event.clientX - bounds.left) / bounds.width) * GRAPH_VIEWBOX_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * GRAPH_VIEWBOX_HEIGHT,
    }
    zoomGraph(event.deltaY < 0 ? 1.14 : 0.88, center)
  }

  function handleGraphPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const target = event.target as Element
    if (
      target.closest('.graph-svg-node, .graph-svg-edge, .graph-toolbar-button')
    ) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setGraphDragState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: graphViewport.x,
      originY: graphViewport.y,
    })
  }

  function handleGraphPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!graphDragState || graphDragState.pointerId !== event.pointerId) {
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    const deltaX =
      ((event.clientX - graphDragState.startClientX) / bounds.width) *
      GRAPH_VIEWBOX_WIDTH
    const deltaY =
      ((event.clientY - graphDragState.startClientY) / bounds.height) *
      GRAPH_VIEWBOX_HEIGHT
    setGraphViewport((current) => ({
      ...current,
      x: graphDragState.originX + deltaX,
      y: graphDragState.originY + deltaY,
    }))
  }

  function handleGraphPointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    if (graphDragState?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      setGraphDragState(null)
    }
  }

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
        const payload = await api.getGraphNeighborhood(
          session.token,
          selectedTimelineItem.memory_type,
          selectedTimelineItem.memory_id,
        )
        if (!cancelled) {
          setNeighborhood(payload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setNeighborhood(null)
          setError(
            caughtError instanceof ApiError
              ? caughtError.message
              : t('Unable to load graph neighborhood.', 'Grafik bağlantıları yüklenemedi.'),
          )
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
  }, [selectedTimelineItem, session?.token, t])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Knowledge graph', 'Bilgi grafiği')}
        title={t('Company knowledge graph', 'Şirket bilgi grafiği')}
        description={t('Explore how sources, memory records, contradictions, drift signals, and follow-up actions connect.', 'Kaynakların, hafıza kayıtlarının, çelişkilerin, değişim sinyallerinin ve takip eylemlerinin nasıl bağlandığını keşfedin.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard
          label={t('Trusted sources', 'Güvenilir kaynaklar')}
          value={summary?.artifact_count ?? '—'}
        />
        <MetricCard
          label={t('Timeline cards', 'Zaman çizelgesi kartları')}
          value={timelineItems.length || '—'}
        />
        <MetricCard
          label={t('Relationship types', 'İlişki türleri')}
          value={Object.keys(summary?.edge_counts ?? {}).length || '—'}
        />
        <MetricCard
          label={t('Contradictions surfaced', 'Bulunan çelişkiler')}
          value={contradictions.length}
        />
        <MetricCard
          label={t('Persisted signals', 'Kaydedilen sinyaller')}
          value={persistedSignals.length || nextActions.length}
        />
        <MetricCard
          label={t('Temporal claims', 'Zamansal ifadeler')}
          value={temporalGraph?.occurrences.length ?? '—'}
          detail={t(`${temporalGraph?.families.length ?? 0} persisted families`, `${temporalGraph?.families.length ?? 0} kayıtlı grup`)}
        />
      </section>

      <Panel
        title={t('Interactive evidence graph', 'Etkileşimli kanıt grafiği')}
        description={t('Pan, zoom, hover, and select nodes to inspect sources and memory records.', 'Kaynakları ve hafıza kayıtlarını incelemek için grafiği kaydırın, yakınlaştırın ve düğümleri seçin.')}
      >
        {interactiveGraph.nodes.length > 0 ? (
          <div className="graph-interactive-shell">
            <div
              className="graph-svg-panel"
              aria-label={t('Interactive artifact and memory graph', 'Etkileşimli kaynak ve hafıza grafiği')}
            >
              <div className="graph-toolbar" aria-label={t('Graph controls', 'Grafik kontrolleri')}>
                <button
                  type="button"
                  className="secondary-button graph-toolbar-button"
                  onClick={() => zoomGraph(1.2)}
                >{t("Zoom in", "Yakınlaştır")}</button>
                <button
                  type="button"
                  className="secondary-button graph-toolbar-button"
                  onClick={() => zoomGraph(0.84)}
                >{t("Zoom out", "Uzaklaştır")}</button>
                <button
                  type="button"
                  className="secondary-button graph-toolbar-button"
                  onClick={resetGraphViewport}
                >{t("Reset", "Sıfırla")}</button>
              </div>
              <svg
                className="graph-svg-canvas"
                data-dragging={graphDragState ? 'true' : 'false'}
                viewBox={`0 0 ${GRAPH_VIEWBOX_WIDTH} ${GRAPH_VIEWBOX_HEIGHT}`}
                role="img"
                aria-labelledby="interactive-graph-title interactive-graph-description"
                onWheel={handleGraphWheel}
                onPointerDown={handleGraphPointerDown}
                onPointerMove={handleGraphPointerMove}
                onPointerUp={handleGraphPointerEnd}
                onPointerCancel={handleGraphPointerEnd}
                onPointerLeave={handleGraphPointerEnd}
              >
                <title id="interactive-graph-title">{t("Izge artifact and memory graph", "İzge kaynak ve hafıza grafiği")}</title>
                <desc id="interactive-graph-description">{t("Source artifacts connect to extracted memory and relationship edges.", "Kaynaklar, çıkarılan hafıza kayıtları ve ilişki bağlantılarıyla birleşir.")}</desc>
                <defs>
                  <marker
                    id="graph-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                <g
                  className="graph-viewport-layer"
                  transform={`translate(${graphViewport.x} ${graphViewport.y}) scale(${graphViewport.scale})`}
                >
                  {interactiveGraph.edges.map((edge) => {
                    const fromNode = nodeById.get(edge.fromId)
                    const toNode = nodeById.get(edge.toId)
                    if (!fromNode || !toNode) {
                      return null
                    }
                    return (
                      <g key={edge.id}>
                        <line
                          className={
                            selectedGraphEdge?.id === edge.id
                              ? `graph-svg-edge graph-svg-edge-${edge.edgeType} graph-svg-edge-active`
                              : `graph-svg-edge graph-svg-edge-${edge.edgeType}`
                          }
                          x1={fromNode.x}
                          y1={fromNode.y}
                          x2={toNode.x}
                          y2={toNode.y}
                          markerEnd={
                            edge.edgeType === 'source_artifact'
                              ? undefined
                              : 'url(#graph-arrow)'
                          }
                          onClick={() => {
                            setSelectedGraphEdgeId(edge.id)
                            setSelectedGraphNodeId(null)
                          }}
                        />
                      </g>
                    )
                  })}
                  {interactiveGraph.nodes.map((node) => {
                    const labelVisible =
                      hoveredGraphNodeId === node.id ||
                      selectedGraphNode?.id === node.id
                    return (
                      <g
                        key={node.id}
                        className={
                          selectedGraphNode?.id === node.id
                            ? 'graph-svg-node graph-svg-node-active'
                            : `graph-svg-node graph-svg-node-${node.kind}`
                        }
                        role="button"
                        tabIndex={0}
                        aria-label={t(`${node.kind === 'artifact' ? 'Artifact' : 'Memory'} node: ${node.label}`, `${node.kind === 'artifact' ? 'Kaynak' : 'Hafıza'} düğümü: ${node.label}`)}
                        transform={`translate(${node.x} ${node.y})`}
                        onPointerEnter={() => setHoveredGraphNodeId(node.id)}
                        onPointerLeave={() =>
                          setHoveredGraphNodeId((current) =>
                            current === node.id ? null : current,
                          )
                        }
                        onFocus={() => setHoveredGraphNodeId(node.id)}
                        onBlur={() =>
                          setHoveredGraphNodeId((current) =>
                            current === node.id ? null : current,
                          )
                        }
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
                        <circle
                          className="graph-node-halo"
                          r={node.kind === 'artifact' ? 28 : 22}
                        />
                        <circle
                          className="graph-node-circle"
                          r={node.kind === 'artifact' ? 17 : 14}
                        />
                        {labelVisible ? (
                          <g className="graph-node-tooltip" aria-hidden="true">
                            <text
                              className="graph-node-label"
                              x={node.kind === 'artifact' ? 26 : 20}
                              y="-3"
                            >
                              {truncateGraphLabel(node.label)}
                            </text>
                            <text
                              className="graph-node-subtitle"
                              x={node.kind === 'artifact' ? 26 : 20}
                              y="14"
                            >
                              {truncateGraphLabel(formatLabel(node.subtitle), 24)}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    )
                  })}
                </g>
              </svg>
            </div>

            <aside
              className="graph-detail-panel panel-subtle"
              aria-label={t('Selected graph item detail', 'Seçilen grafik öğesi ayrıntısı')}
            >
              {selectedGraphEdge ? (
                <div className="stack-md">
                  <div>
                    <p className="section-label">{t('Selected edge', 'Seçilen bağlantı')}</p>
                    <h4 className="section-title">
                      {formatLabel(selectedGraphEdge.edgeType)}
                    </h4>
                    <p className="table-secondary">{t("Confidence", "Güven")}{' '}
                      {formatPercent(selectedGraphEdge.confidenceScore)}
                    </p>
                  </div>
                  <dl className="meta-list compact-meta-list">
                    <div>
                      <dt>{t('From', 'Başlangıç')}</dt>
                      <dd>
                        {nodeById.get(selectedGraphEdge.fromId)?.label ??
                          selectedGraphEdge.fromId}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('To', 'Bitiş')}</dt>
                      <dd>
                        {nodeById.get(selectedGraphEdge.toId)?.label ??
                          selectedGraphEdge.toId}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('Evidence artifact', 'Kanıt kaynağı')}</dt>
                      <dd>
                        {selectedGraphEdge.sourceLink?.evidence_artifact_id ??
                          t('Source projection', 'Kaynak yansıtması')}
                      </dd>
                    </div>
                  </dl>
                  <p className="muted-copy">{t("Edges show how Izge's graph context lets orchestration compare claims, detect contradictions, and carry evidence into answer synthesis.", "Bağlantılar, İzge’nin iddiaları karşılaştırmak, çelişkileri tespit etmek ve yanıtları kaynaklandırmak için kullandığı grafiği gösterir.")}</p>
                </div>
              ) : selectedGraphNode ? (
                <div className="stack-md">
                  <div>
                    <p className="section-label">
                      {selectedGraphNode.kind === 'artifact'
                        ? translate("Source artifact", "Kaynak dosya")
                        : translate("Memory node", "Hafıza düğümü")}
                    </p>
                    <h4 className="section-title">{selectedGraphNode.label}</h4>
                    <p className="table-secondary">
                      {formatLabel(selectedGraphNode.subtitle)}
                    </p>
                  </div>
                  {selectedGraphNode.kind === 'artifact' &&
                  selectedGraphNode.artifactId ? (
                    <div className="graph-detail-actions inline-actions">
                      <SourcePreviewButton artifactId={selectedGraphNode.artifactId} title={selectedGraphNode.label} className="primary-button">{t('Preview artifact', 'Kaynağı önizle')}</SourcePreviewButton>
                      <a
                        className="secondary-button"
                        href={api.artifactDownloadUrl(
                          selectedGraphNode.artifactId,
                        )}
                      >{t("Download", "İndir")}</a>
                    </div>
                  ) : null}
                  {selectedGraphNode.kind === 'memory' &&
                  selectedGraphNode.memoryType &&
                  selectedGraphNode.memoryId ? (
                    <div className="stack-sm">
                      <p className="muted-copy">
                        {selectedGraphNode.occurrence?.evidence_span ??
                          translate("No evidence span recorded for this occurrence.", "Bu kayıt için kaynak alıntısı yok.")}
                      </p>
                      <dl className="meta-list compact-meta-list">
                        <div>
                          <dt>{t('Source', 'Kaynak')}</dt>
                          <dd>{selectedGraphNode.artifactTitle}</dd>
                        </div>
                        <div>
                          <dt>{t('Observed', 'Gözlemlendi')}</dt>
                          <dd>
                            {formatDateTime(
                              selectedGraphNode.occurrence?.observed_at,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Confidence', 'Güven')}</dt>
                          <dd>
                            {formatPercent(
                              selectedGraphNode.confidenceScore ?? 0,
                            )}
                          </dd>
                        </div>
                      </dl>
                      <div className="graph-detail-actions inline-actions">
                        <Link
                          className="primary-button"
                          to={`/memory/${selectedGraphNode.memoryType}/${selectedGraphNode.memoryId}`}
                        >{t("Open memory", "Hafızayı aç")}</Link>
                        {selectedGraphNode.artifactId ? (
                          <SourcePreviewButton artifactId={selectedGraphNode.artifactId} title={selectedGraphNode.label} className="secondary-button">{t('Preview source', 'Kaynağı önizle')}</SourcePreviewButton>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  title={t('Select a node', 'Bir düğüm seçin')}
                  description={t('Hover nodes to enlarge them, then click to inspect source and memory details.', 'Düğümleri büyütmek için üzerine gelin; kaynak ve hafıza ayrıntılarını incelemek için tıklayın.')}
                />
              )}
            </aside>
          </div>
        ) : (
          <EmptyState
            title={t('No graph projection yet', 'Henüz grafik yansıtması yok')}
            description={t('Process company sources to create source nodes, extracted memory nodes, and orchestration-ready relationships.', 'Kaynak düğümleri, çıkarılmış hafıza düğümleri ve orkestrasyona hazır ilişkiler oluşturmak için şirket kaynaklarını işleyin.')}
          />
        )}
      </Panel>

      <Panel
        title={t('Temporal knowledge graph', 'Zamansal bilgi grafiği')}
        description={t('Claims are grouped across time so a company can see first-seen, active, contested, stale, and superseded memory.', 'İfadeler zaman boyunca gruplanır; şirket ilk görülen, etkin, tartışmalı, eski ve yerine geçen hafızayı görebilir.')}
      >
        {temporalGraph && temporalGraph.occurrences.length > 0 ? (
          <div className="stack-sm">
            <dl className="meta-list compact-meta-list">
              <div>
                <dt>{t('Persisted families', 'Kaydedilen aileler')}</dt>
                <dd>{temporalGraph.families.length}</dd>
              </div>
              <div>
                <dt>{t('Visible occurrences', 'Görünür kayıtlar')}</dt>
                <dd>{temporalGraph.occurrences.length}</dd>
              </div>
              <div>
                <dt>{t('Temporal links', 'Zamansal bağlantılar')}</dt>
                <dd>{temporalGraph.links.length}</dd>
              </div>
              <div>
                <dt>{t('Projection sync', 'Yansıtma eşitlemesi')}</dt>
                <dd>{String(temporalGraph.sync_summary.synced ?? '—')}</dd>
              </div>
            </dl>
            <div className="stack-sm">
              {temporalGraph.families.slice(0, 4).map((family) => (
                <article
                  key={family.family_id}
                  className="panel-subtle stack-sm"
                >
                  <div className="timeline-card-head">
                    <div>
                      <p className="section-label">{t("Claim family ·", "İddia grubu ·")}{family.memory_type}
                      </p>
                      <p className="table-primary">{family.title_or_label}</p>
                    </div>
                    <StatusBadge value={family.status} />
                  </div>
                  <p className="table-secondary">
                    {family.claim_family_key} · {family.occurrence_count}{' '}{t("occurrence(s) · latest", "kayıt · en güncel")}{' '}
                    {formatDateTime(family.latest_seen_at)}
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
                    {formatLabel(occurrence.status)} · {occurrence.memory_type}{' '}
                    · {formatDateTime(occurrence.observed_at)}
                  </p>
                  <p className="muted-copy">
                    {occurrence.source_artifact_title}{t(" · family", " · grup")}{' '}
                    {occurrence.claim_family_key}{t(" · valid", " · geçerli")}{' '}
                    {formatDateTime(occurrence.valid_from)}
                    {occurrence.valid_to
                      ? ` → ${formatDateTime(occurrence.valid_to)}`
                      : ' → now'}
                  </p>
                </div>
                <span className="table-secondary">{t("Confidence", "Güven")}{formatPercent(occurrence.confidence_score)}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t('No temporal claim occurrences', 'Zamansal ifade kaydı yok')}
            description={t('Process company sources to populate time-aware decisions, assumptions, constraints, outcomes, and commitments.', 'Zamana duyarlı kararları, varsayımları, kısıtları, sonuçları ve taahhütleri oluşturmak için şirket kaynaklarını işleyin.')}
          />
        )}
      </Panel>

      <div className="two-column-layout wide-right-column">
        <Panel
          title={t('Timeline of remembered changes', 'Hatırlanan değişikliklerin zaman çizelgesi')}
          description={t('Ordered memory cards present a historical reconstruction rather than graph decoration.', 'Sıralı hafıza kartları grafik süsü yerine geçmişin yeniden kurulmasını sunar.')}
        >
          {timelineItems.length === 0 ? (
            <EmptyState
              title={t('No timeline entries yet', 'Henüz zaman çizelgesi kaydı yok')}
              description={t('Process roadmap sources to populate the institutional memory timeline.', 'Kurumsal hafıza zaman çizelgesini oluşturmak için yol haritası kaynaklarını işleyin.')}
            />
          ) : (
            <div className="timeline-list">
              {timelineItems.map((item) => (
                <button
                  key={`${item.memory_type}-${item.memory_id}`}
                  type="button"
                  className={
                    selectedTimelineItem?.memory_id === item.memory_id
                      ? 'timeline-card timeline-card-active'
                      : 'timeline-card'
                  }
                  onClick={() => setSelectedMemoryId(item.memory_id)}
                >
                  <div className="timeline-card-head">
                    <p className="section-label">
                      {formatDate(item.event_timestamp)}
                    </p>
                    <StatusBadge value={item.timeline_status} />
                  </div>
                  <p className="table-primary">{item.title_or_label}</p>
                  <p className="table-secondary">
                    {item.memory_type}{t(" · topic ", " · konu ")}{item.topic_key}
                  </p>
                  <p className="muted-copy">{item.source_artifact_title}</p>
                  <div className="timeline-stats">
                    <span>{item.related_count}{t(" linked", " bağlantılı")}</span>
                    <span>{item.contradiction_count}{t(" contradictions", " çelişki")}</span>
                    <span>{item.supersedes_count}{t(" supersessions", " güncellenen karar")}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={
            selectedTimelineItem
              ? translate("Selected historical detail", "Seçilen geçmiş ayrıntısı")
              : translate("Timeline detail", "Zaman çizelgesi ayrıntısı")
          }
          description={
            selectedTimelineItem
              ? translate("Inspect evidence-bearing memory details and jump directly into the dedicated memory page.", "Kaynaklı hafıza ayrıntılarını inceleyin ve ilgili hafıza sayfasını açın.")
              : translate("Select a timeline card to inspect its evidence context.", "Kaynak bağlamını incelemek için bir zaman çizelgesi kartı seçin.")
          }
        >
          {selectedTimelineItem ? (
            <div className="stack-md">
              <div className="detail-grid">
                <article className="panel-subtle detail-card">
                  <p className="section-label">{t('Kind', 'Tür')}</p>
                  <p className="table-primary">
                    {selectedTimelineItem.memory_type}
                  </p>
                </article>
                <article className="panel-subtle detail-card">
                  <p className="section-label">{t('Observed', 'Gözlemlendi')}</p>
                  <p className="table-primary">
                    {formatDateTime(selectedTimelineItem.event_timestamp)}
                  </p>
                </article>
              </div>

              <div className="panel-subtle stack-sm">
                <p className="section-label">{t('Historical reading', 'Geçmiş okuması')}</p>
                <p className="table-primary">
                  {selectedTimelineItem.title_or_label}
                </p>
                <p className="table-secondary">
                  {selectedTimelineItem.source_artifact_title}{t(" · status", " · durum")}{' '}
                  {formatLabel(selectedTimelineItem.timeline_status)}
                </p>
                {selectedTimelineItem.owner_label ? (
                  <p className="table-secondary">{t("Owner:", "Sorumlu:")}{selectedTimelineItem.owner_label}
                  </p>
                ) : null}
                {selectedTimelineItem.due_date ? (
                  <p className="table-secondary">{t("Due:", "Son tarih:")}{formatDate(selectedTimelineItem.due_date)}
                  </p>
                ) : null}
                <p className="muted-copy">
                  {selectedTimelineItem.evidence_span ??
                    translate("No explicit evidence span recorded for this timeline item.", "Bu zaman çizelgesi kaydı için kaynak alıntısı yok.")}
                </p>
              </div>

              <dl className="meta-list compact-meta-list">
                <div>
                  <dt>{t('Related links', 'İlgili bağlantılar')}</dt>
                  <dd>{selectedTimelineItem.related_count}</dd>
                </div>
                <div>
                  <dt>{t('Contradictions', 'Çelişkiler')}</dt>
                  <dd>{selectedTimelineItem.contradiction_count}</dd>
                </div>
                <div>
                  <dt>{t('Supersessions', 'Yerine geçmeler')}</dt>
                  <dd>{selectedTimelineItem.supersedes_count}</dd>
                </div>
                <div>
                  <dt>{t('Source chunk', 'Kaynak bölümü')}</dt>
                  <dd>
                    {selectedTimelineItem.source_chunk_id ?? 'Unavailable'}
                  </dd>
                </div>
              </dl>

              <Link
                className="secondary-button"
                to={`/memory/${selectedTimelineItem.memory_type}/${selectedTimelineItem.memory_id}`}
              >{t("Open full historical detail", "Geçmişin tüm ayrıntılarını aç")}</Link>
            </div>
          ) : (
            <EmptyState
              title={t('Nothing selected', 'Seçim yapılmadı')}
              description={t('Choose a timeline card to inspect its evidence-bearing memory details.', 'Kanıt taşıyan hafıza ayrıntılarını incelemek için bir zaman çizelgesi kartı seçin.')}
            />
          )}
        </Panel>
      </div>

      <Panel
        title={t('Graph neighborhood', 'Grafik komşuluğu')}
        description={t('Immediate neighbors show what this memory object was based on, constrained by, contradicted by, or linked to, with evidence on each edge.', 'Yakın komşular bu hafıza nesnesinin neye dayandığını, neyle kısıtlandığını, çeliştiğini veya bağlandığını her bağlantının kanıtıyla gösterir.')}
      >
        {isNeighborhoodLoading ? (
          <p className="muted-copy">{t('Loading neighborhood…', 'Bağlantılar yükleniyor…')}</p>
        ) : null}
        {!isNeighborhoodLoading &&
        (!neighborhood || neighborhood.neighbors.length === 0) ? (
          <EmptyState
            title={t('No neighboring memory objects', 'Komşu hafıza nesnesi yok')}
            description={t('This timeline item has no visible immediate graph neighbors in the current permission scope.', 'Bu zaman çizelgesi öğesinin mevcut izin alanında görünür yakın komşusu yok.')}
          />
        ) : null}
        {neighborhood && neighborhood.neighbors.length > 0 ? (
          <div className="stack-sm">
            {neighborhood.neighbors.map((neighbor) => (
              <article key={neighbor.edge_id} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <p className="table-primary">
                    {formatLabel(neighbor.edge_type)} ·{' '}
                    {neighbor.direction === 'outgoing'
                      ? translate("from selected item", "seçilen kayıttan")
                      : translate("into selected item", "seçilen kayda")}
                  </p>
                  <p className="table-secondary">{t("Confidence", "Güven")}{formatPercent(neighbor.confidence_score)}
                  </p>
                </div>
                <Link
                  className="record-link"
                  to={`/memory/${neighbor.related_memory_type}/${neighbor.related_memory_id}`}
                >
                  <div>
                    <p className="table-primary">
                      {neighbor.related_title_or_label}
                    </p>
                    <p className="table-secondary">
                      {neighbor.related_memory_type}{t(" · topic", " · konu")}{' '}
                      {neighbor.related_topic_key}
                    </p>
                    {neighbor.related_status ? (
                      <p className="table-secondary">{t("Status", "Durum")}{formatLabel(neighbor.related_status)}
                      </p>
                    ) : null}
                  </div>
                </Link>
                {neighbor.evidence_artifact_title ? (
                  <p className="table-secondary">
                    {neighbor.evidence_artifact_title}
                  </p>
                ) : null}
                {neighbor.evidence_span ? (
                  <p className="muted-copy">{neighbor.evidence_span}</p>
                ) : null}
                {neighbor.evidence_provenance ? (
                  <p className="table-secondary">
                    {neighbor.evidence_provenance}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="two-column-layout">
        <Panel
          title={t('Memory composition', 'Hafıza bileşimi')}
          description={t('Counts of persisted memory objects across the graph model.', 'Grafik modelindeki kayıtlı hafıza nesnelerinin sayıları.')}
        >
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
            <EmptyState
              title={t('Awaiting graph summary', 'Grafik özeti bekleniyor')}
              description={t('Summary counts will appear when the system responds.', 'Sistem yanıt verdiğinde özet sayılar görünür.')}
            />
          )}
        </Panel>

        <Panel
          title={t('Relationship composition', 'İlişki bileşimi')}
          description={t('Relationship coverage persisted in the decision graph.', 'Karar grafiğinde kaydedilen ilişki kapsamı.')}
        >
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
            <EmptyState
              title={t('Awaiting edge counts', 'Bağlantı sayıları bekleniyor')}
              description={t('Edge-family counts will appear when graph summary data arrives.', 'Grafik özeti geldiğinde bağlantı ailesi sayıları görünür.')}
            />
          )}
        </Panel>
      </div>

      <Panel
        title={t('Persisted signal composition', 'Kaydedilen sinyal bileşimi')}
        description={t('Durable proactive signal records created during processing. Counts remain permission-aware through source visibility.', 'İşleme sırasında oluşturulan kalıcı proaktif sinyal kayıtları. Sayılar kaynak görünürlüğüne göre izinleri korur.')}
      >
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
                <Link
                  key={signal.signal_id}
                  className="record-link panel-subtle"
                  to={`/signals/${signal.signal_id}`}
                >
                  <div>
                    <p className="table-primary">{signal.title}</p>
                    <p className="table-secondary">
                      {formatLabel(signal.signal_type)} ·{' '}
                      {signal.source_artifact_title ??
                        signal.source_artifact_id ??
                        translate("unknown source", "bilinmeyen kaynak")}
                    </p>
                  </div>
                  <span className="table-secondary">{t("Urgency", "Aciliyet")}{formatPercent(signal.urgency_score)}
                  </span>
                </Link>
              ))}
              {persistedSignals.length === 0 ? (
                <p className="muted-copy">{t("Counts exist, but no signal rows are visible in this permission scope.", "Kayıt sayıları mevcut, ancak bu erişim kapsamında görünen sinyal yok.")}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState
            title={t('No persisted signals yet', 'Henüz kayıtlı sinyal yok')}
            description={t('Process sources that interact with existing memory to persist contradiction, drift, supersession, and next-action signals.', 'Çelişki, değişim, yerine geçme ve sonraki eylem sinyallerini kaydetmek için mevcut hafızayla ilişkili kaynakları işleyin.')}
          />
        )}
      </Panel>

      <div className="two-column-layout">
        <Panel
          title={t('Contradictions', 'Çelişkiler')}
          description={t('Visible contradiction relationships surfaced from the memory graph.', 'Hafıza grafiğinde bulunan görünür çelişki ilişkileri.')}
        >
          {contradictions.length === 0 ? (
            <EmptyState
              title={t('No contradiction edges', 'Çelişki bağlantısı yok')}
              description={t('No contradiction records are currently visible in your scope.', 'Alanınızda şu anda görünür çelişki kaydı yok.')}
            />
          ) : (
            <div className="stack-sm">
              {contradictions.map((item) => (
                <article
                  key={item.edge_id}
                  className="panel-subtle stack-sm critical-card"
                >
                  <p className="table-primary">
                    {item.from_title} → {item.to_title}
                  </p>
                  <p className="table-secondary">
                    {item.from_type} {item.relation_label} {item.to_type}{t("· topic", "· konu")}{item.topic_key}
                  </p>
                  <div className="stack-sm">
                    <div className="panel-subtle stack-sm">
                      <p className="section-label">{t('Later claim evidence', 'Sonraki ifade kanıtı')}</p>
                      <p className="table-secondary">
                        {item.from_evidence.artifact_title}
                      </p>
                      <p className="muted-copy">{item.from_evidence.excerpt}</p>
                      <p className="table-secondary">
                        {item.from_evidence.provenance}
                      </p>
                    </div>
                    <div className="panel-subtle stack-sm">
                      <p className="section-label">{t('Earlier claim evidence', 'Önceki ifade kanıtı')}</p>
                      <p className="table-secondary">
                        {item.to_evidence.artifact_title}
                      </p>
                      <p className="muted-copy">{item.to_evidence.excerpt}</p>
                      <p className="table-secondary">
                        {item.to_evidence.provenance}
                      </p>
                    </div>
                  </div>
                  {item.ranking_basis.length > 0 ? (
                    <p className="table-secondary">{t("Ranked for:", "Öncelik gerekçesi:")}{item.ranking_basis.join(', ')}
                    </p>
                  ) : null}
                  {item.uncertainty_note ? (
                    <p className="muted-copy">{item.uncertainty_note}</p>
                  ) : null}
                  <p className="muted-copy">{t("Confidence", "Güven")}{formatPercent(item.confidence_score)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={t('Assumption drift', 'Varsayım değişimi')}
          description={t('Assumptions marked stale, reversed, or weakening by memory analysis.', 'Hafıza analiziyle eski, tersine dönmüş veya zayıflamış olarak işaretlenen varsayımlar.')}
        >
          {assumptionDrift.length === 0 ? (
            <EmptyState
              title={t('No drift signals', 'Değişim sinyali yok')}
              description={t('No visible assumption drift items are currently available.', 'Şu anda görünür varsayım değişimi öğesi yok.')}
            />
          ) : (
            <div className="stack-sm">
              {assumptionDrift.map((item) => (
                <article
                  key={item.assumption_id}
                  className="panel-subtle stack-sm drift-card"
                >
                  <p className="table-primary">{item.title_or_label}</p>
                  <p className="table-secondary">
                    {item.status} · {item.assumption_id}{t(" · topic", " · konu")}{' '}
                    {item.topic_key}
                  </p>
                  <p className="muted-copy">
                    {item.validity_notes || translate("No validity notes recorded.", "Geçerlilik notu yok.")}
                  </p>
                  {item.supporting_signal_title ? (
                    <p className="table-secondary">{t("Compared with:", "Karşılaştırılan:")}{item.supporting_signal_type} ·{' '}
                      {item.supporting_signal_title}
                    </p>
                  ) : null}
                  {item.evidence_span ? (
                    <p className="muted-copy">{item.evidence_span}</p>
                  ) : null}
                  {item.evidence_provenance ? (
                    <p className="table-secondary">
                      {item.evidence_provenance}
                    </p>
                  ) : null}
                  {item.ranking_basis.length > 0 ? (
                    <p className="table-secondary">{t("Ranked for:", "Öncelik gerekçesi:")}{item.ranking_basis.join(', ')}
                    </p>
                  ) : null}
                  {item.uncertainty_note ? (
                    <p className="muted-copy">{item.uncertainty_note}</p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={t('Recommended next actions', 'Önerilen sonraki adımlar')}
        description={t('Guidance derived from active contradiction, drift, and open-commitment signals.', 'Etkin çelişki, değişim ve açık taahhüt sinyallerinden üretilen yönlendirme.')}
      >
        {nextActions.length === 0 ? (
          <EmptyState
            title={t('No next-action signals', 'Sonraki eylem sinyali yok')}
            description={t('No visible guidance can be grounded from the current memory graph yet.', 'Mevcut hafıza grafiğinden henüz görünür bir öneri temellendirilemiyor.')}
          />
        ) : (
          <div className="stack-sm">
            {nextActions.map((item) => (
              <article
                key={item.signal_id}
                className="panel-subtle stack-sm action-card"
              >
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{t("Next action · topic", "Sonraki iş · konu")}{item.related_topic}
                    </p>
                    <p className="table-primary">{item.title}</p>
                  </div>
                  <p className="table-secondary">{t("Urgency", "Aciliyet")}{formatPercent(item.urgency_score)}{t(" · uncertainty", " · belirsizlik")}{' '}
                    {formatPercent(item.uncertainty_score)}
                  </p>
                </div>
                <p className="evidence-block">{item.recommended_action}</p>
                <p className="muted-copy">{item.grounded_reasoning}</p>
                {item.supporting_evidence.length > 0 ? (
                  <div className="stack-sm">
                    <p className="section-label">{t('Evidence behind the action', 'Eylemin arkasındaki kanıt')}</p>
                    {item.supporting_evidence.slice(0, 2).map((evidence) => (
                      <article
                        key={`${item.signal_id}-${evidence.artifact_id}-${evidence.chunk_id ?? 'root'}`}
                        className="panel-subtle stack-sm"
                      >
                        <p className="table-secondary">
                          {evidence.artifact_title} · {evidence.evidence_kind}
                        </p>
                        <p className="muted-copy">{evidence.excerpt}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
                {item.supporting_memory_objects.length > 0 ? (
                  <p className="table-secondary">{t("Memory support:", "Destekleyen hafıza:")}{' '}
                    {item.supporting_memory_objects
                      .map(
                        (memory) =>
                          `${formatLabel(memory.memory_type)}:${memory.title_or_label}`,
                      )
                      .join(' · ')}
                  </p>
                ) : null}
                {item.ranking_basis.length > 0 ? (
                  <p className="table-secondary">{t("Ranked for:", "Öncelik gerekçesi:")}{item.ranking_basis.join(', ')}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
