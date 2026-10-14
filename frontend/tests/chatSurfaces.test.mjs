import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

test('the shared + menu attaches files without navigating away and exposes tool chips', () => {
  const composer = read('components/AgentPrimitives.tsx')
  assert.doesNotMatch(composer, /to="\/memory"/)
  assert.match(composer, /aria-haspopup="menu"/)
  assert.match(composer, /onAdd\?\.\(\)/)
  assert.match(composer, /AgentToolChips/)
  for (const page of ['QueryPage', 'TeamChatPage']) {
    const source = read(`pages/${page}.tsx`)
    assert.match(source, /type="file"/)
    assert.match(source, /fileInputRef\.current\?\.click\(\)/)
    assert.match(source, /tools=\{agentControls\}/)
  }
})

test('the shared composer uses the native textarea caret and keeps model controls beside add', () => {
  const composer = read('components/AgentPrimitives.tsx')
  const controls = read('components/AgentControls.tsx')
  assert.doesNotMatch(composer, /agent-composer-highlight|agent-composer-editor-mentions|overlayRef/)
  assert.match(composer, /selectionStart/)
  assert.match(composer, /setSelectionRange\(nextCaret, nextCaret\)/)
  assert.ok(composer.indexOf('className="agent-prompt-add"') < composer.indexOf('{leading}'))
  assert.doesNotMatch(composer, /Shift \+ Enter|Yeni satır/)
  assert.match(controls, /className="agent-model-select"/)
  assert.match(controls, /className="agent-effort-select"/)
  assert.doesNotMatch(controls, /Response settings|Yanıt ayarları|<details/)
})

test('page loading stays neutral while agent work keeps its distinct thinking state', () => {
  const source = read('components/AgentPrimitives.tsx')
  const loading = source.slice(source.indexOf('export function LoadingState'), source.indexOf('export function ThinkingState'))
  assert.match(loading, /className="page-loading"/)
  assert.doesNotMatch(loading, /agent-loading-grid|agent-shimmer|agent-elapsed|setInterval/)
  assert.match(source, /export function ThinkingState/)
  assert.match(source, /className="agent-thinking-mark"/)
  assert.match(source, /<IzgeLogo \/>/)
})

test('private history includes archive/delete/new controls and team sidebar can collapse', () => {
  const query = read('pages/QueryPage.tsx')
  for (const method of ['listAssistantConversations', 'createAssistantConversation', 'updateAssistantConversation', 'deleteAssistantConversation', 'attachAssistantConversationFile']) assert.match(query, new RegExp(`api\\.${method}`))
  assert.match(query, /className="query-history-actions"/)
  assert.match(query, /useState\(true\)[\s\S]*team-chat-app-collapsed/)
  assert.match(query, /manageConversation\('rename', item\)/)
  assert.match(query, /<ButtonIcon name="edit"/)
  assert.match(query, /className="conversation-item query-history-select"/)
  assert.doesNotMatch(query, /Yanıtlar yalnızca erişebildiğiniz şirket kanıtlarını kullanır\./)
  assert.match(query, /runs\.length === 0 && attachments\.length === 0/)
  assert.equal(query.match(/items\.filter\(\(item\) => item\.conversation_id !== created\.conversation_id\)/g)?.length, 2)
  assert.match(query, /Yeni bir konuşma açmadan önce bu konuşmaya mesaj gönderin\./)
  assert.match(read('pages/TeamChatPage.tsx'), /aria-expanded=\{!sidebarCollapsed\}/)
})

test('agent evidence is compact until an individual source is expanded', () => {
  const source = read('components/AgentPrimitives.tsx')
  assert.match(source, /<details className="agent-evidence-source"/)
  assert.match(source, /className="agent-evidence-title"/)
  assert.match(source, /<AgentText text=\{source\.quote\}/)
  assert.match(source, /<SourcePreviewButton artifactId=\{source\.artifact_id\}/)
  assert.doesNotMatch(source, /<article className="agent-context-card"/)
})

test('assistant and navigation use the supplied logo rather than letter avatars', () => {
  for (const file of ['pages/QueryPage.tsx', 'pages/TeamChatPage.tsx', 'layout/AppShell.tsx', 'components/AgentPrimitives.tsx']) {
    const source = read(file)
    assert.match(source, /<IzgeLogo \/>/)
    assert.doesNotMatch(source, />İZ<|\? 'İZ'/)
  }
})
