import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { QueryResult } from '../lib/types'

function readRecordField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : 'Unavailable'
}

function readStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function QueryResultPage() {
  const { queryRunId = '' } = useParams()
  const location = useLocation()
  const { session } = useAuth()
  const routedResult = (location.state as { result?: QueryResult } | null)?.result
  const [result, setResult] = useState<QueryResult | null>(routedResult ?? null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(!routedResult)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !queryRunId || routedResult?.query_run_id === queryRunId) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const nextResult = await api.getQueryResult(session.token, queryRunId)
        if (!cancelled) {
          setResult(nextResult)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load query result.')
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
  }, [queryRunId, routedResult, session?.token])

  const activeResult = routedResult?.query_run_id === queryRunId ? routedResult : result

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Query result"
        title="Evidence-backed response"
        description="Result sections stay fixed so historical claims, tensions, drift, and uncertainty remain inspectable instead of collapsing into a freeform chat reply."
        actions={
          <Link className="secondary-button" to="/query">
            Run another query
          </Link>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {activeResult?.permissions_limited ? (
        <Callout tone="warning">Some relevant evidence may be unavailable due to artifact permissions.</Callout>
      ) : null}

      {isLoading ? <p className="muted-copy">Loading query result…</p> : null}

      {!isLoading && !activeResult ? (
        <EmptyState title="Result not available" description="Submit a new query or verify that the requested query run ID still exists." />
      ) : null}

      {activeResult ? (
        <>
          <Panel title="Result overview" description={activeResult.query_text} aside={<StatusBadge value={activeResult.status} />}>
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">Query class</p>
                <p className="table-primary">{activeResult.query_class}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Generated</p>
                <p className="table-primary">{formatDateTime(activeResult.created_at)}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Support coverage</p>
                <p className="table-primary">{activeResult.supporting_nodes.length + activeResult.supporting_evidence.length} linked items</p>
              </article>
            </div>
          </Panel>

          <div className="result-grid">
            <Panel title="Direct Answer" description="Primary response text returned by the backend.">
              <p className="evidence-block">{activeResult.answer_text}</p>
            </Panel>

            <Panel title="Why This Answer" description="How the system justified the answer structure.">
              <p className="muted-copy">{activeResult.why_this_answer}</p>
            </Panel>

            <Panel title="Supporting Evidence" description="Permitted evidence excerpts surfaced in the response.">
              {activeResult.supporting_evidence.length === 0 ? (
                <EmptyState title="No evidence references" description="The backend did not return any visible evidence excerpts for this query." />
              ) : (
                <div className="stack-md">
                  {activeResult.supporting_evidence.map((item) => (
                    <article key={`${item.artifact_id}-${item.chunk_id ?? 'root'}`} className="panel-subtle stack-sm">
                      <p className="table-primary">{item.artifact_title}</p>
                      <p className="table-secondary">Artifact {item.artifact_id} · {item.evidence_kind === 'graph' ? 'Graph-linked evidence' : 'Search fallback'}</p>
                      <p className="evidence-block">{item.excerpt}</p>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Related Decisions and Memory Objects" description="Structured memory references included with the response.">
              {activeResult.supporting_nodes.length === 0 ? (
                <EmptyState title="No supporting memory objects" description="No linked memory objects are currently visible in scope." />
              ) : (
                <div className="stack-sm">
                  {activeResult.supporting_nodes.map((item) => (
                    <Link
                      key={`${item.memory_type}-${item.memory_id}`}
                      className="record-link panel-subtle"
                      to={`/memory/${item.memory_type}/${item.memory_id}`}
                    >
                      <div>
                        <p className="table-primary">{item.title_or_label}</p>
                        <p className="table-secondary">{item.memory_type} · {item.memory_id} · topic {item.topic_key}</p>
                      </div>
                      <span className="table-secondary">Confidence {formatPercent(item.confidence_score)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Contradictions or Tensions" description="Conflict signals preserved as a dedicated section.">
              {activeResult.contradictions.length === 0 ? (
                <EmptyState title="No contradictions returned" description="This result did not surface contradiction edges in the current permitted scope." />
              ) : (
                <div className="stack-sm">
                  {activeResult.contradictions.map((item) => (
                    <article key={readRecordField(item, 'edge_id')} className="panel-subtle stack-sm">
                      <p className="table-primary">{readRecordField(item, 'from_title')} → {readRecordField(item, 'to_title')}</p>
                      <p className="table-secondary">{readRecordField(item, 'from_type')} {readRecordField(item, 'relation_label')} {readRecordField(item, 'to_type')} · topic {readRecordField(item, 'topic_key')}</p>
                      <p className="muted-copy">{readRecordField(item, 'evidence_span')}</p>
                      <p className="table-secondary">{readRecordField(item, 'evidence_provenance')}</p>
                      {readStringArray(item, 'ranking_basis').length > 0 ? <p className="table-secondary">Ranked for: {readStringArray(item, 'ranking_basis').join(', ')}</p> : null}
                      {readRecordField(item, 'uncertainty_note') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'uncertainty_note')}</p> : null}
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Assumption Drift" description="Assumptions flagged as stale, weakened, or reversed.">
              {activeResult.stale_assumptions.length === 0 ? (
                <EmptyState title="No drift returned" description="No visible stale assumptions were attached to this response." />
              ) : (
                <div className="stack-sm">
                  {activeResult.stale_assumptions.map((item) => (
                    <article key={readRecordField(item, 'assumption_id')} className="panel-subtle stack-sm">
                      <p className="table-primary">{readRecordField(item, 'title_or_label')}</p>
                      <p className="table-secondary">Status: {formatLabel(readRecordField(item, 'status'))} · topic {readRecordField(item, 'topic_key')}</p>
                      <p className="muted-copy">{readRecordField(item, 'validity_notes')}</p>
                      {readRecordField(item, 'supporting_signal_title') !== 'Unavailable' ? <p className="table-secondary">Compared with: {readRecordField(item, 'supporting_signal_type')} · {readRecordField(item, 'supporting_signal_title')}</p> : null}
                      {readRecordField(item, 'evidence_span') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'evidence_span')}</p> : null}
                      {readRecordField(item, 'evidence_provenance') !== 'Unavailable' ? <p className="table-secondary">{readRecordField(item, 'evidence_provenance')}</p> : null}
                      {readStringArray(item, 'ranking_basis').length > 0 ? <p className="table-secondary">Ranked for: {readStringArray(item, 'ranking_basis').join(', ')}</p> : null}
                      {readRecordField(item, 'uncertainty_note') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'uncertainty_note')}</p> : null}
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Recommended Next Actions" description="Action guidance remains explicit rather than implied.">
              {activeResult.recommended_next_actions.length === 0 ? (
                <EmptyState title="No next actions returned" description="This result did not require recommendation output from the current analysis path." />
              ) : (
                <ul className="bullet-list">
                  {activeResult.recommended_next_actions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Uncertainty or Missing Context" description="Required caveats and limits surfaced alongside the answer.">
              <ul className="bullet-list">
                {activeResult.uncertainty_notes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {activeResult.permissions_limited ? <li>Some relevant evidence may be hidden by artifact permissions.</li> : null}
              </ul>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  )
}
