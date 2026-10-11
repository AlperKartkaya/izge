import assert from 'node:assert/strict'
import test from 'node:test'
import { latestAgentStages, safeHttpUrl } from '../src/lib/agentRun.ts'

test('agent stages keep their first position but show only the latest state per key', () => {
  const stages = [
    { sequence: 1, key: 'retrieval', label: 'Searching', status: 'running', created_at: '2026-10-10T09:00:00Z' },
    { sequence: 2, key: 'web_search', label: 'Web search', status: 'completed', created_at: '2026-10-10T09:00:01Z' },
    { sequence: 3, key: 'retrieval', label: 'Found 4 sources', status: 'completed', created_at: '2026-10-10T09:00:02Z' },
  ]
  assert.deepEqual(latestAgentStages(stages).map((stage) => [stage.key, stage.label]), [
    ['retrieval', 'Found 4 sources'],
    ['web_search', 'Web search'],
  ])
})

test('only http and https source links can leave the application', () => {
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(safeHttpUrl('http://example.com'), 'http://example.com/')
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.equal(safeHttpUrl('/relative'), null)
  assert.equal(safeHttpUrl(null), null)
})
