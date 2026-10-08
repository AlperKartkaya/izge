import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDateTime, normalizeApiTimestamp } from '../src/lib/format.ts'

test('UTC backend timestamps and explicit offsets display the same Istanbul time', () => {
  assert.equal(normalizeApiTimestamp('2026-10-09T07:00:00'), '2026-10-09T07:00:00Z')
  assert.equal(normalizeApiTimestamp('2026-10-09T10:00:00+03:00'), '2026-10-09T10:00:00+03:00')
  assert.equal(normalizeApiTimestamp('2026-10-09'), '2026-10-09')
  assert.equal(formatDateTime('2026-10-09T07:00:00'), formatDateTime('2026-10-09T10:00:00+03:00'))
  assert.match(formatDateTime('2026-10-09T07:00:00'), /10:00/)
})
