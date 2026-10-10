import assert from 'node:assert/strict'
import test from 'node:test'
import { homeGreeting } from '../src/lib/greeting.ts'

test('home greets the signed-in employee by first name and Istanbul hour', () => {
  assert.equal(homeGreeting('Kerem Demir', 'tr', new Date('2026-10-09T04:00:00Z')), 'Günaydın, Kerem')
  assert.equal(homeGreeting('Deniz Yılmaz', 'tr', new Date('2026-10-09T10:00:00Z')), 'İyi günler, Deniz')
  assert.equal(homeGreeting(' Ece Kaya ', 'tr', new Date('2026-10-09T16:00:00Z')), 'İyi akşamlar, Ece')
  assert.equal(homeGreeting('', 'en', new Date('2026-10-09T16:00:00Z')), 'Good evening')
})
