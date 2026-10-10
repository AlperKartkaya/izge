import assert from 'node:assert/strict'
import test from 'node:test'
import { automationFrequencyLabel, automationRunStatusLabel, istanbulStartToIso, nextRunRemaining } from '../src/lib/automationSchedule.ts'

test('automation schedules have concise Turkish and English labels', () => {
  assert.equal(automationFrequencyLabel('hourly', 'tr'), 'Her saat')
  assert.equal(automationFrequencyLabel('every_6_hours', 'en'), 'Every 6 hours')
  assert.equal(nextRunRemaining('2026-10-09T12:31:00', new Date('2026-10-09T10:00:00Z'), 'tr'), 'Sıradaki çalışmaya 2 sa 31 dk')
  assert.equal(nextRunRemaining(null, new Date(), 'en'), null)
  assert.equal(automationRunStatusLabel('queued', 'tr'), 'Sırada')
  assert.equal(automationRunStatusLabel('running', 'en'), 'In progress')
  assert.equal(automationRunStatusLabel('failed', 'tr'), 'Başarısız')
})

test('Istanbul date and time inputs become an explicit UTC instant', () => {
  assert.equal(istanbulStartToIso('2026-10-09', '16:00'), '2026-10-09T13:00:00.000Z')
})
