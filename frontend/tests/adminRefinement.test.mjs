import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const page = async (name) => readFile(new URL(`../src/pages/${name}.tsx`, import.meta.url), 'utf8')

test('admin overview pages keep technical metadata behind native disclosure controls', async () => {
  const [dashboard, operations, data, memory] = await Promise.all([
    page('DashboardPage'),
    page('OperationsPage'),
    page('DataAdminPage'),
    page('MemoryFilesystemPage'),
  ])

  assert.match(dashboard, /<details className="employee-focus-details">/)
  assert.match(operations, /Technical snapshot/)
  assert.match(data, /Technical storage details/)
  assert.match(memory, /Technical source details/)
})

test('readiness and orchestration use compact summaries instead of metric-card grids', async () => {
  const [readiness, orchestration] = await Promise.all([
    page('TargetReadinessPage'),
    page('OrchestrationPage'),
  ])

  assert.doesNotMatch(readiness, /MetricCard/)
  assert.doesNotMatch(orchestration, /MetricCard/)
  assert.match(readiness, /<dl className="review-ledger"/)
  assert.match(orchestration, /<dl className="review-ledger"/)
})

test('ingestion does not reserve an empty detail panel before a job exists', async () => {
  const ingestion = await page('IngestionPage')

  assert.match(ingestion, /\{job \? \(/)
  assert.doesNotMatch(ingestion, /No job selected/)
  assert.match(ingestion, /Open a job by ID/)
})

test('manual ingestion lookup labels the loaded job source, not the dropdown selection', async () => {
  const source = await page('IngestionPage')
  assert.match(source, /artifacts\.find\(\(artifact\) => artifact\.artifact_id === job\.artifact_id\)\?\.title/)
  assert.doesNotMatch(source, /selectedArtifact\?\.title \?\? job\.artifact_id/)
})
