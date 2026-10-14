import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compactMarkdownPreview } from '../src/lib/agentText.ts'

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('employee home prioritizes work and actions instead of metric cards', () => {
  const source = read('pages/EmployeeHomePage.tsx')
  assert.doesNotMatch(source, /MetricCard/)
  assert.match(source, /employee-home-actions/)
  assert.match(source, /employee-home-summary/)
})

test('long reviews and their evidence retain full content behind disclosure controls', () => {
  const source = read('components/ReviewContextCards.tsx')
  assert.match(source, /<details className="review-context-details"/)
  assert.match(source, /compactMarkdownPreview\(review\.answer/)
  assert.match(source, /<details className="review-context-source"/)
  assert.match(source, /<AgentText text=\{review\.answer \?\? ''\}/)
  assert.match(source, /<AgentText text=\{source\.quote\}/)
})

test('notifications expand in place and expose separate persistent actions', () => {
  const source = read('pages/NotificationsPage.tsx')
  assert.match(source, /notification-copy-compact/)
  assert.match(source, /notification-full-copy/)
  assert.match(source, /api\.getNotification/)
  assert.match(source, /<AgentText text=\{detail\.body\}/)
  assert.doesNotMatch(source, /<AgentText text=\{item\.body\}/)
  assert.match(source, /api\.markNotificationUnread/)
  assert.match(source, /api\.deleteNotification/)
  assert.match(source, /openConversation\(item\)/)
  assert.match(source, /notification-action-open/)
  assert.match(source, /notification-action-danger/)
  assert.match(source, /revisionRef\.current/)
  assert.match(source, /mutationRef\.current/)
  assert.match(source, /key=\{`\$\{item\.notification_id\}:\$\{unreadOnly/)
  assert.doesNotMatch(source, /className="notification-item" onClick=/)
})

test('inline source references stay compact without losing their accessible title', () => {
  const source = read('components/AgentPrimitives.tsx')
  assert.match(source, /const sourceLabel = `\[\$\{token\.sourceIndex \+ 1\}\]`/)
  assert.match(source, /className="sr-only">\{source\.title\}/)
})

test('notification previews remove markdown noise and stay bounded', () => {
  assert.equal(compactMarkdownPreview('## Risk\n- **Atlas** [report](https://example.com) needs review.'), 'Risk Atlas report needs review.')
  assert.equal(compactMarkdownPreview('One two three four', 13), 'One two…')
})

test('sign-in fields support autofill and announce errors', () => {
  const source = read('pages/SignInPage.tsx')
  assert.match(source, /role="alert"/)
  assert.match(source, /name="email"/)
  assert.match(source, /autoComplete="username"/)
  assert.match(source, /name="password"/)
  assert.match(source, /aria-describedby=\{error \? 'sign-in-error' : undefined\}/)
})

test('public demo uses accessible persona buttons while preserving administrator sign-in', () => {
  const page = read('pages/SignInPage.tsx')
  const api = read('lib/api.ts')
  const auth = read('auth/AuthContext.tsx')
  assert.match(api, /request<DemoConfigRead>\('\/auth\/demo'\)/)
  assert.match(api, /request<TokenResponse>\('\/auth\/demo\/sign-in'/)
  assert.match(api, /JSON\.stringify\(\{ persona \}\)/)
  assert.match(auth, /demoSignIn: \(persona: DemoPersonaId\) => Promise<void>/)
  assert.match(page, /demoConfig\?\.enabled \? demoConfig : null/)
  assert.match(page, /className="quick-login-button"/)
  assert.match(page, /Yazılım Mühendisi/)
  assert.match(page, /Ekip Lideri/)
  assert.match(page, /caughtError\.status === 429/)
  assert.match(page, /Yönetici girişi/)
  assert.match(page, /id="admin-sign-in-form"/)
  assert.doesNotMatch(page, /hourly_limit/)
  assert.doesNotMatch(page, /Her IP adresi için saatte en fazla/)
})

test('automation instructions are secondary while run state stays scannable', () => {
  const source = read('pages/AutomationsPage.tsx')
  assert.match(source, /className="automation-instructions"/)
  assert.match(source, /className="automation-run-state"/)
  assert.match(source, /automation-danger-action/)
})

test('unread notifications use the persisted API filter and URL state', () => {
  const source = read('pages/NotificationsPage.tsx')
  assert.match(source, /searchParams\.get\('filter'\) === 'unread'/)
  assert.match(source, /api\.listNotifications\(token, unreadOnly\)/)
  assert.match(source, /aria-pressed=\{unreadOnly\}/)
})
