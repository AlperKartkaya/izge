import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('brand component uses the supplied SVG and document uses supplied favicon assets', () => {
  assert.match(read('../src/components/IzgeLogo.tsx'), /branding\/icon.svg/)
  assert.match(read('../index.html'), /\/icon.svg\?v=3/)
  assert.match(read('../index.html'), /\/icon.png\?v=3/)
  assert.match(read('../public/icon.svg'), /fill="#05070D"/)
  assert.match(read('../public/icon.svg'), /fill="#FFFFFF"/)
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

test('product polish keeps mark padding, route focus and explicit theme icons', () => {
  const css = read('../src/refinement.css')
  assert.match(css, /\.izge-logo\s*\{[^}]*mask-size:\s*84% 84%/)
  assert.match(css, /#main-content:focus\s*\{[^}]*outline:\s*none/)
  assert.match(read('../src/layout/AppShell.tsx'), /mainRef.current\?\.focus/)
  assert.match(read('../src/components/ThemeIcon.tsx'), /Sun/)
  assert.match(read('../src/components/ThemeIcon.tsx'), /Moon/)
  assert.doesNotMatch(read('../src/pages/SignInPage.tsx'), /Şirketinize giriş yapın/)
})

test('home shortcuts are product actions rather than unstyled anchors', () => {
  const source = read('../src/pages/EmployeeHomePage.tsx')
  const css = read('../src/pages/employee-home.css')
  assert.match(source, /className="home-action"/)
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.doesNotMatch(source, /<Link to="\/tasks">/)
})

test('automation polling does not hide run errors and keeps work accessible in chat', () => {
  const source = read('../src/pages/AutomationsPage.tsx')
  const load = source.slice(source.indexOf('const load = async'), source.indexOf('void load()'))
  assert.doesNotMatch(load, /setError\(null\)/)
  assert.match(source, /İzge çalışıyor/)
  assert.match(source, /Tamamlanan görev/)
  assert.match(source, /onClick=\{\(\) => openHistory\(item\)\}/)
})
