import assert from 'node:assert/strict'
import test from 'node:test'
import { filterSourceList } from '../src/lib/sourceList.ts'

test('source search is Turkish-aware and sorting never mutates API data', () => {
  const items = [
    { title: 'İzge', updated_at: '2026-10-01T08:00:00' },
    { title: 'Atlas', updated_at: '2026-10-02T08:00:00Z' },
  ]
  assert.equal(filterSourceList(items, 'izge', 'recent', 'tr-TR')[0].title, 'İzge')
  assert.deepEqual(filterSourceList(items, '', 'recent', 'tr-TR').map((item) => item.title), ['Atlas', 'İzge'])
  assert.deepEqual(filterSourceList(items, '', 'title', 'tr-TR').map((item) => item.title), ['Atlas', 'İzge'])
  assert.equal(items[0].title, 'İzge')
  assert.deepEqual(filterSourceList(items, 'missing', 'recent', 'en-GB'), [])
})
