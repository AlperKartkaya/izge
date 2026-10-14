import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('team chat replies keep a cancellable quote and persist the target id', () => {
  const page = read('pages/TeamChatPage.tsx')
  const api = read('lib/api.ts')
  const types = read('lib/types.ts')

  assert.match(page, /setReplyingTo\(message\)/)
  assert.match(page, /className="team-chat-reply-preview"/)
  assert.match(page, /setReplyingTo\(null\)/)
  assert.match(page, /className="team-chat-reply-quote"/)
  assert.match(page, /reply_to_message_id: replyingTo\?\.message_id/)
  assert.match(api, /reply_to_message_id\?: string/)
  assert.match(types, /is_authored_by_current_user: boolean/)
  assert.match(types, /reply_to: \{/)
})

test('reply action is available on hover, keyboard focus, and touch screens', () => {
  const css = read('pages/team-chat-replies.css')
  assert.match(css, /\.team-chat-message:hover \.team-chat-reply-button/)
  assert.match(css, /\.team-chat-reply-button:focus-visible/)
  assert.match(css, /@media \(hover: none\)/)
  assert.doesNotMatch(css, /right: -/)
  assert.match(css, /\.team-chat-message:focus-within/)
})

test('your messages stay on the right and only agent work shows the pixel loader', () => {
  const css = read('refinement.css')
  assert.match(css, /\.team-chat-messages \.team-chat-message-row-own \{ align-self: flex-end; flex-direction: row-reverse;/)
  assert.doesNotMatch(read('pages/TeamChatPage.tsx'), /Mesaj gönderiliyor/)
  assert.match(read('components/AgentPrimitives.tsx'), /working \? <span className="agent-loading-grid"/)
})

test('persisted SSE replay resets the cached answer only on its first connection', () => {
  const api = read('lib/api.ts')
  assert.match(api, /addEventListener\('open', \(\) => events.dispatchEvent\(new MessageEvent\('reset', \{ data: '\{\}' \}\)\), \{ once: true \}\)/)
})
