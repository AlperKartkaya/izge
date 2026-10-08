import assert from 'node:assert/strict'
import test from 'node:test'
import { sourcePreviewError, sourcePreviewKind } from '../src/lib/sourcePreview.ts'

test('source preview only embeds supported safe content types', () => {
  assert.equal(sourcePreviewKind('text/plain; charset=utf-8'), 'text')
  assert.equal(sourcePreviewKind('text/markdown'), 'text')
  assert.equal(sourcePreviewKind('APPLICATION/PDF'), 'pdf')
  assert.equal(sourcePreviewKind('application/octet-stream'), 'unsupported')
  assert.equal(sourcePreviewKind(null), 'unsupported')
})

test('source preview maps access errors to Turkish messages', () => {
  assert.equal(sourcePreviewError(403), 'Bu kaynağı görüntüleme yetkiniz yok.')
  assert.equal(sourcePreviewError(404), 'Kaynak bulunamadı.')
  assert.equal(sourcePreviewError(500), 'Kaynak önizlemesi yüklenemedi.')
})
