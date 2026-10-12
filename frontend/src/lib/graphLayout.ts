import type {
  TemporalGraphLink,
  TemporalGraphOccurrence,
  TemporalGraphRead,
} from './types'

export interface EvidenceGraphNode {
  id: string
  kind: 'artifact' | 'memory'
  label: string
  recordCount?: number
  position: { x: number; y: number }
  artifactId: string
  artifactTitle: string
  occurrence?: TemporalGraphOccurrence
}

export interface EvidenceGraphEdge {
  id: string
  fromId: string
  toId: string
  edgeType: string
  confidenceScore: number
  sourceLink?: TemporalGraphLink
}

export interface EvidenceGraphProjection {
  nodes: EvidenceGraphNode[]
  edges: EvidenceGraphEdge[]
}

interface GraphSelectionChange {
  id?: string
  type: string
  selected?: boolean
}

export function resolveGraphSelection(
  changes: GraphSelectionChange[],
  currentId: string | null,
): string | null {
  const selected = changes.find(
    (change) => change.type === 'select' && change.selected && change.id,
  )
  if (selected?.id) return selected.id
  return changes.some(
    (change) =>
      change.type === 'select' &&
      change.selected === false &&
      change.id === currentId,
  )
    ? null
    : currentId
}

const MEMORY_COLUMNS = 3
const MEMORY_COLUMN_GAP = 290
const MEMORY_ROW_GAP = 118
const GROUP_GAP = 72

function layoutEvidenceNodes(nodes: EvidenceGraphNode[]): EvidenceGraphNode[] {
  const memoryByArtifact = new Map<string, EvidenceGraphNode[]>()
  nodes.forEach((node) => {
    if (node.kind !== 'memory') return
    const memories = memoryByArtifact.get(node.artifactId) ?? []
    memories.push(node)
    memoryByArtifact.set(node.artifactId, memories)
  })

  const positions = new Map<string, { x: number; y: number }>()
  let groupTop = 0
  nodes
    .filter((node) => node.kind === 'artifact')
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
    .forEach((source) => {
      const memories = (memoryByArtifact.get(source.artifactId) ?? []).sort(
        (left, right) =>
          (left.occurrence?.observed_at ?? '').localeCompare(
            right.occurrence?.observed_at ?? '',
          ) || left.id.localeCompare(right.id),
      )
      const rowCount = Math.ceil(memories.length / MEMORY_COLUMNS)
      const groupHeight = Math.max(118, rowCount * MEMORY_ROW_GAP)
      positions.set(source.id, {
        x: 0,
        y: groupTop + Math.max(0, (groupHeight - 74) / 2),
      })
      memories.forEach((memory, index) => {
        positions.set(memory.id, {
          x: 310 + (index % MEMORY_COLUMNS) * MEMORY_COLUMN_GAP,
          y: groupTop + Math.floor(index / MEMORY_COLUMNS) * MEMORY_ROW_GAP,
        })
      })
      groupTop += groupHeight + GROUP_GAP
    })

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }))
}

export function buildEvidenceGraph(
  temporalGraph: TemporalGraphRead | null,
): EvidenceGraphProjection {
  if (!temporalGraph?.occurrences.length) return { nodes: [], edges: [] }

  const occurrencesByArtifact = new Map<string, TemporalGraphOccurrence[]>()
  temporalGraph.occurrences.forEach((occurrence) => {
    const occurrences = occurrencesByArtifact.get(occurrence.source_artifact_id) ?? []
    occurrences.push(occurrence)
    occurrencesByArtifact.set(occurrence.source_artifact_id, occurrences)
  })

  const nodes: EvidenceGraphNode[] = []
  const edges: EvidenceGraphEdge[] = []
  let groupTop = 0

  ;[...occurrencesByArtifact.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([artifactId, artifactOccurrences]) => {
      const occurrences = artifactOccurrences.sort((left, right) =>
        left.observed_at.localeCompare(right.observed_at) ||
        left.occurrence_id.localeCompare(right.occurrence_id),
      )
      const rowCount = Math.ceil(occurrences.length / MEMORY_COLUMNS)
      const groupHeight = Math.max(118, rowCount * MEMORY_ROW_GAP)
      const artifactTitle = occurrences[0].source_artifact_title
      const artifactNodeId = `artifact:${artifactId}`

      nodes.push({
        id: artifactNodeId,
        kind: 'artifact',
        label: artifactTitle,
        recordCount: occurrences.length,
        position: { x: 0, y: groupTop + Math.max(0, (groupHeight - 74) / 2) },
        artifactId,
        artifactTitle,
      })

      occurrences.forEach((occurrence, index) => {
        nodes.push({
          id: occurrence.occurrence_id,
          kind: 'memory',
          label: occurrence.title_or_label,
          position: {
            x: 310 + (index % MEMORY_COLUMNS) * MEMORY_COLUMN_GAP,
            y: groupTop + Math.floor(index / MEMORY_COLUMNS) * MEMORY_ROW_GAP,
          },
          artifactId,
          artifactTitle,
          occurrence,
        })
        edges.push({
          id: `source:${occurrence.occurrence_id}`,
          fromId: artifactNodeId,
          toId: occurrence.occurrence_id,
          edgeType: 'source_artifact',
          confidenceScore: occurrence.confidence_score,
        })
      })

      groupTop += groupHeight + GROUP_GAP
    })

  const visibleOccurrenceIds = new Set(
    temporalGraph.occurrences.map((occurrence) => occurrence.occurrence_id),
  )
  temporalGraph.links.forEach((link) => {
    if (
      visibleOccurrenceIds.has(link.from_occurrence_id) &&
      visibleOccurrenceIds.has(link.to_occurrence_id)
    ) {
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

  return { nodes: layoutEvidenceNodes(nodes), edges }
}

export function scopeEvidenceGraph(
  graph: EvidenceGraphProjection,
  artifactId: string,
): EvidenceGraphProjection {
  if (!artifactId) return graph

  const primaryMemoryIds = new Set(
    graph.nodes
      .filter((node) => node.kind === 'memory' && node.artifactId === artifactId)
      .map((node) => node.id),
  )
  const includedMemoryIds = new Set(primaryMemoryIds)

  graph.edges.forEach((edge) => {
    if (!edge.sourceLink) return
    if (primaryMemoryIds.has(edge.fromId)) includedMemoryIds.add(edge.toId)
    if (primaryMemoryIds.has(edge.toId)) includedMemoryIds.add(edge.fromId)
  })

  const includedArtifactIds = new Set([artifactId])
  graph.nodes.forEach((node) => {
    if (node.kind === 'memory' && includedMemoryIds.has(node.id)) {
      includedArtifactIds.add(node.artifactId)
    }
  })
  const nodes = graph.nodes.filter((node) =>
    node.kind === 'artifact'
      ? includedArtifactIds.has(node.artifactId)
      : includedMemoryIds.has(node.id),
  )
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter((edge) =>
    nodeIds.has(edge.fromId) && nodeIds.has(edge.toId),
  )

  return { nodes: layoutEvidenceNodes(nodes), edges }
}
