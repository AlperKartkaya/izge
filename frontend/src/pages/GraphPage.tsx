import { translate } from '../lib/language'
import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useLanguage } from '../lib/i18n'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  Callout,
  EmptyState,
  PageIntro,
  Panel,
  StatusBadge,
} from '../components/ui'
import { api, ApiError } from '../lib/api'
import {
  buildEvidenceGraph,
  resolveGraphSelection,
  scopeEvidenceGraph,
  type EvidenceGraphEdge,
  type EvidenceGraphNode,
} from '../lib/graphLayout'
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
  TemporalGraphRead,
} from '../lib/types'

interface GraphSearchItem {
  id: string
  label: string
  subtitle: string
}

type FlowNode = Node<{ graphNode: EvidenceGraphNode; label: ReactNode }>
type FlowEdge = Edge<{ graphEdge: EvidenceGraphEdge }>

const graphRelationshipLabels: Record<string, readonly [string, string]> = {
  mentioned_in: ['Mentioned in', 'İçinde geçer'],
  based_on: ['Based on', 'Dayanır'],
  constrained_by: ['Constrained by', 'Kısıtlanır'],
  resulted_in: ['Resulted in', 'Sonuçlandı'],
  relates_to: ['Related to', 'İlişkili'],
  supersedes: ['Updates', 'Günceller'],
  contradicts: ['Contradicts', 'Çelişir'],
  source_artifact: ['Extracted from', 'Kaynağından çıkarıldı'],
}

function formatGraphRelationship(value: string): string {
  const labels = graphRelationshipLabels[value.toLowerCase()]
  return labels ? translate(labels[0], labels[1]) : formatLabel(value.toLowerCase())
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
  const [graphInstance, setGraphInstance] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null)
  const [isNeighborhoodLoading, setIsNeighborhoodLoading] = useState(false)
  const [graphSearch, setGraphSearch] = useState('')
  const [graphSourceId, setGraphSourceId] = useState('')
  const pendingGraphFocusId = useRef<string | null>(null)
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
  const fullEvidenceGraph = useMemo(
    () => buildEvidenceGraph(temporalGraph),
    [temporalGraph],
  )
  const evidenceGraph = useMemo(
    () => scopeEvidenceGraph(fullEvidenceGraph, graphSourceId),
    [fullEvidenceGraph, graphSourceId],
  )
  const graphSources = useMemo(
    () => fullEvidenceGraph.nodes.filter((node) => node.kind === 'artifact'),
    [fullEvidenceGraph.nodes],
  )
  const graphNodeById = useMemo(
    () => new Map(evidenceGraph.nodes.map((node) => [node.id, node])),
    [evidenceGraph.nodes],
  )
  const fullGraphNodeById = useMemo(
    () => new Map(fullEvidenceGraph.nodes.map((node) => [node.id, node])),
    [fullEvidenceGraph.nodes],
  )
  const graphEdgeById = useMemo(
    () => new Map(evidenceGraph.edges.map((edge) => [edge.id, edge])),
    [evidenceGraph.edges],
  )
  const selectedGraphNode = selectedGraphEdgeId
    ? null
    : graphNodeById.get(selectedGraphNodeId ?? '') ?? null
  const selectedGraphEdge = graphEdgeById.get(selectedGraphEdgeId ?? '') ?? null
  const graphNodes = useMemo<FlowNode[]>(
    () => evidenceGraph.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      className: `evidence-flow-node evidence-flow-node-${node.kind}`,
      ariaLabel: t(
        `${node.kind === 'artifact' ? 'Source' : 'Memory'}: ${node.label}`,
        `${node.kind === 'artifact' ? 'Kaynak' : 'Hafıza'}: ${node.label}`,
      ),
      data: {
        graphNode: node,
        label: <div className="evidence-flow-node-copy"><strong>{node.label}</strong><span>{node.kind === 'artifact' ? t(`${node.recordCount} memory records`, `${node.recordCount} hafıza kaydı`) : `${formatLabel(node.occurrence?.memory_type ?? '')} · ${formatLabel(node.occurrence?.status ?? '')}`}</span></div>,
      },
      selected: selectedGraphNodeId === node.id,
      draggable: false,
      selectable: true,
      sourcePosition: node.kind === 'artifact' ? Position.Right : undefined,
      targetPosition: node.kind === 'memory' ? Position.Left : undefined,
    })),
    [evidenceGraph.nodes, selectedGraphNodeId, t],
  )
  const graphEdges = useMemo<FlowEdge[]>(
    () => evidenceGraph.edges.map((edge) => ({
      id: edge.id,
      source: edge.fromId,
      target: edge.toId,
      type: edge.edgeType === 'source_artifact' ? 'smoothstep' : 'default',
      className: `evidence-flow-edge evidence-flow-edge-${edge.edgeType.toLowerCase()}`,
      ariaLabel: t(
        `Relationship: ${formatGraphRelationship(edge.edgeType)}`,
        `İlişki: ${formatGraphRelationship(edge.edgeType)}`,
      ),
      data: { graphEdge: edge },
      label: edge.edgeType === 'source_artifact' ? undefined : formatGraphRelationship(edge.edgeType),
      markerEnd: edge.edgeType === 'source_artifact' ? undefined : { type: MarkerType.ArrowClosed },
      selected: selectedGraphEdgeId === edge.id,
      focusable: true,
      selectable: true,
      animated: false,
    })),
    [evidenceGraph.edges, selectedGraphEdgeId, t],
  )
  const graphSearchIndex = useMemo<GraphSearchItem[]>(
    () => fullEvidenceGraph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      subtitle: node.kind === 'artifact'
        ? t('Source artifact', 'Kaynak dosya')
        : `${formatLabel(node.occurrence?.memory_type ?? '')} · ${node.artifactTitle}`,
    })),
    [fullEvidenceGraph.nodes, t],
  )
  const graphSearchResults = useMemo(() => {
    const query = graphSearch.trim().toLocaleLowerCase()
    if (!query) return []
    return graphSearchIndex
      .filter((item) => `${item.label} ${item.subtitle}`.toLocaleLowerCase().includes(query))
      .slice(0, 8)
  }, [graphSearch, graphSearchIndex])

  function showGraphNodeDetail(node: EvidenceGraphNode) {
    setSelectedGraphNodeId(node.id)
    setSelectedGraphEdgeId(null)
    if (node.occurrence?.memory_id) setSelectedMemoryId(node.occurrence.memory_id)
  }

  function selectGraphNode(node: EvidenceGraphNode) {
    showGraphNodeDetail(node)
    if (!graphNodeById.has(node.id)) {
      pendingGraphFocusId.current = node.id
      setGraphSourceId(node.artifactId)
      return
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    void graphInstance?.fitView({ nodes: [{ id: node.id }], duration: reduceMotion ? 0 : 350, maxZoom: 1.25, padding: 1.8 })
  }

  function selectGraphEdge(edge: EvidenceGraphEdge) {
    setSelectedGraphEdgeId(edge.id)
    setSelectedGraphNodeId(null)
  }

  useEffect(() => {
    if (!graphInstance) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    void graphInstance.fitView({ duration: reduceMotion ? 0 : 300, padding: 0.16, maxZoom: 1 })
  }, [graphInstance, graphSourceId, graphNodes.length])

  useEffect(() => {
    const nodeId = pendingGraphFocusId.current
    if (!graphInstance || !nodeId || !graphNodeById.has(nodeId)) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    void graphInstance.fitView({ nodes: [{ id: nodeId }], duration: reduceMotion ? 0 : 350, maxZoom: 1.25, padding: 1.8 })
    pendingGraphFocusId.current = null
  }, [graphInstance, graphNodeById])

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
        title={t('Company knowledge graph', 'Şirket bilgi grafiği')}
        description={t('Find a source or memory record, then inspect its evidence and relationships.', 'Bir kaynak veya hafıza kaydı bulun; ardından kanıtlarını ve ilişkilerini inceleyin.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <dl className="meta-list compact-meta-list" aria-label={t('Graph summary', 'Grafik özeti')}>
        <div><dt>{t('Sources', 'Kaynaklar')}</dt><dd>{summary?.artifact_count ?? '—'}</dd></div>
        <div><dt>{t('Memory records', 'Hafıza kayıtları')}</dt><dd>{temporalGraph?.occurrences.length ?? '—'}</dd></div>
        <div><dt>{t('Signals needing attention', 'İlgi bekleyen sinyaller')}</dt><dd>{persistedSignals.length || nextActions.length}</dd></div>
      </dl>

      <Panel
        title={t('Evidence map', 'Kanıt haritası')}
        description={t('Trace which source produced each memory record and how records change or contradict one another.', 'Her hafıza kaydının hangi kaynaktan üretildiğini ve kayıtların birbirini nasıl değiştirdiğini ya da çeliştiğini izleyin.')}
      >
        {evidenceGraph.nodes.length > 0 ? (
          <div className="graph-interactive-shell evidence-flow-shell">
            <div className="graph-svg-panel evidence-flow-panel">
              <div className="graph-toolbar" aria-label={t('Graph controls', 'Grafik kontrolleri')}>
                <div className="graph-search-control">
                  <label className="field">
                    <span className="field-label">{t('Find a source or memory', 'Kaynak veya hafıza bul')}</span>
                    <input
                      type="search"
                      name="graph_search"
                      autoComplete="off"
                      value={graphSearch}
                      onChange={(event) => setGraphSearch(event.target.value)}
                      onKeyDown={(event) => {
                        const firstResult = graphSearchResults[0]
                        const graphNode = firstResult ? fullGraphNodeById.get(firstResult.id) : null
                        if (event.key === 'Enter' && graphNode) {
                          event.preventDefault()
                          selectGraphNode(graphNode)
                        }
                      }}
                      placeholder={t('Search all visible records…', 'Tüm görünür kayıtlarda ara…')}
                    />
                  </label>
                  {graphSearchResults.length > 0 ? (
                    <div className="graph-search-results" role="region" aria-label={t('Graph search results', 'Grafik arama sonuçları')}>
                      {graphSearchResults.map((item) => {
                        const graphNode = fullGraphNodeById.get(item.id)
                        return graphNode ? (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={selectedGraphNodeId === item.id}
                            onClick={() => selectGraphNode(graphNode)}
                          >
                            <strong>{item.label}</strong>
                            <span>{item.subtitle}</span>
                          </button>
                        ) : null
                      })}
                    </div>
                  ) : null}
                </div>
                <label className="field graph-source-filter">
                  <span className="field-label">{t('Source scope', 'Kaynak kapsamı')}</span>
                  <select
                    name="graph_source"
                    value={graphSourceId}
                    onChange={(event) => {
                      setGraphSourceId(event.target.value)
                      setSelectedGraphNodeId(null)
                      setSelectedGraphEdgeId(null)
                    }}
                  >
                    <option value="">{t('All loaded sources', 'Yüklenen tüm kaynaklar')}</option>
                    {graphSources.map((source) => (
                      <option key={source.artifactId} value={source.artifactId}>{source.label}</option>
                    ))}
                  </select>
                </label>
                <div className="graph-legend" aria-label={t('Graph legend', 'Grafik açıklaması')}>
                  <span><i className="graph-legend-source" />{t('Source', 'Kaynak')}</span>
                  <span><i className="graph-legend-memory" />{t('Memory', 'Hafıza')}</span>
                  <span><i className="graph-legend-relation" />{t('Relationship', 'İlişki')}</span>
                </div>
              </div>
              <p className="table-secondary graph-scope-note">
                {t(
                  `${evidenceGraph.nodes.filter((node) => node.kind === 'artifact').length} sources, ${evidenceGraph.nodes.filter((node) => node.kind === 'memory').length} loaded memory records and ${evidenceGraph.edges.filter((edge) => edge.sourceLink).length} recorded relationships are shown. A source scope also includes directly related records from other sources.`,
                  `${evidenceGraph.nodes.filter((node) => node.kind === 'artifact').length} kaynak, yüklenen ${evidenceGraph.nodes.filter((node) => node.kind === 'memory').length} hafıza kaydı ve ${evidenceGraph.edges.filter((edge) => edge.sourceLink).length} kayıtlı ilişki gösteriliyor. Kaynak kapsamı, diğer kaynaklardaki doğrudan ilişkili kayıtları da içerir.`,
                )}
              </p>
              <div
                className="evidence-flow-canvas"
                aria-label={t('Interactive source and memory graph', 'Etkileşimli kaynak ve hafıza grafiği')}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSelectedGraphNodeId(null)
                    setSelectedGraphEdgeId(null)
                  }
                }}
              >
                <ReactFlow<FlowNode, FlowEdge>
                  nodes={graphNodes}
                  edges={graphEdges}
                  onInit={setGraphInstance}
                  onNodeClick={(_, node) => showGraphNodeDetail(node.data.graphNode)}
                  onEdgeClick={(_, edge) => {
                    if (edge.data) selectGraphEdge(edge.data.graphEdge)
                  }}
                  onNodesChange={(changes) => {
                    const nextId = resolveGraphSelection(changes, selectedGraphNodeId)
                    if (nextId === selectedGraphNodeId) return
                    const graphNode = nextId ? graphNodeById.get(nextId) : null
                    if (graphNode) showGraphNodeDetail(graphNode)
                    else setSelectedGraphNodeId(null)
                  }}
                  onEdgesChange={(changes) => {
                    const nextId = resolveGraphSelection(changes, selectedGraphEdgeId)
                    if (nextId === selectedGraphEdgeId) return
                    const graphEdge = nextId ? graphEdgeById.get(nextId) : null
                    if (graphEdge) selectGraphEdge(graphEdge)
                    else setSelectedGraphEdgeId(null)
                  }}
                  onPaneClick={() => {
                    setSelectedGraphNodeId(null)
                    setSelectedGraphEdgeId(null)
                  }}
                  fitView
                  fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
                  minZoom={0.18}
                  maxZoom={1.5}
                  nodesConnectable={false}
                  nodesDraggable={false}
                  elementsSelectable
                  proOptions={{ hideAttribution: true }}
                  ariaLabelConfig={{
                    'node.a11yDescription.default': t('Press Enter or Space to inspect this record.', 'Bu kaydı incelemek için Enter veya Boşluk tuşuna basın.'),
                    'node.a11yDescription.keyboardDisabled': t('This read-only graph does not allow moving records.', 'Bu salt okunur grafikte kayıtlar taşınamaz.'),
                    'node.a11yDescription.ariaLiveMessage': ({ x, y }) => t(`Selected graph record at ${x}, ${y}.`, `${x}, ${y} konumundaki grafik kaydı seçildi.`),
                    'edge.a11yDescription.default': t('Press Enter or Space to inspect this relationship.', 'Bu ilişkiyi incelemek için Enter veya Boşluk tuşuna basın.'),
                    'controls.ariaLabel': t('Graph view controls', 'Grafik görünüm kontrolleri'),
                    'controls.zoomIn.ariaLabel': t('Zoom in', 'Yakınlaştır'),
                    'controls.zoomOut.ariaLabel': t('Zoom out', 'Uzaklaştır'),
                    'controls.fitView.ariaLabel': t('Fit graph to view', 'Grafiği görünüme sığdır'),
                    'minimap.ariaLabel': t('Graph overview', 'Grafik genel görünümü'),
                  }}
                >
                  <Background gap={24} size={1} />
                  <MiniMap<FlowNode>
                    pannable
                    zoomable
                    nodeColor={(node) => node.data.graphNode.kind === 'artifact' ? '#d7a85d' : '#86a7ff'}
                  />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
            </div>

            {selectedGraphEdge || selectedGraphNode ? (
              <aside className="graph-detail-panel panel-subtle" aria-label={t('Selected graph item detail', 'Seçilen grafik öğesi ayrıntısı')}>
                {selectedGraphEdge ? (
                  <div className="stack-md">
                    <div>
                      <p className="section-label">{t('Recorded relationship', 'Kayıtlı ilişki')}</p>
                      <h4 className="section-title">{formatGraphRelationship(selectedGraphEdge.edgeType)}</h4>
                      <p className="table-secondary">{t('Confidence', 'Güven')}: {formatPercent(selectedGraphEdge.confidenceScore)}</p>
                    </div>
                    <dl className="meta-list compact-meta-list">
                      <div><dt>{t('From', 'Başlangıç')}</dt><dd>{graphNodeById.get(selectedGraphEdge.fromId)?.label ?? selectedGraphEdge.fromId}</dd></div>
                      <div><dt>{t('To', 'Bitiş')}</dt><dd>{graphNodeById.get(selectedGraphEdge.toId)?.label ?? selectedGraphEdge.toId}</dd></div>
                    </dl>
                    {selectedGraphEdge.sourceLink?.evidence_artifact_id ? (
                      <SourcePreviewButton
                        artifactId={selectedGraphEdge.sourceLink.evidence_artifact_id}
                        title={t('Relationship evidence', 'İlişki kanıtı')}
                        className="secondary-button"
                      >{t('Open relationship evidence', 'İlişki kanıtını aç')}</SourcePreviewButton>
                    ) : (
                      <p className="muted-copy">{t('This line represents extraction from the selected source.', 'Bu çizgi, kaynaktan çıkarılan hafıza kaydını gösterir.')}</p>
                    )}
                  </div>
                ) : selectedGraphNode ? (
                  <div className="stack-md">
                    <div>
                      <p className="section-label">{selectedGraphNode.kind === 'artifact' ? t('Source', 'Kaynak') : t('Memory record', 'Hafıza kaydı')}</p>
                      <h4 className="section-title">{selectedGraphNode.label}</h4>
                      <p className="table-secondary">{selectedGraphNode.kind === 'artifact' ? t(`${selectedGraphNode.recordCount} memory records`, `${selectedGraphNode.recordCount} hafıza kaydı`) : `${formatLabel(selectedGraphNode.occurrence?.memory_type ?? '')} · ${formatLabel(selectedGraphNode.occurrence?.status ?? '')}`}</p>
                    </div>
                    {selectedGraphNode.kind === 'artifact' ? (
                      <div className="graph-detail-actions inline-actions">
                        <SourcePreviewButton artifactId={selectedGraphNode.artifactId} title={selectedGraphNode.label} className="primary-button">{t('Preview source', 'Kaynağı önizle')}</SourcePreviewButton>
                        <a className="secondary-button" href={api.artifactDownloadUrl(selectedGraphNode.artifactId)}>{t('Download', 'İndir')}</a>
                      </div>
                    ) : selectedGraphNode.occurrence ? (
                      <div className="stack-sm">
                        <p className="muted-copy">{selectedGraphNode.occurrence.evidence_span ?? t('No evidence excerpt was recorded for this memory.', 'Bu hafıza kaydı için kaynak alıntısı kaydedilmedi.')}</p>
                        <dl className="meta-list compact-meta-list">
                          <div><dt>{t('Source', 'Kaynak')}</dt><dd>{selectedGraphNode.artifactTitle}</dd></div>
                          <div><dt>{t('Observed', 'Gözlemlendi')}</dt><dd>{formatDateTime(selectedGraphNode.occurrence.observed_at)}</dd></div>
                          <div><dt>{t('Confidence', 'Güven')}</dt><dd>{formatPercent(selectedGraphNode.occurrence.confidence_score)}</dd></div>
                        </dl>
                        <div className="graph-detail-actions inline-actions">
                          <Link className="primary-button" to={`/memory/${selectedGraphNode.occurrence.memory_type}/${selectedGraphNode.occurrence.memory_id}`}>{t('Open memory', 'Hafızayı aç')}</Link>
                          <SourcePreviewButton artifactId={selectedGraphNode.artifactId} title={selectedGraphNode.artifactTitle} className="secondary-button">{t('Preview source', 'Kaynağı önizle')}</SourcePreviewButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title={t('No evidence map yet', 'Henüz kanıt haritası yok')}
            description={t('Process company sources to connect extracted memory records to their evidence.', 'Çıkarılan hafıza kayıtlarını kanıtlarıyla ilişkilendirmek için şirket kaynaklarını işleyin.')}
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
