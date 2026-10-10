import assert from 'node:assert/strict'
import test from 'node:test'
import { copyText } from '../src/lib/clipboard.ts'

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
function mockNavigator(value) { Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value }) }
function restoreGlobals() { delete globalThis.document; if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator }

test('copy falls back inside a modal when clipboard permission is blocked and restores focus', async (t) => {
  t.after(restoreGlobals)
  let copied, removed = false, restored = false, selected = false
  mockNavigator({ clipboard: { writeText: async () => { throw new Error('denied') } } })
  const input = { style: {}, setAttribute() {}, focus() {}, select() { selected = true }, remove() { removed = true } }
  globalThis.document = {
    activeElement: { focus() { restored = true } }, createElement: () => input,
    querySelector: () => ({ append(element) { copied = element.value } }),
    execCommand: (command) => command === 'copy',
  }
  await copyText('**Kaynak**\nTam içerik')
  assert.equal(copied, '**Kaynak**\nTam içerik')
  assert.ok(selected && removed && restored)
})

test('unavailable copy does not report success and cleans up', async (t) => {
  t.after(restoreGlobals)
  let removed = false
  mockNavigator({})
  globalThis.document = { activeElement: null, createElement: () => ({ style: {}, setAttribute() {}, focus() {}, select() {}, remove() { removed = true } }), querySelector: () => null, body: { append() {} }, execCommand: () => false }
  await assert.rejects(copyText('Kaynak'))
  assert.ok(removed)
})
