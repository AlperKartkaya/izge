import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('navigation preserves role-specific destinations and semantic links', () => {
  const source = read('layout/AppShell.tsx')
  assert.match(source, /const navigationItems = isAdmin \?/)
  assert.match(source, /<NavLink/)
  assert.match(source, /aria-label=\{label\}/)
  assert.match(read('App.tsx'), /session\?\.user\.role !== 'Admin'/)
})

test('agent settings preserve selected profiles, effort and cloud boundary disclosure', () => {
  const source = read('components/AgentControls.tsx')
  assert.match(source, /value=\{controls.modelProfile\}/)
  assert.match(source, /controls.setModelProfile/)
  assert.match(source, /controls.setReasoningEffort/)
  assert.match(source, /controls.selected\?\.data_boundary === 'cloud'/)
  assert.match(source, /disabled=\{disabled\}/)
})

test('page headings, skip navigation and agent controls keep accessible structure', () => {
  const ui = read('components/ui.tsx')
  assert.match(ui, /<h1 className="page-title">/)
  assert.match(ui, /<h2 className="section-title">/)
  const shell = read('layout/AppShell.tsx')
  assert.match(shell, /href="#main-content"/)
  assert.match(shell, /id="main-content"[^>]*tabIndex=\{-1\}/)
  const controls = read('components/AgentControls.tsx')
  assert.match(controls, /<fieldset className="agent-controls"/)
  assert.match(controls, /<legend className="sr-only">/)
  assert.match(controls, /data_boundary === 'cloud'/)
})

test('shared empty and loading states use their own restrained responsive surface', () => {
  const ui = read('components/ui.tsx')
  const css = read('components/page-states.css')
  assert.match(ui, /className="empty-state page-empty-state"/)
  assert.match(css, /\.page-empty-state/)
  assert.match(css, /border-radius: var\(--radius-md\)/)
  assert.match(css, /\.page-empty-state > :where\(p\)/)
  assert.match(css, /\.page-loading/)
})

test('shared employee panels keep padded rounded boundaries for headings and rows', () => {
  const css = read('refinement.css')
  const panelRule = css.match(/:root\[data-theme\] \.section-panel \{([^}]+)\}/)?.[1] ?? ''
  assert.match(panelRule, /padding: 1rem/)
  assert.match(panelRule, /border: 1px solid var\(--color-border\)/)
  assert.match(panelRule, /border-radius: var\(--radius-md\)/)
  assert.doesNotMatch(panelRule, /border-radius: 0|padding: 1\.25rem 0/)
})

test('semantic dark and light text pairs meet normal text contrast, including CTA', () => {
  function luminance(hex) {
    const [r, g, b] = hex.match(/[a-f\d]{2}/gi).map((value) => {
      const c = parseInt(value, 16) / 255
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
    })
    return .2126 * r + .7152 * g + .0722 * b
  }
  for (const [foreground, background] of [
    ['#f8fafc', '#0c131d'], ['#a7b3c5', '#121d2b'], ['#05070d', '#9cb5ff'],
    ['#111827', '#ffffff'], ['#4b5563', '#f3f4f6'], ['#ffffff', '#2563eb'],
    ['#f29b95', '#0c131d'], ['#a52b2b', '#ffffff'],
  ]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `${foreground} on ${background}`)
  }
  assert.match(read('refinement.css'), /color: var\(--color-on-primary\) !important/)
})

test('task rows show actual owner and due date without inventing priority', () => {
  const source = read('components/AgentPrimitives.tsx')
  assert.match(source, /task\.assignee_display_name/)
  assert.match(source, /formatDateTime\(task\.due_at\)/)
})

test('graph labels and keyboard-selected edges have explicit theme-aware styling', () => {
  const css = read('refinement.css')
  assert.match(css, /\.evidence-flow-canvas \.react-flow__node:focus-visible/)
  assert.match(css, /\.evidence-flow-node-copy strong/)
  assert.match(css, /\.graph-search-results :is\(button, a\)/)
})

test('localized badge text preserves semantic status and stage outcomes have text alternatives', () => {
  assert.match(read('components/ui.tsx'), /StatusBadge\(\{ value, status = value \}/)
  assert.match(read('pages/TargetReadinessPage.tsx'), /status=\{gaps.length \? 'warning' : 'success'\}/)
  assert.match(read('components/AgentPrimitives.tsx'), /className="sr-only">\{stage.status === 'completed'/)
})
