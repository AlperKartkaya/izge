import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserDemo } from '../src/lib/browserDemo.ts'

const user = { user_id: 'visitor-kerem', workspace_id: 'pusula', display_name: 'Kerem Demir', role: 'Member', is_public_demo: true }
function setup(storage = new Map(), customRemote, stream) {
  const requests = []
  const remote = async (path, options = {}) => {
    requests.push({ path, ...options })
    if (path.startsWith('/team-chat?')) return { messages: [{ message_id: 'original', workspace_id: 'pusula', author_user_id: 'ece', author_display_name: 'Ece', body: 'Teslim kontrolü', message_metadata: { thread_id: 'atlas-commercial' }, created_at: '2026-10-01' }] }
    if (path === '/work/tasks') return { items: [{ task_id: 'task', title: 'Test', status: 'open' }] }
    if (path === '/artifacts') return []
    if (customRemote) return customRemote(path, options)
    throw new Error(`Unexpected request: ${path}`)
  }
  const store = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
  return { demo: new BrowserDemo(user, store, remote, stream), requests, storage, store }
}
const post = (body) => ({ method: 'POST', body: JSON.stringify(body) })

test('demo messages, quotes, tasks and automations persist locally; no shared mutation is sent', async () => {
  const { demo, requests, storage } = setup()
  const message = await demo.request('/team-chat', post({ body: 'Onaylandı', thread_id: 'atlas-commercial', reply_to_message_id: 'original' }))
  assert.equal(message.reply_to.author_display_name, 'Ece')
  assert.equal(message.is_authored_by_current_user, true)
  await demo.request('/work/tasks/task', { method: 'PATCH', body: '{"status":"done"}' })
  const automation = await demo.request('/automations', post({ title: 'Kontrol', prompt: 'Atlas kontrol et' }))
  assert.equal(automation.next_run_at, null)
  assert.ok(requests.every((request) => !request.method || request.method === 'GET'))
  const restored = setup(storage).demo
  assert.equal((await restored.request('/team-chat')).messages.at(-1).body, 'Onaylandı')
  assert.equal((await restored.request('/work/tasks')).items[0].status, 'done')
  assert.equal((await restored.request('/automations')).items.length, 3)
})

test('demo starts with focused @izge exchanges, two routines and notifications, and resets cleanly', async () => {
  const { demo, storage } = setup()
  const chat = await demo.request('/team-chat')
  assert.equal(chat.messages.filter((message) => message.body.startsWith('@izge')).length, 2)
  assert.equal(chat.messages.filter((message) => message.author_display_name === 'İzge').length, 2)
  const notification = (await demo.request('/notifications')).items[0]
  await demo.request(`/notifications/${notification.notification_id}/read`, { method: 'PATCH' })
  assert.equal((await demo.request('/notifications')).unread_count, 0)
  demo.reset()
  assert.equal(storage.size, 0)
  assert.equal((await demo.request('/notifications')).unread_count, 1)
})

test('unknown mutations fail closed, invalid quotes fail, storage errors never fall through', async () => {
  const { demo, requests, store } = setup()
  await assert.rejects(demo.request('/admin/delete', post({})), /ortak veriler/)
  await assert.rejects(demo.request('/team-chat', post({ body: 'x', thread_id: 'wrong', reply_to_message_id: 'original' })), /bulunamadı/)
  store.setItem = () => { throw new Error('quota exceeded') }
  await assert.rejects(demo.request('/team-chat', post({ body: 'new' })), /kaydedilemedi/)
  assert.ok(requests.every((request) => !request.method))
  assert.ok(!(await demo.request('/team-chat')).messages.some((message) => message.body === 'new'))
})

test('AI calls only stateless endpoint and stores returned result in the originating browser thread', async () => {
  const { demo, requests } = setup(new Map(), (path) => {
    assert.equal(path, '/demo/ask')
    return { run: { run_id: 'run-1', thread_id: 'isolated-server-thread', status: 'completed', answer: 'Kaynaklı yanıt', question: 'Soru', sources: [], stages: [], created_at: new Date().toISOString() }, messages: [] }
  })
  const result = await demo.request('/work/ask', post({ message: '@izge Soru', thread_id: 'atlas-commercial', reply_to_message_id: 'original' }))
  assert.equal(result.thread_id, 'atlas-commercial')
  const run = await demo.request('/work/runs/run-1')
  assert.equal(run.thread_id, 'atlas-commercial')
  const chat = await demo.request('/team-chat?thread_id=atlas-commercial')
  assert.equal(chat.messages.at(-2).reply_to.author_display_name, 'Ece')
  assert.equal(chat.messages.at(-1).message_metadata.colleague_run_id, 'run-1')
  assert.deepEqual(requests.filter((request) => request.method === 'POST').map((request) => request.path), ['/demo/ask'])
})

test('simultaneous local writes do not overwrite each other and another visitor gets no local history', async () => {
  const { demo, storage, store } = setup()
  await Promise.all(['one', 'two'].map((body) => demo.request('/team-chat', post({ body }))))
  assert.deepEqual((await demo.request('/team-chat')).messages.slice(-2).map((message) => message.body), ['one', 'two'])
  const stranger = new BrowserDemo({ ...user, user_id: 'other-visitor' }, store, async (path) => path === '/work/tasks' ? { items: [] } : path === '/artifacts' ? [] : { messages: [] })
  assert.ok(!(await stranger.request('/team-chat')).messages.some((message) => message.body === 'one'))
  assert.equal(storage.size, 2)
})

test('an existing adapter notices another tab update rather than overwriting it', async () => {
  const { demo, storage } = setup()
  await demo.request('/team-chat')
  const second = setup(storage).demo
  await second.request('/team-chat', post({ body: 'other tab' }))
  await demo.request('/team-chat', post({ body: 'first tab' }))
  assert.deepEqual((await second.request('/team-chat')).messages.slice(-2).map((message) => message.body), ['other tab', 'first tab'])
})

test('automation returns before completion and real deltas survive navigation; generated title respects rename', async () => {
  let emit
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const { demo, requests } = setup(new Map(), undefined, async (path, options, onEvent) => {
    assert.equal(path, '/demo/ask/events')
    assert.equal(JSON.parse(options.body).message, 'Atlas kontrol et')
    emit = onEvent
    await onEvent({ type: 'accepted', data: { run_id: 'stream-run', status: 'running' } })
    await waiting
  })
  const automation = await demo.request('/automations', post({ title: 'Kontrol', prompt: 'Atlas kontrol et' }))
  const accepted = await demo.request(`/automations/${automation.automation_id}/run`, post({}))
  assert.equal(accepted.status, 'running')
  assert.equal((await demo.request('/automations')).items.at(-1).last_run_status, 'running')
  const events = []
  const unsubscribe = demo.subscribeRun('stream-run', (event) => events.push(event.type))
  await emit({ type: 'stage', data: { stage_key: 'answer', label: 'Yanıt', status: 'running', sequence: 1 } })
  await emit({ type: 'delta', data: { text: 'İlk ' } })
  assert.equal((await demo.request('/work/runs/stream-run')).answer, 'İlk ')
  unsubscribe()
  await demo.request('/notifications') // Page navigation does not own the computation.
  await emit({ type: 'delta', data: { text: 'yanıt' } })
  const running = await demo.request('/work/runs/stream-run')
  await emit({ type: 'result', data: { run: { ...running, status: 'completed', answer: 'İlk yanıt', thread_title: 'Atlas kontrolü' } } })
  assert.equal((await demo.request('/automations')).items.at(-1).last_run_status, 'completed')
  assert.equal((await demo.request('/team-chat')).messages.at(-1).body, 'İlk yanıt')
  assert.deepEqual(events, ['stage', 'delta'])
  assert.ok(requests.every((request) => !request.method))
  release()
})

test('first answer titles a private conversation but never overwrites a manual title', async () => {
  let emit
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const { demo } = setup(new Map(), undefined, async (_path, _options, onEvent) => {
    emit = onEvent
    await onEvent({ type: 'accepted', data: { run_id: 'title-run', status: 'running' } })
    await waiting
  })
  await demo.request('/work/ask', post({ message: 'Atlas teslimi', thread_id: 'izge-colleague' }))
  const run = await demo.request('/work/runs/title-run')
  await emit({ type: 'result', data: { run: { ...run, status: 'completed', answer: 'Yanıt', thread_title: 'Atlas teslim takvimi' } } })
  assert.equal((await demo.request('/work/conversations')).items[0].title, 'Atlas teslim takvimi')
  release()

  const { demo: renamed } = setup(new Map(), (path) => {
    assert.equal(path, '/demo/ask')
    return { run: { ...run, run_id: 'manual-run', status: 'completed', answer: 'Yanıt', thread_title: 'Model başlığı' } }
  })
  await renamed.request('/work/conversations/demo-personal', { method: 'PATCH', body: '{"title":"Benim başlığım"}' })
  await renamed.request('/work/ask', post({ message: 'Atlas teslimi', thread_id: 'izge-colleague' }))
  assert.equal((await renamed.request('/work/conversations')).items[0].title, 'Benim başlığım')
})

test('daily review is classified before streaming and remains visible after restoring browser state', async () => {
  let emit
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const { demo, storage, requests } = setup(new Map(), undefined, async (path, options, onEvent) => {
    assert.equal(path, '/demo/ask/events')
    const payload = JSON.parse(options.body)
    assert.equal(payload.kind, 'evening_review')
    assert.match(payload.message, /şirket kayıtlarını ve açık işleri/)
    emit = onEvent
    await onEvent({ type: 'accepted', data: { run_id: 'daily-run', status: 'running' } })
    await waiting
  })
  const accepted = await demo.request('/work/review', post({}))
  let run = await demo.request(`/work/runs/${accepted.run_id}`)
  assert.equal(run.kind, 'evening_review')
  assert.equal(run.status, 'running')
  await emit({ type: 'delta', data: { text: 'Günün ' } })
  assert.equal((await demo.request('/work/runs/daily-run')).answer, 'Günün ')
  await demo.request('/notifications')
  await emit({ type: 'delta', data: { text: 'değerlendirmesi' } })
  run = await demo.request('/work/runs/daily-run')
  await emit({ type: 'result', data: { run: { ...run, kind: 'ask', status: 'completed' } } })
  const restored = setup(storage).demo
  const completed = (await restored.request('/work/runs')).items.find((item) => item.run_id === 'daily-run')
  assert.equal(completed.kind, 'evening_review')
  assert.equal(completed.status, 'completed')
  assert.equal(completed.answer, 'Günün değerlendirmesi')
  assert.ok(requests.every((request) => !request.method))
  release()
})

test('non-streaming demo review also keeps its browser-local category', async () => {
  const { demo } = setup(new Map(), (path) => {
    assert.equal(path, '/demo/ask')
    return { run: { run_id: 'daily-sync', kind: 'ask', status: 'completed', answer: 'Günün özeti', question: 'Günü değerlendir', sources: [], stages: [], created_at: new Date().toISOString() } }
  })
  await demo.request('/work/review', post({}))
  assert.equal((await demo.request('/work/runs/daily-sync')).kind, 'evening_review')
})

test('stream updates honor the same cross-tab lock as visitor writes', { skip: !globalThis.navigator?.locks }, async () => {
  let emit
  let endStream
  const pending = new Promise((resolve) => { endStream = resolve })
  const { demo } = setup(new Map(), undefined, async (_path, _options, onEvent) => {
    emit = onEvent
    await onEvent({ type: 'accepted', data: { run_id: 'locked-run', status: 'running' } })
    await pending
  })
  await demo.request('/work/ask', post({ message: 'Soru' }))
  let unlock
  let acquired
  const held = new Promise((resolve) => { acquired = resolve })
  const lock = navigator.locks.request(demo.key, async () => {
    acquired()
    await new Promise((resolve) => { unlock = resolve })
  })
  await held
  try {
    const delta = emit({ type: 'delta', data: { text: 'Yanıt' } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal((await demo.request('/work/runs/locked-run')).answer, null)
    unlock()
    await delta
    assert.equal((await demo.request('/work/runs/locked-run')).answer, 'Yanıt')
  } finally {
    unlock()
    await lock
    endStream()
  }
})
