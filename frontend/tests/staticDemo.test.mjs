import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BrowserDemo } from '../src/lib/browserDemo.ts'
import { shouldFallbackToStaticDemo, staticDemoPreviewUrl, staticDemoRequest, staticDemoStream } from '../src/lib/staticDemo.ts'

const snapshot = JSON.parse(readFileSync(new URL('../public/demo-snapshot.json', import.meta.url), 'utf8'))

const originalFetch = globalThis.fetch
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
globalThis.fetch = async (url) => {
  if (String(url).endsWith('demo-snapshot.json')) {
    return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  throw new TypeError('Failed to fetch')
}

test.after(() => {
  globalThis.fetch = originalFetch
})

test('static demo fallback activates on network error or non-JSON 404 and serves Pusula workspace', async () => {
  assert.equal(shouldFallbackToStaticDemo(Object.assign(new Error('Unauthorized'), { status: 401 }), true), false)
  assert.equal(shouldFallbackToStaticDemo(Object.assign(new Error('Not Found'), { status: 404 }), false), true)

  const config = await staticDemoRequest('/auth/demo')
  assert.equal(config.enabled, true)
  assert.equal(config.personas.length, 2)

  const signedIn = await staticDemoRequest('/auth/demo/sign-in', {
    method: 'POST',
    body: JSON.stringify({ persona: 'selin' }),
  })
  assert.equal(signedIn.user.public_demo_persona, 'selin')
  assert.equal(signedIn.user.is_public_demo, true)
  assert.equal((await staticDemoRequest('/users/me')).display_name, 'Selin Aras')

  const demo = new BrowserDemo(signedIn.user, globalThis.localStorage, staticDemoRequest, staticDemoStream)
  const artifacts = await demo.request('/artifacts')
  assert.ok(artifacts.length >= 10)
  assert.match(staticDemoPreviewUrl(artifacts[0].artifact_id) ?? '', /^data:text\/plain;charset=utf-8,/)

  const accepted = await demo.request('/work/ask', {
    method: 'POST',
    body: JSON.stringify({ message: '@izge Eylül faturasında ek iş var mı?', thread_id: 'atlas-commercial' }),
  })
  assert.ok(accepted.run_id)
  await new Promise((resolve) => {
    const unsubscribe = demo.subscribeRun(accepted.run_id, (event) => {
      if (event.type === 'result' || event.type === 'failed') {
        unsubscribe()
        resolve()
      }
    })
  })
  const completed = await demo.request(`/work/runs/${accepted.run_id}`)
  assert.equal(completed.status, 'completed')
  assert.match(completed.answer, /36\.000|18 saat/)
  assert.ok(completed.sources.length > 0)
})
