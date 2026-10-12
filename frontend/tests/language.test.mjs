import assert from 'node:assert/strict'
import test from 'node:test'
import { getLanguage, readInitialLanguage, setCurrentLanguage, translate } from '../src/lib/language.ts'
import { formatDateTime, formatLabel, formatStatus, formatSystemText } from '../src/lib/format.ts'

test('Turkish is the default; unsupported or inaccessible preferences cannot break it', () => {
  assert.equal(readInitialLanguage(), 'tr')
  globalThis.localStorage = { getItem: () => 'xx' }
  assert.equal(readInitialLanguage(), 'tr')
  globalThis.localStorage = { getItem: () => { throw new Error('blocked') } }
  assert.equal(readInitialLanguage(), 'tr')
  delete globalThis.localStorage
})

test('English preference persists and formatters change without changing Istanbul timezone', () => {
  const saved = new Map()
  globalThis.localStorage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) }
  setCurrentLanguage('en')
  assert.equal(readInitialLanguage(), 'en')
  assert.equal(getLanguage(), 'en')
  assert.equal(translate('Send', 'Gönder'), 'Send')
  assert.equal(formatStatus('in_progress'), 'In progress')
  assert.match(formatDateTime('2026-10-09T07:00:00'), /10:00/)
  assert.match(formatDateTime('2026-10-09T07:00:00'), /Oct/)
  setCurrentLanguage('tr')
  assert.equal(translate('Send', 'Gönder'), 'Gönder')
  assert.equal(formatStatus('in_progress'), 'Devam ediyor')
  delete globalThis.localStorage
})


test('system stage translations never rewrite arbitrary source or company text', () => {
  setCurrentLanguage('en')
  assert.equal(formatSystemText('Şirket bilgileri taranıyor'), 'Searching company information')
  assert.equal(formatSystemText('Atlas.md hafızaya işleniyor'), 'Adding Atlas.md to memory')
  assert.equal(formatSystemText('Atlas müşteri talebi'), 'Atlas müşteri talebi')
  setCurrentLanguage('tr')
  assert.equal(formatSystemText('Şirket bilgileri taranıyor'), 'Şirket bilgileri taranıyor')
})

test('known operational messages are localized without altering source titles', () => {
  setCurrentLanguage('tr')
  assert.equal(formatSystemText('Review pending artifacts'), 'Bekleyen kaynakları inceleyin')
  assert.equal(formatSystemText('Database and source storage'), 'Veritabanı ve kaynak depolaması')
  assert.equal(formatSystemText('Atlas customer evidence'), 'Atlas customer evidence')
  setCurrentLanguage('en')
  assert.equal(formatSystemText('Bekleyen kaynakları inceleyin'), 'Review pending artifacts')
  setCurrentLanguage('tr')
})


test('processing stages use operational Turkish labels', () => {
  setCurrentLanguage('tr')
  assert.equal(formatLabel('contradiction_interrogator'), 'Çelişki incelemesi')
  assert.equal(formatLabel('provenance_verifier'), 'Kaynak doğrulama')
})
