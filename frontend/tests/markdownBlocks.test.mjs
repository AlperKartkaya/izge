import assert from 'node:assert/strict'
import test from 'node:test'
import { markdownBlocks } from '../src/lib/markdownBlocks.ts'

test('source documents render headings, tables and lists rather than raw Markdown', () => {
  assert.deepEqual(markdownBlocks('# Başlık\n\n| İş | Saat |\n|---|---:|\n| **CSV** | 7 |\n\n1. Onay al\n2. Takip et'), [
    { kind: 'heading', level: 1, text: 'Başlık' },
    { kind: 'table', headers: ['İş', 'Saat'], rows: [['**CSV**', '7']] },
    { kind: 'list', ordered: true, items: ['Onay al', 'Takip et'] },
  ])
})

test('code and arbitrary HTML stay literal, incomplete streams do not crash', () => {
  assert.deepEqual(markdownBlocks('```html\n<img onerror="alert(1)">'), [{ kind: 'code', text: '<img onerror="alert(1)">' }])
  assert.deepEqual(markdownBlocks('**mesaj**\n<script>alert(1)</script>'), [
    { kind: 'paragraph', text: '**mesaj**' }, { kind: 'paragraph', text: '<script>alert(1)</script>' },
  ])
  assert.equal(markdownBlocks('a | b\nnot a table').some((block) => block.kind === 'table'), false)
})
