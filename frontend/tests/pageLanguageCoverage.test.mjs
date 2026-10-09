import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pages = [
  'AdminPage',
  'AuditPage',
  'AutomationsPage',
  'DataAdminPage',
  'EmployeeHomePage',
  'EmployeeMemoryPage',
  'GraphPage',
  'IngestionPage',
  'MemoryDetailPage',
  'MemoryFilesystemPage',
  'NotificationsPage',
  'OperationsPage',
  'OrchestrationPage',
  'QueryPage',
  'QueryResultPage',
  'SignInPage',
  'SignalDetailPage',
  'TargetReadinessPage',
  'TasksPage',
  'TeamChatPage',
]

test('every routed leaf page uses the shared language context', () => {
  for (const page of pages) {
    const source = readFileSync(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8')
    assert.match(source, /useLanguage\(\)/, `${page} must render through the shared language context`)
  }
})

test('route wrappers delegate to localized employee pages', () => {
  const home = readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8')
  const memory = readFileSync(new URL('../src/pages/MemoryPage.tsx', import.meta.url), 'utf8')
  assert.match(home, /EmployeeHomePage/)
  assert.match(memory, /EmployeeMemoryPage/)
})
