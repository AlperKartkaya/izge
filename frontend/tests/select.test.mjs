import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('shared select supports empty values, native form fields and accessible popper controls', () => {
  const source = read('components/Select.tsx')
  assert.match(source, /const encodeValue = \(value: string\) => `value:\$\{value\}`/)
  assert.match(source, /name=\{props\.name\}/)
  assert.match(source, /required=\{props\.required\}/)
  assert.match(source, /aria-label=\{props\['aria-label'\]\}/)
  assert.match(source, /ScrollUpButton/)
  assert.match(source, /ScrollDownButton/)
})

test('application pages use the shared select instead of native selects', () => {
  const pages = [
    'components/AgentControls.tsx', 'pages/AdminPage.tsx', 'pages/ArtifactsPage.tsx',
    'pages/AutomationsPage.tsx', 'pages/DataAdminPage.tsx', 'pages/GraphPage.tsx',
    'pages/IngestionPage.tsx', 'pages/TasksPage.tsx', 'pages/TeamChatPage.tsx',
  ]
  for (const page of pages) {
    const source = read(page)
    assert.doesNotMatch(source, /<select\b/, page)
    assert.match(source, /<Select\b/, page)
  }
})

test('named forms submit domain values and required empty selection stays empty', () => {
  const source = read('components/Select.tsx')
  assert.match(source, /type="hidden" name=\{props.name\} value=\{value\}/)
  assert.match(source, /props.required && value === '' \? '' : encodeValue\(value\)/)
})

test('shared select renders accessible value and preserves form data without a browser', async () => {
  const { default: ts } = await import('typescript')
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  let source = read('components/Select.tsx').replace("import './select.css'", '')
  source = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText
  source = source.replace(/from ["']([^"']+)["']/g, (_, name) => `from "${import.meta.resolve(name)}"`)
  const { Select } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const html = renderToStaticMarkup(createElement(Select, {
    value: '', name: 'filter', onValueChange: () => {}, 'aria-label': 'Kaynak',
    options: [{ value: '', label: 'Tümü' }, { value: 'value:', label: 'Gerçek değer' }],
  }))
  assert.match(html, /role="combobox"/)
  assert.match(html, /aria-label="Kaynak"/)
  assert.match(html, /type="hidden" name="filter" value=""/)
  assert.match(html, /Tümü/)
  const disabled = renderToStaticMarkup(createElement(Select, {
    value: 'tr', disabled: true, onValueChange: () => {}, 'aria-label': 'Dil',
    options: [{ value: 'tr', label: 'Türkçe' }],
  }))
  assert.match(disabled, /disabled=""/)
})
