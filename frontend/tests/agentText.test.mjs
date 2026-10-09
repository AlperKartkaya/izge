import assert from 'node:assert/strict'
import test from 'node:test'
import { insertIzgeMention, tokenizeAgentText } from '../src/lib/agentText.ts'

test('agent text identifies bold, citations and İzge mentions without HTML parsing', () => {
  assert.deepEqual(tokenizeAgentText('**Risk:** @izge kontrol et [2]'), [
    { kind: 'bold', value: 'Risk:' },
    { kind: 'text', value: ' ' },
    { kind: 'mention', value: '@izge' },
    { kind: 'text', value: ' kontrol et ' },
    { kind: 'source', value: '[2]', sourceIndex: 1 },
  ])
})

test('bold content remains available for nested citation and mention rendering', () => {
  const [bold] = tokenizeAgentText('**Risk [1] için @izge**')
  assert.deepEqual(bold, { kind: 'bold', value: 'Risk [1] için @izge' })
  assert.deepEqual(tokenizeAgentText(bold.value).map((token) => token.kind), ['text', 'source', 'text', 'mention'])
})

test('mention selection replaces only the active @ token', () => {
  assert.equal(insertIzgeMention('Lütfen @iz'), 'Lütfen @izge ')
  assert.equal(insertIzgeMention('Kontrol et'), 'Kontrol et @izge ')
})

test('human references and unknown citations remain visible while valid citations become chips', () => {
  assert.deepEqual(tokenizeAgentText('madde [1]', 0), [
    { kind: 'text', value: 'madde ' }, { kind: 'text', value: '[1]' },
  ])
  assert.deepEqual(tokenizeAgentText('[0] [1] [2]', 1).map((token) => token.kind), ['text', 'text', 'source', 'text', 'text'])
})

test('Turkish-cased mentions are highlighted in sent messages too', () => {
  for (const mention of ['@izge', '@İzge', '@ızge', '@IZGE']) {
    assert.deepEqual(tokenizeAgentText(mention), [{ kind: 'mention', value: mention }])
  }
})
