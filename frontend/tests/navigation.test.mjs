import assert from 'node:assert/strict'
import test from 'node:test'
import { canViewManagementPage, isDemoManager, isNavigationActive } from '../src/lib/navigation.ts'

test('demo manager menu grants only scoped inspection routes, without changing backend roles', () => {
  const selin = { role: 'Member', is_public_demo: true, public_demo_persona: 'selin' }
  const kerem = { ...selin, public_demo_persona: 'kerem' }
  assert.equal(isDemoManager(selin), true)
  assert.equal(isDemoManager(kerem), false)
  assert.equal(isDemoManager({ ...selin, is_public_demo: false }), false)
  for (const path of ['/ingestion', '/graph', '/memory-filesystem', '/orchestration', '/readiness']) {
    assert.equal(canViewManagementPage(selin, path), true)
    assert.equal(canViewManagementPage(kerem, path), false)
    assert.equal(canViewManagementPage(undefined, path), false)
  }
  for (const path of ['/operations', '/admin', '/admin/users', '/admin/data', '/audit', '/graph/unsafe']) {
    assert.equal(canViewManagementPage(selin, path), false)
    assert.equal(canViewManagementPage({ role: 'Admin' }, path), true)
  }
})

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
