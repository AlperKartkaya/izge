import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/pages/EmployeeHomePage.tsx', import.meta.url), 'utf8')

test('daily review stays inline and streams agent output', () => {
  assert.match(source, /<ThinkingState stages=\{reviewRun\?\.stages \?\? \[\]\}/)
  assert.match(source, /<AgentAnswer text=\{currentReviewText\}/)
  assert.match(source, /events\.addEventListener\('delta'/)
  assert.match(source, /events\.addEventListener\('snapshot'/)
  assert.match(source, /events\.addEventListener\('reset'/)
  assert.match(source, /\['stage', 'source', 'done', 'failed'\]/)
})

test('daily review resumes active work and keeps accepted legacy output visible', () => {
  assert.match(source, /run\.kind === 'evening_review' && \(run\.status === 'queued' \|\| run\.status === 'running'\)/)
  assert.match(source, /const reviewWorking = reviewPending \|\|/)
  assert.match(source, /reviewRun\?\.status === 'completed' \? reviewRun\.answer/)
  assert.doesNotMatch(source, /navigate\(['"]\/query/)
})

test('starting another review clears old output and ignores clicks before workspace hydration', () => {
  assert.match(source, /setReviewPending\(true\); setReviewRun\(null\); setError\(null\); setStreamedReview\(''\)/)
  assert.match(source, /disabled=\{loading \|\| reviewWorking\}/)
  assert.match(source, /!reviewRun && !reviewPending && latestReview/)
})
