import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { SignalDetail } from '../lib/types'

function signalCardClass(signalType: string): string {
  if (signalType === 'contradiction') {
    return 'panel-subtle stack-sm critical-card'
  }
  if (signalType === 'assumption_drift') {
    return 'panel-subtle stack-sm drift-card'
  }
  if (signalType === 'next_action') {
    return 'panel-subtle stack-sm action-card'
  }
  if (signalType === 'continuity_overlap') {
    return 'panel-subtle stack-sm action-card'
  }
  return 'panel-subtle stack-sm'
}

export function SignalDetailPage() {
  const { signalId = '' } = useParams()
  const { session } = useAuth()
  const [detail, setDetail] = useState<SignalDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !signalId) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const payload = await api.getSignal(session.token, signalId)
        if (!cancelled) {
          setDetail(payload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load signal detail.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [session?.token, signalId])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Persisted intelligence signal"
        title="Inspect why the system thinks this matters"
        description="Signal detail keeps artifact impact, memory support, graph classification, and guidance boundaries visible instead of hiding intelligence behind a chat response."
        actions={
          <Link className="secondary-button" to="/graph">
            Back to graph
          </Link>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {isLoading ? <p className="muted-copy">Loading persisted signal…</p> : null}
      {!isLoading && !detail && !error ? (
        <EmptyState title="Signal not available" description="The requested signal is not visible in your current permission scope." />
      ) : null}

      {detail ? (
        <>
          <Panel title={detail.title} description={`${formatLabel(detail.signal_type)} · topic ${detail.related_topic}`} aside={<StatusBadge value={detail.status} />}>
            <div className="stack-lg">
              <div className="detail-grid">
                <article className={signalCardClass(detail.signal_type)}>
                  <p className="section-label">Signal summary</p>
                  <p className="table-primary">{detail.summary}</p>
                  <p className="muted-copy">{detail.grounded_reasoning}</p>
                </article>
                <article className="panel-subtle detail-card">
                  <p className="section-label">Urgency</p>
                  <p className="table-primary">{formatPercent(detail.urgency_score)}</p>
                  <p className="table-secondary">Uncertainty {formatPercent(detail.uncertainty_score)}</p>
                </article>
              </div>

              <dl className="meta-list">
                <div>
                  <dt>Source artifact</dt>
                  <dd>{detail.source_artifact_title ?? detail.source_artifact_id ?? 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Signal ID</dt>
                  <dd>{detail.signal_id}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(detail.created_at)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDateTime(detail.updated_at)}</dd>
                </div>
              </dl>

              {detail.recommended_action ? (
                <div className="panel-subtle stack-sm action-card">
                  <p className="section-label">Recommended next action</p>
                  <p className="evidence-block">{detail.recommended_action}</p>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel title="Explicit intelligence path" description="The MVP path is central-backend inference/extraction, deterministic memory/graph comparison, persisted signal, then inspectable guidance. No employee-local model participation is assumed here.">
            <div className="stack-md">
              {detail.intelligence_path.map((step, index) => (
                <article key={`${step.step_kind}-${index}`} className="panel-subtle stack-sm">
                  <div className="timeline-card-head">
                    <p className="table-primary">{index + 1}. {step.title}</p>
                    <p className="table-secondary">{formatLabel(step.step_kind)}</p>
                  </div>
                  <p className="muted-copy">{step.description}</p>
                  {step.supporting_memory_objects.length > 0 ? (
                    <p className="table-secondary">
                      Memory: {step.supporting_memory_objects.map((memory) => `${formatLabel(memory.memory_type)} · ${memory.title_or_label}`).join(' | ')}
                    </p>
                  ) : null}
                  {step.supporting_evidence.length > 0 ? (
                    <p className="table-secondary">
                      Evidence: {step.supporting_evidence.map((evidence) => `${evidence.artifact_title} (${formatLabel(evidence.artifact_review_status)})`).join(' | ')}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </Panel>

          <div className="two-column-layout">
            <Panel title="Supporting evidence" description="Evidence excerpts remain permission-filtered and visible as the basis for signal trust.">
              {detail.supporting_evidence.length === 0 ? (
                <EmptyState title="No visible evidence excerpts" description="This signal has no evidence excerpts visible in your current scope." />
              ) : (
                <div className="stack-sm">
                  {detail.supporting_evidence.map((evidence, index) => (
                    <article key={`${evidence.artifact_id}-${evidence.chunk_id ?? 'root'}-${index}`} className="panel-subtle stack-sm">
                      <div className="timeline-card-head">
                        <p className="table-primary">{evidence.artifact_title}</p>
                        <StatusBadge value={formatLabel(evidence.artifact_review_status)} />
                      </div>
                      <p className="table-secondary">{evidence.evidence_kind === 'graph' ? 'Graph-linked evidence' : 'Search fallback evidence'} · chunk {evidence.chunk_id ?? 'root'}</p>
                      <p className="evidence-block">{evidence.excerpt}</p>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Related memory objects" description="Structured memory support makes the signal more than artifact search.">
              {detail.supporting_memory_objects.length === 0 ? (
                <EmptyState title="No visible memory support" description="This signal does not expose related memory objects in the current permission scope." />
              ) : (
                <div className="stack-sm">
                  {detail.supporting_memory_objects.map((memory) => (
                    <Link
                      key={`${memory.memory_type}-${memory.memory_id}`}
                      className="record-link panel-subtle"
                      to={`/memory/${memory.memory_type}/${memory.memory_id}`}
                    >
                      <div>
                        <p className="table-primary">{memory.title_or_label}</p>
                        <p className="table-secondary">
                          {formatLabel(memory.memory_type)} · topic {memory.topic_key} · source {formatLabel(memory.source_artifact_review_status)}
                        </p>
                        {memory.status ? <p className="table-secondary">Status {formatLabel(memory.status)}</p> : null}
                      </div>
                      <span className="table-secondary">Confidence {formatPercent(memory.confidence_score)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Persisted signal payload" description="Raw signal payload is shown as an audit surface for demo and implementation verification, not as the primary product reading.">
            <div className="panel-subtle stack-sm">
              <p className="section-label">Payload keys</p>
              <p className="table-secondary">{Object.keys(detail.payload_json).join(', ') || 'No payload keys recorded.'}</p>
              <pre className="metadata-code">{JSON.stringify(detail.payload_json, null, 2)}</pre>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  )
}
