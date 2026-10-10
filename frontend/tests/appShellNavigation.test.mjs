import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const shell = readFileSync(new URL('../src/layout/AppShell.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

test('left navigation defaults to icons and exposes an accessible expansion control', () => {
  assert.match(shell, /useState\(false\)/)
  assert.match(shell, /aria-expanded=\{sidebarExpanded\}/)
  assert.match(shell, /className="nav-link-label"/)
  assert.match(shell, /aria-label=\{label\}/)
  assert.match(css, /grid-template-columns: 4\.5rem minmax\(0, 1fr\)/)
  assert.match(css, /\.app-frame-sidebar-expanded[\s\S]*grid-template-columns: 16rem minmax\(0, 1fr\)/)
})

test('icon-only controls keep a full accessible pointer target and centered glyph', () => {
  assert.match(css, /\.icon-button[\s\S]*width: 2\.75rem[\s\S]*height: 2\.75rem[\s\S]*place-items: center/)
  assert.match(css, /\.app-sidebar \.nav-link > \.button-icon[\s\S]*width: 1\.55rem[\s\S]*height: 1\.55rem/)
})
