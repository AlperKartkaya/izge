import assert from 'node:assert/strict'
import test from 'node:test'
import { isNavigationActive } from '../src/lib/navigation.ts'

test('memory aliases and details have one active navigation destination', () => {
  for (const path of ['/memory', '/memory/decision/123', '/artifacts']) {
    assert.equal(isNavigationActive(path, '/memory'), true)
    assert.equal(isNavigationActive(path, '/memory-filesystem'), false)
    assert.equal(isNavigationActive(path, '/'), false)
  }
  assert.equal(isNavigationActive('/memory-filesystem', '/memory'), false)
  assert.equal(isNavigationActive('/memory-filesystem', '/memory-filesystem'), true)
  assert.equal(isNavigationActive('/', '/'), true)
  assert.equal(isNavigationActive('/admin/users', '/admin/data'), false)
})
