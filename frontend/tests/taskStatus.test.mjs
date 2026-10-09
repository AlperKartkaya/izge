import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTaskStatus, taskStatusAction, taskStatusLabel } from '../src/lib/taskStatus.ts'

test('task status cycles through open, in progress and done', () => {
  assert.equal(nextTaskStatus('open'), 'in_progress')
  assert.equal(nextTaskStatus('in_progress'), 'done')
  assert.equal(nextTaskStatus('done'), 'open')
})

test('task status labels and actions follow the selected language', () => {
  assert.equal(taskStatusLabel('in_progress', 'tr'), 'Devam ediyor')
  assert.equal(taskStatusLabel('in_progress', 'en'), 'In progress')
  assert.equal(taskStatusAction('Teklifi gönder', 'done', 'tr'), 'Teklifi gönder görevini yeniden aç')
  assert.equal(taskStatusAction('Send proposal', 'done', 'en'), 'Reopen Send proposal')
})
