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

test('private history includes archive/delete/new controls and team sidebar can collapse', () => {
  const query = read('pages/QueryPage.tsx')
  for (const method of ['listAssistantConversations', 'createAssistantConversation', 'updateAssistantConversation', 'deleteAssistantConversation', 'attachAssistantConversationFile']) assert.match(query, new RegExp(`api\\.${method}`))
  assert.match(read('pages/TeamChatPage.tsx'), /aria-expanded=\{!sidebarCollapsed\}/)
})

test('assistant and navigation use the supplied logo rather than letter avatars', () => {
  for (const file of ['pages/QueryPage.tsx', 'pages/TeamChatPage.tsx', 'layout/AppShell.tsx', 'components/AgentPrimitives.tsx']) {
    const source = read(file)
    assert.match(source, /<IzgeLogo \/>/)
    assert.doesNotMatch(source, />İZ<|\? 'İZ'/)
  }
})
