import { useEffect, useState, type FormEventHandler, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AgentRunStageRead, WorkTaskRead, WorkTaskStatus } from '../lib/types'

/* Adapted from beautiful-ui primitives at 44a274e598395ab61e7c96c26fda2758780253b7.
 * Copyright (c) 2026 Shane Levine, MIT License. Animations are driven by real API state. */

export function LoadingState({ label }: { label: string }) {
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
      <span className="agent-elapsed">{(elapsed / 1000).toFixed(1)} sn</span>
    </div>
  )
}

export function ThinkingState({ stages, status }: { stages: AgentRunStageRead[]; status: 'queued' | 'running' | 'completed' | 'failed' }) {
  const [expanded, setExpanded] = useState(true)
  const working = status === 'queued' || status === 'running'

  return (
    <div className="agent-thinking">
      <button type="button" className="agent-thinking-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span aria-hidden="true">✦</span>
        <span className={working ? 'agent-shimmer' : ''}>{working ? 'İzge çalışıyor' : status === 'completed' ? 'Çalışma tamamlandı' : 'Çalışma başarısız'}</span>
        <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded ? (
        <ol className="agent-stage-list">
          {stages.map((stage) => (
            <li key={`${stage.sequence}-${stage.key}`} data-status={stage.status}>
              <span aria-hidden="true">{stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '×' : '•'}</span>
              <span>{stage.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

export function StreamingText({ children, active }: { children: string; active: boolean }) {
  return <p className="agent-streaming-text">{children}{active ? <span className="agent-streaming-cursor" aria-label="Yanıt yazılıyor" /> : null}</p>
}

const taskStatusLabel: Record<WorkTaskStatus, string> = {
  open: 'Açık',
  in_progress: 'Devam ediyor',
  done: 'Tamamlandı',
}

export function TaskRows({ tasks, onStatusChange }: { tasks: WorkTaskRead[]; onStatusChange: (task: WorkTaskRead, status: WorkTaskStatus) => void }) {
  return (
    <div className="agent-task-rows">
      {tasks.map((task) => (
        <article key={task.task_id} className="agent-task-row">
          <button
            type="button"
            className="agent-task-check"
            aria-label={task.status === 'done' ? `${task.title} görevini yeniden aç` : `${task.title} görevini tamamla`}
            onClick={() => onStatusChange(task, task.status === 'done' ? 'open' : 'done')}
          >
            {task.status === 'done' ? '✓' : task.status === 'in_progress' ? '◐' : '○'}
          </button>
          <div className="agent-task-copy">
            <strong>{task.title}</strong>
            {task.description ? <span>{task.description}</span> : null}
          </div>
          <span className={`agent-task-status agent-task-status-${task.status}`}>{taskStatusLabel[task.status]}</span>
        </article>
      ))}
    </div>
  )
}

export function ChatComposer({ value, onChange, onSubmit, disabled, label = 'İzge’ye mesaj gönder', placeholder = 'Bir karar, dosya, görev veya risk hakkında sor…', context = 'Şirket hafızası', leading }: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  label?: string
  placeholder?: string
  context?: string
  leading?: ReactNode
}) {
  const submit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (!disabled && value.trim()) onSubmit()
  }

  return (
    <form className="agent-chat-composer" onSubmit={submit}>
      {leading}
      <label>
        <span className="sr-only">{label}</span>
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={2} placeholder={placeholder} disabled={disabled} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }} />
      </label>
      <div className="agent-prompt-controls">
        <Link className="agent-prompt-add" to="/memory" aria-label="Dosya veya not ekle" title="Dosya veya not ekle">+</Link>
        <span className="agent-prompt-context"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" /></svg>{context}</span>
        <span className="agent-prompt-hint">Shift + Enter · Yeni satır</span>
        <button type="submit" className="primary-button" disabled={disabled || !value.trim()} aria-label="Gönder"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7" /></svg></button>
      </div>
    </form>
  )
}
