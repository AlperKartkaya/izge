import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('brand component uses the supplied SVG and document uses supplied favicon assets', () => {
  assert.match(read('../src/components/IzgeLogo.tsx'), /branding\/icon.svg/)
  assert.match(read('../index.html'), /\/icon.svg/)
  assert.match(read('../index.html'), /\/icon.png/)
})

test('chat and ordinary shell share desktop geometry and reserved scrollbar space', () => {
  const css = read('../src/refinement.css')
  assert.match(css, /html \{[^}]*scrollbar-gutter: stable/)
  assert.match(css, /\.app-frame\.app-frame-chat \{[^}]*padding: var\(--space-4\)/)
})

test('workspace IDs are explicitly technical identifiers, not workspace names', () => {
  for (const path of ['DashboardPage', 'OperationsPage']) {
    const source = read(`../src/pages/${path}.tsx`)
    assert.match(source, /Technical workspace ID/)
    assert.doesNotMatch(source, /t\('Workspace', 'Çalışma alanı'\).*<\/dt>\s*<dd>\{(?:summary|overview)/)
  }
})

test('runs prioritize activity over internal orchestration documentation', () => {
  const source = read('../src/pages/OrchestrationPage.tsx')
  assert.ok(source.indexOf('Recent work') < source.indexOf('Technical diagnostics'))
  assert.match(source, /Raw runtime description/)
  assert.doesNotMatch(source, /Recent database-backed job queue/)
})
