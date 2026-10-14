import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('private Izge replies use persisted messages and retain the quoted message', () => {
  const page = read('pages/QueryPage.tsx')

  assert.match(page, /setChatMessages\(chat\.messages\.filter/)
  assert.match(page, /metadataString\(message, 'colleague_run_id'\)/)
  assert.match(page, /run\.status === 'completed'/)
  assert.match(page, /questionMessage\?\.reply_to/)
  assert.match(page, /reply_to_message_id: replyingTo\?\.message_id/)
  assert.match(page, /className="query-reply-preview"/)
  assert.match(page, /setReplyingTo\(null\)/)
})

test('private reply action supports hover, keyboard focus, and touch', () => {
  const css = read('pages/query-replies.css')

  assert.match(css, /\.query-reply-target:hover \.query-reply-button/)
  assert.match(css, /\.query-reply-button:focus-visible/)
  assert.match(css, /@media \(hover: none\)/)
})

test('a synchronous demo ask shows work and refreshes persisted messages', () => {
  const page = read('pages/QueryPage.tsx')

  assert.match(page, /isSending \? <div className="query-send-loading"><ThinkingState/)
  assert.match(page, /setActiveRunId\(run\.status === 'queued' \|\| run\.status === 'running' \? run\.run_id : null\)/)
  assert.match(page, /api\.listTeamChatMessages\(session\.token, 200, threadId\)[\s\S]*setChatMessages/)
})
