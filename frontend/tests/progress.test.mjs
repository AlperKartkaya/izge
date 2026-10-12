import assert from 'node:assert/strict'
import test from 'node:test'
import { progressPercent } from '../src/lib/progress.ts'

test('progress shows unknown separately from zero and bounds numeric data', () => {
  assert.equal(progressPercent(null), null)
  assert.equal(progressPercent(NaN), null)
  assert.equal(progressPercent(Infinity), null)
  assert.equal(progressPercent(0), 0)
  assert.equal(progressPercent(.427), 43)
  assert.equal(progressPercent(2), 100)
  assert.equal(progressPercent(-.2), 0)
})
