import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('all icon sheets have nine uniquely named, correctly ordered crop cells', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../docs/design/icons/manifest.json', import.meta.url)))
  assert.equal(manifest.sheet_size, 1536)
  assert.equal(manifest.prepared_assets.glyph_max_size, 232)
  const ids = new Set()
  assert.equal(manifest.sheets.length, 4)
  manifest.sheets.forEach((sheet, sheetIndex) => {
    assert.equal(sheet.file, `sheet${sheetIndex + 1}.png`)
    assert.equal(sheet.icons.length, 9)
    sheet.icons.forEach((icon, index) => {
      const row = Math.floor(index / 3), column = index % 3
      assert.equal(icon.row, row + 1)
      assert.equal(icon.column, column + 1)
      assert.deepEqual(icon.crop, [column * 512, row * 512, (column + 1) * 512, (row + 1) * 512])
      const png = readFileSync(new URL(`../src/assets/button-icons/${icon.id}.png`, import.meta.url))
      assert.equal(png.subarray(1, 4).toString(), 'PNG')
      assert.equal(png.readUInt32BE(16), 256)
      assert.equal(png.readUInt32BE(20), 256)
      assert.ok([4, 6].includes(png[25]), 'PNG must keep an alpha channel')
      assert.ok(icon.function_tr)
      assert.ok(['icon-only', 'with-label'].includes(icon.treatment))
      assert.ok(!ids.has(icon.id))
      ids.add(icon.id)
    })
  })
  assert.equal(ids.size, 36)
})
