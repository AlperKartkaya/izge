import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeSse } from '../src/lib/sse.ts'

test('SSE handles byte splits, Turkish UTF-8, comments and real token events before completion', async () => {
  const text = ': heartbeat\r\n\r\nevent: accepted\r\ndata: {"run_id":"1"}\r\n\r\nevent: delta\ndata: {"text":"İzge"}\n\nevent: result\ndata: {"run":{"status":"completed"}}\n\n'
  const bytes = new TextEncoder().encode(text)
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } }))
  const events = []
  await consumeSse(response, (event) => { events.push(event) })
  assert.deepEqual(events.map((event) => event.type), ['accepted', 'delta', 'result'])
  assert.equal(events[1].data.text, 'İzge')
})

test('interrupted SSE is an error, never a completed answer', async () => {
  await assert.rejects(consumeSse(new Response('event: delta\ndata: {"text":"partial"}\n\n'), () => {}), /tamamlanmadan kesildi/)
})
