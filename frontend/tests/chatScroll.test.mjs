import assert from 'node:assert/strict'
import test from 'node:test'
import { isNearChatBottom } from '../src/lib/chatScroll.ts'

test('chat follows at the bottom but preserves a reader scrolled into history', () => {
  assert.equal(isNearChatBottom({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 }), true)
  assert.equal(isNearChatBottom({ scrollHeight: 2000, scrollTop: 1436, clientHeight: 500 }), true)
  assert.equal(isNearChatBottom({ scrollHeight: 2000, scrollTop: 1435, clientHeight: 500 }), false)
  assert.equal(isNearChatBottom({ scrollHeight: 2000, scrollTop: 300, clientHeight: 500 }), false)
  assert.equal(isNearChatBottom({ scrollHeight: 200, scrollTop: 0, clientHeight: 500 }), true)
})
