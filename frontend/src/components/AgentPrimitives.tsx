import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { insertIzgeMentionAtCaret, tokenizeAgentText } from '../lib/agentText'
import { useLanguage } from '../lib/i18n'
import { formatSystemText } from '../lib/format'
import { nextTaskStatus, taskStatusAction, taskStatusLabel } from '../lib/taskStatus'
import type { AgentRunStageRead, AgentSourceRead, WorkTaskRead, WorkTaskStatus } from '../lib/types'
import { ButtonIcon } from './ButtonIcon'
import { SourcePreviewButton } from './SourcePreviewButton'

/* Adapted from beautiful-ui primitives at 44a274e598395ab61e7c96c26fda2758780253b7.
 * Copyright (c) 2026 Shane Levine, MIT License. Animations are driven by real API state. */

export function LoadingState({ label }: { label: string }) {
  const { t } = useLanguage()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 100)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="agent-loading" role="status">
      <span className="agent-loading-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ animationDelay: `${(index % 3 + Math.abs(Math.floor(index / 3) - 1)) * 90}ms` }} />)}
      </span>
      <span className="agent-shimmer">{label}</span>
      <span className="agent-elapsed">{(elapsed / 1000).toFixed(1)} {t('s', 'sn')}</span>
    </div>
  )
}

export function ThinkingState({ stages, status }: { stages: AgentRunStageRead[]; status: 'queued' | 'running' | 'completed' | 'failed' }) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(true)
  const working = status === 'queued' || status === 'running'

  return (
    <div className="agent-thinking">
      <button type="button" className="agent-thinking-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span aria-hidden="true">✦</span>
        <span className={working ? 'agent-shimmer' : ''}>{working ? t('Izge is thinking', 'İzge düşünüyor') : status === 'completed' ? t('Work completed', 'Çalışma tamamlandı') : t('Work failed', 'Çalışma başarısız')}</span>
        <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded ? (
        <ol className="agent-stage-list">
          {stages.map((stage) => (
            <li key={`${stage.sequence}-${stage.key}`} data-status={stage.status}>
              <span aria-hidden="true">{stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '×' : '•'}</span>
              <span>{formatSystemText(stage.label)}</span>
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
    if (token.kind === 'bold') return <strong key={index}><InlineText text={token.value} sources={sources} /></strong>
    if (token.kind === 'mention') return <mark className="izge-mention" key={index}>{token.value}</mark>
    if (token.kind === 'source') {
      const source = sources[token.sourceIndex]
      return source ? <SourcePreviewButton key={index} artifactId={source.artifact_id} title={source.title} className="agent-inline-source">{source.title}</SourcePreviewButton> : token.value
    }
    return token.value
  })
}

function ComposerText({ text }: { text: string }) {
  return text.split(/(@[iİı]zge\b)/giu).map((part, index) => /^@[iİı]zge$/iu.test(part) ? <mark className="izge-mention" key={index}>{part}</mark> : part)
}

export function AgentText({ text, sources = [] }: { text: string; sources?: AgentSourceRead[] }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flushList = () => {
    if (!list.length) return
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((line, index) => <li key={index}><InlineText text={line} sources={sources} /></li>)}</ul>)
    list = []
  }
  for (const line of text.split('\n')) {
    const item = line.match(/^\s*[-*]\s+(.+)$/)
    if (item) { list.push(item[1]); continue }
    flushList()
    if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}><InlineText text={line} sources={sources} /></p>)
  }
  flushList()
  return <>{blocks}</>
}

export function AgentAnswer({ text, sources = [], followUps = [], onFollowUp, active = false }: { text: string; sources?: AgentSourceRead[]; followUps?: string[]; onFollowUp?: (question: string) => void; active?: boolean }) {
  const { t } = useLanguage()
  return <div className="agent-answer">
    <div className="agent-answer-copy"><AgentText text={text} sources={sources} />{active ? <span className="agent-streaming-cursor" aria-label={t('Writing response', 'Yanıt yazılıyor')} /> : null}</div>
    {sources.length ? <div className="agent-context-cards" aria-label={t('Sources used in the response', 'Yanıtta kullanılan kaynaklar')}>{sources.map((source) => <article className="agent-context-card" key={`${source.artifact_id}-${source.chunk_id ?? ''}`}><strong>{source.title}</strong><p>{source.quote}</p><SourcePreviewButton artifactId={source.artifact_id} title={source.title} className="review-context-chip"><ButtonIcon name="open-source" />{t('Open source', 'Kaynağı aç')}</SourcePreviewButton></article>)}</div> : null}
    {followUps.length && onFollowUp ? <div className="agent-follow-ups"><strong>{t('Would you like to continue?', 'Devam etmek ister misiniz?')}</strong>{followUps.map((question) => <button type="button" key={question} onClick={() => onFollowUp(question)}>{question}</button>)}</div> : null}
  </div>
}

export function TaskRows({ tasks, onStatusChange }: { tasks: WorkTaskRead[]; onStatusChange: (task: WorkTaskRead, status: WorkTaskStatus) => Promise<void> }) {
  const { language } = useLanguage()
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
          </div>
          <span className={`agent-task-status agent-task-status-${task.status}`}>{taskStatusLabel(task.status, language)}</span>
        </article>
      ))}
    </div>
  )
}

export function ChatComposer({ value, onChange, onSubmit, disabled, label, placeholder, context, leading, mentionAutocomplete = false, inputRef, onAdd, addDisabled = false, addLabel }: {
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
}) {
  const { t } = useLanguage()
  const resolvedLabel = label ?? t('Send a message to Izge', 'İzge’ye mesaj gönder')
  const resolvedPlaceholder = placeholder ?? t('Ask about a decision, file, task, or risk…', 'Bir karar, dosya, görev veya risk hakkında sor…')
  const resolvedContext = context ?? t('Company memory', 'Şirket hafızası')
  const resolvedAddLabel = addLabel ?? t('Add a file or note', 'Dosya veya not ekle')
  const localRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const [caret, setCaret] = useState(value.length)
  const mentionOpen = mentionAutocomplete && /(^|\s)@[\p{L}]*$/u.test(value.slice(0, caret))
  const setRef = (element: HTMLTextAreaElement | null) => {
    localRef.current = element
    if (inputRef) inputRef.current = element
  }
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
    if (overlayRef.current) overlayRef.current.scrollTop = element.scrollTop
  }, [value, caret])
  const submit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (!disabled && value.trim()) onSubmit()
  }

  return (
    <form className="agent-chat-composer" onSubmit={submit}>
      {leading}
      <label>
        <span className="sr-only">{resolvedLabel}</span>
        <span className={mentionAutocomplete ? 'agent-composer-editor agent-composer-editor-mentions' : 'agent-composer-editor'}>
        {mentionAutocomplete ? <div ref={overlayRef} className="agent-composer-highlight" aria-hidden="true"><ComposerText text={value || ' '} /></div> : null}
        <textarea ref={setRef} value={value} onChange={(event) => { setCaret(event.target.selectionStart); onChange(event.target.value) }} onSelect={(event) => setCaret(event.currentTarget.selectionStart)} rows={2} placeholder={resolvedPlaceholder} disabled={disabled} onScroll={(event) => { if (overlayRef.current) overlayRef.current.scrollTop = event.currentTarget.scrollTop }} onKeyDown={(event) => {
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
      {mentionOpen ? <div className="agent-mention-menu" role="listbox" aria-label={t('Mention', 'Bahset')}><button type="button" role="option" aria-selected="true" onClick={selectMention}><span className="agent-avatar">İZ</span><span><strong>@izge</strong><small>{t('Ask company memory', 'Şirket hafızasına sor')}</small></span></button></div> : null}
      <div className="agent-prompt-controls">
        {onAdd
          ? <button type="button" className="agent-prompt-add" onClick={onAdd} disabled={addDisabled} aria-label={resolvedAddLabel} title={resolvedAddLabel}><ButtonIcon name="attach" /></button>
          : <Link className="agent-prompt-add" to="/memory" aria-label={resolvedAddLabel} title={resolvedAddLabel}><ButtonIcon name="attach" /></Link>}
        <span className="agent-prompt-context"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" /></svg>{resolvedContext}</span>
        <span className="agent-prompt-hint">Shift + Enter · {t('New line', 'Yeni satır')}</span>
        <button type="submit" className="primary-button" disabled={disabled || !value.trim()} aria-label={t('Send', 'Gönder')}><ButtonIcon name="send" /></button>
      </div>
    </form>
  )
}
