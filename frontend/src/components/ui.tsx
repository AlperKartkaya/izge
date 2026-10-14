import type { PropsWithChildren, ReactNode } from 'react'
import { useLanguage } from '../lib/i18n'
import { formatStatus } from '../lib/format'
import './page-states.css'

export function PageIntro({ title, description, actions }: { title: string; description: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="page-intro">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions ? <div className="page-intro-actions">{actions}</div> : null}
    </div>
  )
}

export function Panel({ title, description, children, aside }: PropsWithChildren<{ title: string; description?: string; aside?: ReactNode }>) {
  return (
    <section className="panel section-panel">
      <div className="section-head">
        <div>
          <h2 className="section-title">{title}</h2>
          {description ? <p className="section-description">{description}</p> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <article className="metric-card" data-text-value={typeof value === 'string' && value.length > 12 ? 'true' : undefined}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {detail ? <p className="metric-detail">{detail}</p> : null}
    </article>
  )
}

export function StatusBadge({ value, status = value }: { value: string; status?: string }) {
  useLanguage()
  const normalizedValue = status.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return (
    <span className="status-badge" data-status={normalizedValue}>
      {formatStatus(value)}
    </span>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state page-empty-state">
      <p className="empty-title">{title}</p>
      <p className="empty-description">{description}</p>
    </div>
  )
}

export function Callout({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'neutral' | 'warning' }>) {
  return <div role={tone === 'warning' ? 'alert' : 'status'} className={tone === 'warning' ? 'callout callout-warning' : 'callout'}>{children}</div>
}
