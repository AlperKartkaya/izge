import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type ReactNode, type RefObject } from 'react'
import { insertIzgeMentionAtCaret, tokenizeAgentText } from '../lib/agentText'
import { markdownBlocks } from '../lib/markdownBlocks'
import { useLanguage } from '../lib/i18n'
import { formatDateTime, formatSystemText } from '../lib/format'
import { nextTaskStatus, taskStatusAction, taskStatusLabel } from '../lib/taskStatus'
import { latestAgentStages, safeHttpUrl } from '../lib/agentRun'
import type { AgentRunStageRead, AgentSourceRead, WorkTaskRead, WorkTaskStatus } from '../lib/types'
import { ButtonIcon } from './ButtonIcon'
import { IzgeLogo } from './IzgeLogo'
import { AgentToolMenu, AgentToolChips } from './AgentControls'
import type { useAgentControls } from './useAgentControls'
import { SourcePreviewButton } from './SourcePreviewButton'
import './page-states.css'

/* Adapted from beautiful-ui primitives at 44a274e598395ab61e7c96c26fda2758780253b7.
 * Copyright (c) 2026 Shane Levine, MIT License. Animations are driven by real API state. */

export function LoadingState({ label }: { label: string }) {
  return <div className="page-loading" role="status">{label}</div>
}

export function ThinkingState({ stages, status }: { stages: AgentRunStageRead[]; status: 'queued' | 'running' | 'completed' | 'failed' }) {
  const { t } = useLanguage()
  const working = status === 'queued' || status === 'running'
  const [expanded, setExpanded] = useState(working)
  const visibleStages = latestAgentStages(stages)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!working) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 100)
    return () => window.clearInterval(timer)
  }, [working])

  return (
    <div className="agent-thinking">
      <button type="button" className="agent-thinking-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {working ? <span className="agent-loading-grid" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 70}ms` }} />)}</span> : <span className="agent-thinking-mark" aria-hidden="true"><IzgeLogo /></span>}
        <span className={working ? 'agent-shimmer' : ''}>{working ? t('Izge is thinking', 'İzge düşünüyor') : status === 'completed' ? t('Work completed', 'Çalışma tamamlandı') : t('Work failed', 'Çalışma başarısız')}</span>
        {working ? <span className="agent-elapsed" aria-hidden="true">{elapsed.toFixed(1)}s</span> : null}
        <span className="disclosure-indicator" aria-hidden="true" />
      </button>
      {expanded ? (
        <ol className="agent-stage-list">
          {visibleStages.map((stage) => (
            <li key={`${stage.sequence}-${stage.key}`} data-status={stage.status}>
              <span className="agent-stage-mark" aria-hidden="true">{stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '×' : stage.status === 'running' ? '…' : '○'}</span>
              <span className="sr-only">{stage.status === 'completed' ? t('Completed', 'Tamamlandı') : stage.status === 'failed' ? t('Failed', 'Başarısız') : stage.status === 'running' ? t('Running', 'Çalışıyor') : t('Pending', 'Bekliyor')}</span>
              <span><strong>{formatSystemText(stage.label)}</strong>{stage.summary ? <small>{formatSystemText(stage.summary)}</small> : null}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

export function StreamingText({ children, active }: { children: string; active: boolean }) {
  const { t } = useLanguage()
  return <div className="agent-streaming-text"><AgentText text={children} />{active ? <span className="agent-streaming-cursor" aria-label={t('Writing response', 'Yanıt yazılıyor')} /> : null}</div>
}

function InlineText({ text, sources = [] }: { text: string; sources?: AgentSourceRead[] }) {
  return tokenizeAgentText(text, sources.length).map((token, index) => {
    if (token.kind === 'link') {
      const url = safeHttpUrl(token.href)
      return url ? <a key={index} href={url} target="_blank" rel="noreferrer">{token.value}</a> : token.value
    }
    if (token.kind === 'code') return <code key={index}>{token.value}</code>
    if (token.kind === 'bold') return <strong key={index}><InlineText text={token.value} sources={sources} /></strong>
    if (token.kind === 'mention') return <mark className="izge-mention" key={index}>{token.value}</mark>
    if (token.kind === 'source') {
      const source = sources[token.sourceIndex]
      if (!source) return token.value
      const sourceLabel = `[${token.sourceIndex + 1}]`
      const citation = <>{sourceLabel}<span className="sr-only">{source.title}</span></>
      const url = source.source_type === 'web' ? safeHttpUrl(source.url) : null
      if (url) return <a key={index} href={url} target="_blank" rel="noreferrer" className="agent-inline-source" title={source.title}>{citation}</a>
      if (source.source_type === 'mcp' || source.source_type === 'web') return <span key={index} className="agent-inline-source" title={source.title}>{citation}</span>
      return <SourcePreviewButton key={index} artifactId={source.artifact_id} title={source.title} className="agent-inline-source">{citation}</SourcePreviewButton>
    }
    return token.value
  })
}

export function AgentText({ text, sources = [] }: { text: string; sources?: AgentSourceRead[] }) {
  return <>{markdownBlocks(text).map((block, index) => {
    const inline = (value: string) => <InlineText text={value} sources={sources} />
    if (block.kind === 'heading') {
      // Documents live inside a page: do not introduce a second page-level h1.
      if (block.level <= 2) return <h3 key={index}>{inline(block.text)}</h3>
      return <h4 key={index}>{inline(block.text)}</h4>
    }
    if (block.kind === 'code') return <pre key={index}><code>{block.text}</code></pre>
    if (block.kind === 'quote') return <blockquote key={index}>{inline(block.text)}</blockquote>
    if (block.kind === 'table') return <div className="markdown-table-scroll" key={index}><table><thead><tr>{block.headers.map((cell, column) => <th key={column}>{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.headers.map((_, column) => <td key={column}>{inline(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
    if (block.kind === 'list') {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>
    }
    return <p key={index}>{inline(block.text)}</p>
  })}</>
}

export function AgentAnswer({ text, sources = [], followUps = [], onFollowUp, active = false }: { text: string; sources?: AgentSourceRead[]; followUps?: string[]; onFollowUp?: (question: string) => void; active?: boolean }) {
  const { t } = useLanguage()
  return <div className="agent-answer">
    <div className="agent-answer-copy"><AgentText text={text} sources={sources} />{active ? <span className="agent-streaming-cursor" aria-label={t('Writing response', 'Yanıt yazılıyor')} /> : null}</div>
    {sources.length ? <details className="agent-evidence"><summary>{sources.length} {t('sources', 'kaynak')}</summary><div className="agent-evidence-list" aria-label={t('Sources used in the response', 'Yanıtta kullanılan kaynaklar')}>{sources.map((source, index) => {
      const url = source.source_type === 'web' ? safeHttpUrl(source.url) : null
      return <details className="agent-evidence-source" key={`${source.source_type ?? 'artifact'}-${source.artifact_id}-${source.chunk_id ?? index}`}><summary><span className="agent-evidence-index">{index + 1}</span><span className="agent-evidence-title">{source.title}</span></summary><div className="agent-evidence-detail"><div className="agent-context-excerpt markdown-content" tabIndex={0} role="region" aria-label={t(`Excerpt: ${source.title}`, `Alıntı: ${source.title}`)}><AgentText text={source.quote} /></div>{url ? <a href={url} target="_blank" rel="noreferrer">{t('Open web source', 'Web kaynağını aç')}</a> : source.source_type === 'mcp' ? <small>{t('Company tool context', 'Şirket aracı bağlamı')}</small> : source.source_type === 'web' ? <small>{t('Web address unavailable', 'Web adresi kullanılamıyor')}</small> : <SourcePreviewButton artifactId={source.artifact_id} title={source.title} />}</div></details>
    })}</div></details> : null}
    {followUps.length && onFollowUp ? <div className="agent-follow-ups"><strong>{t('Would you like to continue?', 'Devam etmek ister misiniz?')}</strong>{followUps.map((question) => <button type="button" key={question} onClick={() => onFollowUp(question)}>{question}</button>)}</div> : null}
  </div>
}

export function TaskRows({ tasks, onStatusChange }: { tasks: WorkTaskRead[]; onStatusChange: (task: WorkTaskRead, status: WorkTaskStatus) => Promise<void> }) {
  const { language, t } = useLanguage()
  const [pendingTasks, setPendingTasks] = useState<Set<string>>(new Set())
  const pendingRef = useRef(new Set<string>())
  async function changeStatus(task: WorkTaskRead) {
    if (pendingRef.current.has(task.task_id)) return
    pendingRef.current.add(task.task_id)
    setPendingTasks(new Set(pendingRef.current))
    try { await onStatusChange(task, nextTaskStatus(task.status)) }
    finally {
      pendingRef.current.delete(task.task_id)
      setPendingTasks(new Set(pendingRef.current))
    }
  }
  return (
    <div className="agent-task-rows">
      {tasks.map((task) => (
        <article key={task.task_id} className="agent-task-row">
          <button
            type="button"
            className="agent-task-check"
            aria-label={taskStatusAction(task.title, task.status, language)}
            disabled={pendingTasks.has(task.task_id)}
            onClick={() => void changeStatus(task)}
          >
            <ButtonIcon name={task.status === 'done' ? 'task-done' : task.status === 'in_progress' ? 'task-progress' : 'task-open'} />
          </button>
          <div className="agent-task-copy">
            <strong>{task.title}</strong>
            {task.description ? <span>{task.description}</span> : null}
            <small className="task-metadata"><span>{task.assignee_display_name ?? t('Unassigned', 'Atanmamış')}</span>{task.due_at ? <time dateTime={task.due_at}>{t('Due', 'Bitiş')}: {formatDateTime(task.due_at)}</time> : null}</small>
          </div>
          <span className={`agent-task-status agent-task-status-${task.status}`}>{taskStatusLabel(task.status, language)}</span>
        </article>
      ))}
    </div>
  )
}

export function ChatComposer({ value, onChange, onSubmit, disabled, label, placeholder, context, leading, mentionAutocomplete = false, inputRef, onAdd, addDisabled = false, addLabel, tools }: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  label?: string
  placeholder?: string
  context?: string
  leading?: ReactNode
  mentionAutocomplete?: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
  onAdd?: () => void
  addDisabled?: boolean
  addLabel?: string
  tools?: ReturnType<typeof useAgentControls>
}) {
  const { t } = useLanguage()
  const resolvedLabel = label ?? t('Send a message to Izge', 'İzge’ye mesaj gönder')
  const resolvedPlaceholder = placeholder ?? t('Ask about a decision, file, task, or risk…', 'Bir karar, dosya, görev veya risk hakkında sor…')
  const resolvedContext = context ?? t('Company memory', 'Şirket hafızası')
  const resolvedAddLabel = addLabel ?? t('Add a file or note', 'Dosya veya not ekle')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const localRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const [caret, setCaret] = useState(value.length)
  const mentionOpen = mentionAutocomplete && /(^|\s)@[\p{L}]*$/u.test(value.slice(0, caret))
  const setRef = (element: HTMLTextAreaElement | null) => {
    localRef.current = element
    if (inputRef) inputRef.current = element
  }
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !addRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); addRef.current?.focus() }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [menuOpen])
  const selectMention = () => {
    const element = localRef.current
    const selectionStart = element?.selectionStart ?? caret
    const selectionEnd = element?.selectionEnd ?? selectionStart
    const next = insertIzgeMentionAtCaret(value, selectionStart, selectionEnd)
    pendingCaretRef.current = next.caret
    setCaret(next.caret)
    onChange(next.value)
  }

  useLayoutEffect(() => {
    const nextCaret = pendingCaretRef.current
    const element = localRef.current
    if (nextCaret === null || !element) return
    pendingCaretRef.current = null
    element.focus()
    element.setSelectionRange(nextCaret, nextCaret)
    element.scrollTop = element.scrollHeight
  }, [value, caret])
  const submit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (!disabled && value.trim()) onSubmit()
  }

  return (
    <form className="agent-chat-composer" onSubmit={submit}>
      <div className="agent-composer-input-row">
      {tools ? <AgentToolChips controls={tools} disabled={disabled} /> : null}
      <label>
        <span className="sr-only">{resolvedLabel}</span>
        <span className="agent-composer-editor">
        <textarea ref={setRef} value={value} onChange={(event) => { setCaret(event.target.selectionStart); onChange(event.target.value) }} onSelect={(event) => setCaret(event.currentTarget.selectionStart)} rows={2} placeholder={resolvedPlaceholder} disabled={disabled} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (mentionOpen && (event.key === 'Enter' || event.key === 'Tab')) {
            event.preventDefault()
            selectMention()
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }} />
        </span>
      </label>
      </div>
      {mentionOpen ? <div className="agent-mention-menu" role="listbox" aria-label={t('Mention', 'Bahset')}><button type="button" role="option" aria-selected="true" onClick={selectMention}><span className="agent-avatar"><IzgeLogo /></span><span><strong>@izge</strong><small>{t('Ask company memory', 'Şirket hafızasına sor')}</small></span></button></div> : null}
      <div className="agent-prompt-controls">
        <button ref={addRef} type="button" className="agent-prompt-add" onClick={() => setMenuOpen((open) => !open)} disabled={disabled} aria-expanded={menuOpen} aria-haspopup="menu" aria-label={t('Add files and tools', 'Dosya ve araç ekle')} title={t('Add files and tools', 'Dosya ve araç ekle')}><ButtonIcon name="add" /></button>
        {leading}
        {menuOpen ? <div ref={menuRef} className="agent-add-menu" role="menu" aria-label={t('Add', 'Ekle')}>
          <strong>{t('Add', 'Ekle')}</strong>
          <button type="button" role="menuitem" disabled={!onAdd || addDisabled} onClick={() => { setMenuOpen(false); onAdd?.() }}><ButtonIcon name="attach" /><span>{resolvedAddLabel}<small>{t('Upload from computer', 'Bilgisayardan yükle')}</small></span></button>
          {tools ? <AgentToolMenu controls={tools} disabled={disabled} onSelect={() => { setMenuOpen(false); localRef.current?.focus() }} /> : null}
        </div> : null}
        <span className="agent-prompt-context"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" /></svg>{resolvedContext}</span>
        <button type="submit" className="primary-button" disabled={disabled || !value.trim()} aria-label={t('Send', 'Gönder')}><ButtonIcon name="send" /></button>
      </div>
    </form>
  )
}
