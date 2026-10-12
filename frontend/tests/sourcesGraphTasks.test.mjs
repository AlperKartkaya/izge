import assert from 'node:assert/strict'
import test from 'node:test'

import { buildEvidenceGraph, resolveGraphSelection, scopeEvidenceGraph } from '../src/lib/graphLayout.ts'
import { splitTasksByCompletion } from '../src/lib/taskStatus.ts'

test('completed work is kept out of the open work list', () => {
  const tasks = [
    { task_id: 'open', status: 'open' },
    { task_id: 'active', status: 'in_progress' },
    { task_id: 'done', status: 'done' },
  ]

  const { active, completed } = splitTasksByCompletion(tasks)

  assert.deepEqual(active.map((task) => task.task_id), ['open', 'active'])
  assert.deepEqual(completed.map((task) => task.task_id), ['done'])
})

function occurrence(index, artifactId = 'source-a') {
  return {
    occurrence_id: `memory-${index}`,
    family_id: `family-${index}`,
    memory_type: 'decision',
    memory_id: `record-${index}`,
    claim_family_key: `claim-${index}`,
    title_or_label: `Memory ${index}`,
    observed_at: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
    valid_from: '2026-10-01T10:00:00Z',
    valid_to: null,
    source_artifact_id: artifactId,
    source_artifact_title: artifactId === 'source-a' ? 'Atlas report' : 'Koru brief',
    source_artifact_review_status: 'reviewed',
    source_chunk_id: `chunk-${index}`,
    evidence_span: `Evidence ${index}`,
    status: 'active',
    confidence_score: 0.9,
  }
}

function temporalGraph(occurrences, links = []) {
  return {
    workspace_id: 'workspace',
    families: [],
    occurrences,
    links,
    sync_summary: {},
  }
}

test('evidence graph keeps every loaded source and memory record accessible', () => {
  const occurrences = [
    ...Array.from({ length: 9 }, (_, index) => occurrence(index)),
    occurrence(9, 'source-b'),
  ]

  const graph = buildEvidenceGraph(temporalGraph(occurrences))

  assert.equal(graph.nodes.filter((node) => node.kind === 'artifact').length, 2)
  assert.equal(graph.nodes.filter((node) => node.kind === 'memory').length, 10)
  assert.equal(graph.edges.filter((edge) => edge.edgeType === 'source_artifact').length, 10)
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length)
})

test('evidence graph exposes only recorded temporal relationships', () => {
  const occurrences = [occurrence(0), occurrence(1, 'source-b')]
  const link = {
    edge_id: 'edge-1',
    edge_type: 'CONTRADICTS',
    from_occurrence_id: 'memory-0',
    to_occurrence_id: 'memory-1',
    evidence_artifact_id: 'source-b',
    evidence_chunk_id: 'chunk-1',
    confidence_score: 0.84,
  }

  const graph = buildEvidenceGraph(temporalGraph(occurrences, [
    link,
    { ...link, edge_id: 'hidden-edge', to_occurrence_id: 'not-loaded' },
  ]))
  const relationshipEdges = graph.edges.filter((edge) => edge.sourceLink)

  assert.equal(relationshipEdges.length, 1)
  assert.equal(relationshipEdges[0].id, 'edge-1')
  assert.equal(relationshipEdges[0].fromId, 'memory-0')
  assert.equal(relationshipEdges[0].toId, 'memory-1')
})

test('source scope keeps its records and direct cross-source relationship context', () => {
  const occurrences = [
    occurrence(0),
    occurrence(1),
    occurrence(2, 'source-b'),
    occurrence(3, 'source-c'),
  ]
  const graph = buildEvidenceGraph(temporalGraph(occurrences, [{
    edge_id: 'cross-source',
    edge_type: 'SUPERSEDES',
    from_occurrence_id: 'memory-0',
    to_occurrence_id: 'memory-3',
    evidence_artifact_id: 'source-c',
    evidence_chunk_id: 'chunk-3',
    confidence_score: 0.88,
  }]))

  const scoped = scopeEvidenceGraph(graph, 'source-c')

  assert.deepEqual(
    scoped.nodes.filter((node) => node.kind === 'memory').map((node) => node.id).sort(),
    ['memory-0', 'memory-3'],
  )
  assert.deepEqual(
    scoped.nodes.filter((node) => node.kind === 'artifact').map((node) => node.artifactId).sort(),
    ['source-a', 'source-c'],
  )
  assert.equal(scoped.edges.some((edge) => edge.id === 'cross-source'), true)
  assert.ok(Math.max(...scoped.nodes.map((node) => node.position.y)) < 310)
})

test('graph keyboard selection prefers the newly selected item in a change batch', () => {
  assert.equal(resolveGraphSelection([
    { id: 'old', type: 'select', selected: false },
    { id: 'new', type: 'select', selected: true },
  ], 'old'), 'new')
  assert.equal(resolveGraphSelection([
    { id: 'old', type: 'select', selected: false },
  ], 'old'), null)
})

test('evidence graph layout is deterministic and separates source groups', () => {
  const input = temporalGraph([
    occurrence(2, 'source-b'),
    occurrence(1),
    occurrence(0),
  ])

  const first = buildEvidenceGraph(input)
  const second = buildEvidenceGraph(temporalGraph([...input.occurrences].reverse()))

  assert.deepEqual(first, second)
  const sourceA = first.nodes.find((node) => node.id === 'artifact:source-a')
  const sourceB = first.nodes.find((node) => node.id === 'artifact:source-b')
  assert.ok(sourceA.position.y < sourceB.position.y)
})
