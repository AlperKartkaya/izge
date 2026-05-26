import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { QueryResult, QueryTraceRead, QueryTraceStepRead } from '../lib/types'

function readRecordField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : 'Unavailable'
}

function readStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readRecordArray(record: Record<string, unknown>, field: string): Array<Record<string, unknown>> {
  const value = record[field]
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : []
}

function readRecord(record: Record<string, unknown>, field: string): Record<string, unknown> | null {
  const value = record[field]
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stepTitle(stepKind: string): string {
  switch (stepKind) {
    case 'route_decision':
      return 'Grounding'
    case 'seed_selection':
      return 'Seed selection'
    case 'bounded_orchestration':
      return 'Bounded orchestration'
    case 'context_assembly':
      return 'Typed context packet'
    case 'provenance_verification':
      return 'Provenance verification'
    case 'evidence_selection':
      return 'Evidence selection'
    case 'answer_composition':
      return 'Synthesis'
    case 'uncertainty_note':
      return 'Uncertainty'
    default:
      return stepKind.replace(/_/g, ' ')
  }
}

function modePlainEnglish(queryClass: string): string {
  switch (queryClass) {
    case 'Decision lineage':
      return 'Reconstruct the decision timeline before making any recommendation.'
    case 'Contradiction analysis':
      return 'Compare later claims against earlier commitments and surface the collision.'
    case 'Assumption drift':
      return 'Find assumptions whose operating basis weakened, reversed, or went stale.'
    case 'Next-action guidance':
      return 'Promote an action only after conflict, drift, commitments, and evidence are visible.'
    default:
      return 'Route the question into a bounded institutional-memory operation.'
  }
}

function firstAvailable(...values: string[]): string {
  return values.find((value) => value && value !== 'Unavailable') ?? 'No explicit signal returned.'
}

function findTracePayload(trace: QueryTraceRead | null, stepKind: string): Record<string, unknown> | null {
  const step = trace?.steps.find((item) => item.step_kind === stepKind)
  return step?.payload ?? null
}

function routeSourceLabel(routeSource: string): string {
  switch (routeSource) {
    case 'local_llm_intent':
      return 'Local LLM intent routing'
    case 'keyword_after_llm_fallback':
      return 'Keyword routing after LLM fallback'
    case 'keyword':
      return 'Deterministic keyword routing'
    default:
      return formatLabel(routeSource)
  }
}

function synthesisStatusLabel(status: string): string {
  switch (status) {
    case 'applied':
      return 'LLM-assisted answer wording'
    case 'fallback':
      return 'Deterministic answer after LLM fallback'
    case 'disabled':
      return 'Deterministic answer only'
    default:
      return formatLabel(status)
  }
}

export function QueryResultPage() {
  const { queryRunId = '' } = useParams()
  const location = useLocation()
  const { session } = useAuth()
  const routedResult = (location.state as { result?: QueryResult } | null)?.result
  const [result, setResult] = useState<QueryResult | null>(routedResult ?? null)
  const [trace, setTrace] = useState<QueryTraceRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(!routedResult)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !queryRunId) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const [nextResult, nextTrace] = await Promise.all([
          routedResult?.query_run_id === queryRunId ? Promise.resolve(routedResult) : api.getQueryResult(session.token, queryRunId),
          api.getQueryTrace(session.token, queryRunId),
        ])
        if (!cancelled) {
          setResult(nextResult)
          setTrace(nextTrace)
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
  const topContradiction = activeResult?.contradictions[0]
  const topDrift = activeResult?.stale_assumptions[0]
  const topAction = activeResult?.recommended_next_actions[0]
  const graphEvidenceCount = activeResult?.supporting_evidence.filter((item) => item.evidence_kind === 'graph').length ?? 0
  const routePayload = findTracePayload(trace, 'route_decision')
  const answerCompositionPayload = findTracePayload(trace, 'answer_composition')
  const answerSynthesis = answerCompositionPayload ? readRecord(answerCompositionPayload, 'answer_synthesis') : null
  const synthesisStatus = answerSynthesis ? readRecordField(answerSynthesis, 'status') : 'Unavailable'
  const routeSource = routePayload ? readRecordField(routePayload, 'route_source') : 'Unavailable'
  const llmIntent = routePayload ? readRecord(routePayload, 'llm_intent') : null
  const llmIntentStatus = llmIntent ? readRecordField(llmIntent, 'status') : 'Unavailable'
  const llmApplied = routeSource === 'local_llm_intent' || synthesisStatus === 'applied'
  const llmTopicTerms = readStringArray(routePayload ?? {}, 'topic_terms')
  const llmCitedEvidenceCount = readStringArray(answerSynthesis ?? {}, 'cited_evidence_ids').length
  const llmCitedMemoryCount = readStringArray(answerSynthesis ?? {}, 'cited_memory_ids').length

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Evidence-backed historical reading"
        title="The answer is only credible because the record is visible"
        description="Result sections stay fixed so remembered decisions, contradictions, drift, next actions, and uncertainty remain inspectable instead of collapsing into a freeform chat reply."
        actions={
          <Link className="secondary-button" to="/query">
            Ask another question
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
                <p className="section-label">Mode</p>
                <p className="table-primary">{activeResult.query_class}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Generated</p>
                <p className="table-primary">{formatDateTime(activeResult.created_at)}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Historical support</p>
                <p className="table-primary">{activeResult.supporting_nodes.length + activeResult.supporting_evidence.length} linked items</p>
              </article>
            </div>
          </Panel>

          <Panel
            title="Local LLM output"
            description="Shows what the private model helped with and the exact answer wording it produced, while deterministic evidence selection remains inspectable."
            aside={<StatusBadge value={llmApplied ? 'LLM applied' : 'Deterministic'} />}
          >
            <article className={synthesisStatus === 'applied' ? 'panel-subtle llm-output-card action-card' : 'panel-subtle llm-output-card'}>
              <div className="timeline-card-head">
                <div>
                  <p className="section-label">LLM-written answer</p>
                  <p className="table-secondary">{synthesisStatusLabel(synthesisStatus)}</p>
                </div>
                <StatusBadge value={synthesisStatus !== 'Unavailable' ? formatLabel(synthesisStatus) : 'Trace loading'} />
              </div>
              <p className="llm-answer-text">{activeResult.answer_text}</p>
              <p className="llm-rationale-text">{activeResult.why_this_answer}</p>
            </article>

            <div className="detail-grid compact-boundary-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">Intent routing</p>
                <p className="table-primary">{routeSource !== 'Unavailable' ? routeSourceLabel(routeSource) : 'Trace loading'}</p>
                <p className="muted-copy">
                  {routeSource === 'local_llm_intent'
                    ? 'The LLM classified the question; deterministic execution kept authority over evidence and reasoning.'
                    : routeSource === 'keyword_after_llm_fallback'
                      ? 'LLM routing was attempted, then deterministic keyword routing carried the query.'
                      : 'Deterministic routing selected the query mode.'}
                </p>
                {llmTopicTerms.length > 0 ? <p className="table-secondary">Terms: {llmTopicTerms.join(', ')}</p> : null}
              </article>

              <article className="panel-subtle detail-card">
                <p className="section-label">Citations accepted</p>
                <p className="table-primary">{llmCitedEvidenceCount} evidence · {llmCitedMemoryCount} memory</p>
                <p className="muted-copy">The LLM can only cite IDs already selected by the deterministic packet.</p>
              </article>

              <article className="panel-subtle detail-card">
                <p className="section-label">Deterministic authority</p>
                <p className="table-primary">{activeResult.supporting_evidence.length} excerpts · {activeResult.supporting_nodes.length} objects</p>
                <p className="muted-copy">Permissions, evidence selection, contradiction/drift checks, and next-action promotion remain backend-controlled.</p>
              </article>
            </div>
          </Panel>

          <details className="reasoning-disclosure panel section-panel">
            <summary>Inference and authority boundary details</summary>
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">Query routing</p>
                <p className="table-primary">{routeSource !== 'Unavailable' ? routeSourceLabel(routeSource) : 'Trace loading'}</p>
                {llmIntentStatus !== 'Unavailable' ? <p className="table-secondary">LLM intent status: {formatLabel(llmIntentStatus)}</p> : null}
              </article>

              <article className={synthesisStatus === 'applied' ? 'panel-subtle detail-card action-card' : 'panel-subtle detail-card'}>
                <p className="section-label">Answer wording</p>
                <p className="table-primary">{synthesisStatus !== 'Unavailable' ? synthesisStatusLabel(synthesisStatus) : 'Trace loading'}</p>
                {readRecordField(answerSynthesis ?? {}, 'confidence_rationale') !== 'Unavailable' ? (
                  <p className="muted-copy">{readRecordField(answerSynthesis ?? {}, 'confidence_rationale')}</p>
                ) : null}
              </article>

              <article className="panel-subtle detail-card">
                <p className="section-label">Evidence authority</p>
                <p className="table-primary">
                  {activeResult.supporting_evidence.length} evidence excerpts · {activeResult.supporting_nodes.length} memory objects
                </p>
                <p className="muted-copy">Permission filtering, evidence selection, contradiction/drift analysis, and next-action generation remain backend-deterministic.</p>
              </article>
            </div>
          </details>

          <Panel
            title="Decision intelligence packet"
            description="Read this as the product's core output: answer, tension, drift, evidence strength, and next move in one inspectable packet."
          >
            <div className="stack-lg">
              <article className="panel-subtle stack-sm action-card">
                <div className="timeline-card-head">
                  <p className="section-label">Direct reading</p>
                  <p className="table-secondary">{modePlainEnglish(activeResult.query_class)}</p>
                </div>
                <p className="evidence-block">{activeResult.answer_text}</p>
                <p className="muted-copy">{activeResult.why_this_answer}</p>
              </article>

              <div className="detail-grid">
                <article className={topContradiction ? 'panel-subtle detail-card critical-card' : 'panel-subtle detail-card'}>
                  <p className="section-label">Contradiction state</p>
                  <p className="table-primary">
                    {topContradiction
                      ? `${readRecordField(topContradiction, 'from_title')} ↔ ${readRecordField(topContradiction, 'to_title')}`
                      : 'No visible contradiction returned'}
                  </p>
                  <p className="muted-copy">
                    {topContradiction
                      ? firstAvailable(readRecordField(topContradiction, 'evidence_provenance'), readRecordField(topContradiction, 'evidence_span'))
                      : 'The answer did not need a conflict edge in the current permitted scope.'}
                  </p>
                </article>
                <article className={topDrift ? 'panel-subtle detail-card drift-card' : 'panel-subtle detail-card'}>
                  <p className="section-label">Assumption drift</p>
                  <p className="table-primary">
                    {topDrift ? `${readRecordField(topDrift, 'title_or_label')} · ${formatLabel(readRecordField(topDrift, 'status'))}` : 'No visible drift returned'}
                  </p>
                  <p className="muted-copy">
                    {topDrift
                      ? firstAvailable(readRecordField(topDrift, 'evidence_provenance'), readRecordField(topDrift, 'validity_notes'))
                      : 'No stale, weakening, or reversed assumption was attached to this answer.'}
                  </p>
                </article>
                <article className="panel-subtle detail-card">
                  <p className="section-label">Evidence strength</p>
                  <p className="table-primary">
                    {activeResult.supporting_evidence.length} evidence excerpts · {graphEvidenceCount} graph-linked
                  </p>
                  <p className="muted-copy">
                    {activeResult.supporting_nodes.length} structured memory objects and {activeResult.related_signals.length} persisted signal links support this review-aware packet.
                  </p>
                </article>
                <article className={topAction ? 'panel-subtle detail-card action-card' : 'panel-subtle detail-card'}>
                  <p className="section-label">Next justified move</p>
                  <p className="table-primary">{topAction ?? 'No next action promoted'}</p>
                  <p className="muted-copy">
                    {topAction
                      ? 'Recommendation is downstream of the visible memory objects, conflict/drift checks, and evidence excerpts.'
                      : 'Izge did not promote a recommendation without enough visible support.'}
                  </p>
                </article>
              </div>
            </div>
          </Panel>

          <div className="result-grid">
            <Panel title="Evidence chain" description="Permitted evidence excerpts surfaced in the response. This is the proof surface, not background citation decoration.">
              {activeResult.supporting_evidence.length === 0 ? (
                <EmptyState title="No evidence references" description="The backend did not return any visible evidence excerpts for this query." />
              ) : (
                <div className="stack-md">
                  {activeResult.supporting_evidence.map((item) => (
                    <article key={`${item.artifact_id}-${item.chunk_id ?? 'root'}`} className="panel-subtle stack-sm">
                      <div className="timeline-card-head">
                        <p className="table-primary">{item.artifact_title}</p>
                        <StatusBadge value={formatLabel(item.artifact_review_status)} />
                      </div>
                      <p className="table-secondary">{item.evidence_kind === 'graph' ? 'Graph-linked evidence' : 'Search fallback evidence'} · chunk {item.chunk_id ?? 'root'}</p>
                      <p className="evidence-block">{item.excerpt}</p>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Related Memory Objects" description="Structured memory references included with the response.">
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
                        <p className="table-secondary">
                          {formatLabel(item.memory_type)} · topic {item.topic_key} · source {formatLabel(item.source_artifact_review_status)}
                        </p>
                        {item.memory_type === 'commitment' ? (
                          <p className="table-secondary">
                            {item.status ? `Status ${formatLabel(item.status)} · ` : ''}
                            {item.owner_label ? `Owner ${item.owner_label} · ` : ''}
                            {item.due_date ? `Due ${formatDate(item.due_date)}` : 'No due date captured'}
                          </p>
                        ) : null}
                      </div>
                      <span className="table-secondary">Confidence {formatPercent(item.confidence_score)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Contradictions / Tensions" description="Conflict signals are preserved as a dedicated section so a later claim visibly collides with the earlier record.">
              {activeResult.contradictions.length === 0 ? (
                <EmptyState title="No contradictions returned" description="This result did not surface contradiction edges in the current permitted scope." />
              ) : (
                <div className="stack-sm">
                  {activeResult.contradictions.map((item) => (
                    <article key={readRecordField(item, 'edge_id')} className="panel-subtle stack-sm critical-card">
                      <p className="table-primary">{readRecordField(item, 'from_title')} → {readRecordField(item, 'to_title')}</p>
                      <p className="table-secondary">{readRecordField(item, 'from_type')} {readRecordField(item, 'relation_label')} {readRecordField(item, 'to_type')} · topic {readRecordField(item, 'topic_key')}</p>
                      <div className="stack-sm">
                        <div className="panel-subtle stack-sm">
                          <p className="section-label">Later claim evidence</p>
                          <p className="table-secondary">{readRecordField(item.from_evidence as Record<string, unknown>, 'artifact_title')}</p>
                          <p className="muted-copy">{readRecordField(item.from_evidence as Record<string, unknown>, 'excerpt')}</p>
                          <p className="table-secondary">{readRecordField(item.from_evidence as Record<string, unknown>, 'provenance')}</p>
                        </div>
                        <div className="panel-subtle stack-sm">
                          <p className="section-label">Earlier claim evidence</p>
                          <p className="table-secondary">{readRecordField(item.to_evidence as Record<string, unknown>, 'artifact_title')}</p>
                          <p className="muted-copy">{readRecordField(item.to_evidence as Record<string, unknown>, 'excerpt')}</p>
                          <p className="table-secondary">{readRecordField(item.to_evidence as Record<string, unknown>, 'provenance')}</p>
                        </div>
                      </div>
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
                    <article key={readRecordField(item, 'assumption_id')} className="panel-subtle stack-sm drift-card">
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

            <Panel title="Recommended Next Actions" description="Action guidance remains explicit, grounded, and downstream of the visible evidence.">
              {activeResult.recommended_next_actions.length === 0 ? (
                <EmptyState title="No next actions returned" description="This result did not require recommendation output from the current analysis path." />
              ) : (
                <ul className="bullet-list action-list">
                  {activeResult.recommended_next_actions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Related persisted signals" description="Query answers link back to durable contradiction, drift, supersession, or next-action records created during ingestion.">
              {activeResult.related_signals.length === 0 ? (
                <EmptyState title="No persisted signal links" description="This query result did not overlap with persisted proactive signals in the current permission scope." />
              ) : (
                <div className="stack-sm">
                  {activeResult.related_signals.map((signal) => (
                    <Link key={signal.signal_id} className="record-link panel-subtle" to={`/signals/${signal.signal_id}`}>
                      <div>
                        <p className="table-primary">{signal.title}</p>
                        <p className="table-secondary">
                          {formatLabel(signal.signal_type)} · {signal.source_artifact_title ?? signal.source_artifact_id ?? 'unknown source'}
                        </p>
                      </div>
                      <span className="table-secondary">Urgency {formatPercent(signal.urgency_score)}</span>
                    </Link>
                  ))}
                </div>
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

            <details className="reasoning-disclosure panel section-panel">
              <summary>Inspectable reasoning path</summary>
              <p className="section-description">Trace details remain available for trust and audit, but stay collapsed so the main answer stays readable during normal use.</p>
              {!trace ? (
                <EmptyState title="Trace not loaded" description="The query result is visible, but the inspectable reasoning path could not be loaded." />
              ) : (
                <div className="stack-md">
                  <article className="panel-subtle stack-sm">
                    <p className="section-label">Route confidence</p>
                    <p className="table-primary">{formatPercent(trace.route_confidence)}</p>
                    <p className="table-secondary">{trace.query_class}</p>
                    {trace.permissions_limited ? <p className="muted-copy">Some trace items may be reduced because artifact permissions hide part of the reasoning path.</p> : null}
                  </article>

                  {trace.steps.map((step: QueryTraceStepRead) => {
                    const payload = step.payload as Record<string, unknown>
                    const supportingNodes = readRecordArray(payload, 'supporting_nodes')
                    const contradictionPairs = readRecordArray(payload, 'contradiction_pairs')
                    const staleAssumptions = readRecordArray(payload, 'stale_assumptions')
                    const supportingEvidence = readRecordArray(payload, 'supporting_evidence')
                    const orchestrationStages = readRecordArray(payload, 'stages')
                    const retrievalRecipe = readRecordArray(payload, 'retrieval_recipe')
                    const selectedMemory = readRecordArray(payload, 'selected_memory')
                    const selectedEvidencePacket = readRecordArray(payload, 'selected_evidence')
                    const evidenceBudget = readRecord(payload, 'evidence_budget')
                    const metrics = readRecord(payload, 'metrics')
                    const verifierChecks = readRecord(payload, 'checks')
                    const sectionCounts = payload.section_counts as Record<string, unknown> | undefined
                    const stepAnswerSynthesis = readRecord(payload, 'answer_synthesis')
                    const stepSynthesisStatus = stepAnswerSynthesis ? readRecordField(stepAnswerSynthesis, 'status') : 'Unavailable'
                    return (
                      <article key={`${step.step_kind}-${step.created_at}`} className="panel-subtle stack-sm">
                        <div className="timeline-card-head">
                          <p className="table-primary">{stepTitle(step.step_kind)}</p>
                          <p className="table-secondary">{formatDateTime(step.created_at)}</p>
                        </div>

                        {readRecordField(payload, 'route_rationale') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(payload, 'route_rationale')}</p> : null}
                        {readRecordField(payload, 'route_source') !== 'Unavailable' ? <p className="table-secondary">Route source: {routeSourceLabel(readRecordField(payload, 'route_source'))}</p> : null}
                        {readStringArray(payload, 'topic_terms').length > 0 ? <p className="table-secondary">Topic terms: {readStringArray(payload, 'topic_terms').join(', ')}</p> : null}
                        {readStringArray(payload, 'secondary_signals').length > 0 ? <p className="table-secondary">Secondary signals: {readStringArray(payload, 'secondary_signals').join(', ')}</p> : null}
                        {readRecordField(payload, 'schema_version') !== 'Unavailable' ? <p className="table-secondary">Trace schema: {readRecordField(payload, 'schema_version')}</p> : null}
                        {readRecordField(payload, 'context_packet_id') !== 'Unavailable' ? <p className="table-secondary">Context packet: {readRecordField(payload, 'context_packet_id')}</p> : null}
                        {readRecordField(payload, 'verifier_status') !== 'Unavailable' ? <p className="table-secondary">Verifier status: {formatLabel(readRecordField(payload, 'verifier_status'))}</p> : null}

                        {orchestrationStages.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">Bounded stage plan</p>
                            {orchestrationStages.map((item) => (
                              <article key={readRecordField(item, 'stage_key')} className="panel-subtle stack-sm">
                                <div className="timeline-card-head">
                                  <p className="table-secondary">{formatLabel(readRecordField(item, 'stage_key'))}</p>
                                  <StatusBadge value={formatLabel(readRecordField(item, 'status'))} />
                                </div>
                                <p className="muted-copy">{readRecordField(item, 'reason')}</p>
                                <p className="table-secondary">Authority: {formatLabel(readRecordField(item, 'authority_level'))} · Outputs: {String(item.output_count ?? 0)}</p>
                              </article>
                            ))}
                          </div>
                        ) : null}

                        {retrievalRecipe.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">Retrieval recipe</p>
                            {retrievalRecipe.map((item) => (
                              <p key={readRecordField(item, 'stage')} className="table-secondary">
                                {formatLabel(readRecordField(item, 'stage'))}: {String(item.selected_count ?? 0)} / {String(item.candidate_count ?? 0)} selected · omitted {String(item.omitted_count ?? 0)}
                              </p>
                            ))}
                            {evidenceBudget ? (
                              <p className="table-secondary">
                                Evidence budget: {String(evidenceBudget.selected_evidence_count ?? 0)} / {String(evidenceBudget.max_selected_evidence ?? 0)} selected · {evidenceBudget.within_budget === true ? 'within budget' : 'outside budget'}
                              </p>
                            ) : null}
                            {metrics ? (
                              <p className="table-secondary">
                                Trace payload: {String(metrics.trace_payload_bytes ?? 0)} bytes · assembly {String(metrics.context_assembly_ms ?? 0)} ms
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {selectedMemory.length > 0 || selectedEvidencePacket.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">Typed packet contents</p>
                            {selectedMemory.length > 0 ? <p className="table-secondary">Memory objects: {selectedMemory.map((item) => readRecordField(item, 'title_or_label')).join(', ')}</p> : null}
                            {selectedEvidencePacket.length > 0 ? (
                              <p className="table-secondary">
                                Evidence IDs: {selectedEvidencePacket.map((item) => firstAvailable(readRecordField(item, 'chunk_id'), readRecordField(item, 'artifact_id'))).join(', ')}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {verifierChecks ? (
                          <div className="stack-sm">
                            <p className="section-label">Verifier checks</p>
                            <p className="table-secondary">Status: {formatLabel(readRecordField(payload, 'status'))}</p>
                            <p className="table-secondary">
                              {Object.entries(verifierChecks)
                                .map(([key, value]) => `${formatLabel(key)}: ${value === true ? 'pass' : 'check'}`)
                                .join(' · ')}
                            </p>
                            {readRecordField(payload, 'authority_boundary') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(payload, 'authority_boundary')}</p> : null}
                          </div>
                        ) : null}

                        {supportingNodes.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">Selected memory seeds</p>
                            {supportingNodes.map((item) => (
                              <p key={`${readRecordField(item, 'memory_type')}-${readRecordField(item, 'memory_id')}`} className="table-secondary">
                                {readRecordField(item, 'memory_type')} · {readRecordField(item, 'title_or_label')}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {contradictionPairs.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">Compared contradiction pairs</p>
                            {contradictionPairs.map((item) => (
                              <p key={`${readRecordField(item, 'from_title')}-${readRecordField(item, 'to_title')}`} className="table-secondary">
                                {readRecordField(item, 'from_title')} → {readRecordField(item, 'to_title')}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {staleAssumptions.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">Drift candidates</p>
                            {staleAssumptions.map((item) => (
                              <p key={readRecordField(item, 'title_or_label')} className="table-secondary">
                                {readRecordField(item, 'title_or_label')} · {formatLabel(readRecordField(item, 'status'))}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {supportingEvidence.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">Selected evidence</p>
                            {supportingEvidence.map((item) => (
                              <article key={`${readRecordField(item, 'artifact_id')}-${readRecordField(item, 'chunk_id')}`} className="panel-subtle stack-sm">
                                <p className="table-secondary">{readRecordField(item, 'artifact_title')} · {readRecordField(item, 'evidence_kind')}</p>
                                {readRecordField(item, 'excerpt') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'excerpt')}</p> : null}
                                {readRecordField(item, 'why_selected') !== 'Unavailable' ? <p className="table-secondary">{readRecordField(item, 'why_selected')}</p> : null}
                              </article>
                            ))}
                          </div>
                        ) : null}

                        {sectionCounts ? (
                          <div className="stack-sm">
                            <p className="section-label">Answer composition</p>
                            <p className="table-secondary">
                              Nodes {String(sectionCounts.supporting_nodes ?? 0)} · Evidence {String(sectionCounts.supporting_evidence ?? 0)} · Contradictions {String(sectionCounts.contradictions ?? 0)} · Drift {String(sectionCounts.assumption_drift ?? 0)} · Actions {String(sectionCounts.recommended_next_actions ?? 0)}
                            </p>
                          </div>
                        ) : null}

                        {stepAnswerSynthesis ? (
                          <div className="stack-sm">
                            <p className="section-label">Answer synthesis boundary</p>
                            <p className="table-secondary">{synthesisStatusLabel(stepSynthesisStatus)}</p>
                            {readRecordField(stepAnswerSynthesis, 'confidence_rationale') !== 'Unavailable' ? (
                              <p className="muted-copy">{readRecordField(stepAnswerSynthesis, 'confidence_rationale')}</p>
                            ) : null}
                            {readRecordField(stepAnswerSynthesis, 'fallback_reason') !== 'Unavailable' ? (
                              <p className="muted-copy">{readRecordField(stepAnswerSynthesis, 'fallback_reason')}</p>
                            ) : null}
                            {readStringArray(stepAnswerSynthesis, 'cited_memory_ids').length > 0 ? (
                              <p className="table-secondary">Validated memory citations: {readStringArray(stepAnswerSynthesis, 'cited_memory_ids').join(', ')}</p>
                            ) : null}
                          </div>
                        ) : null}

                        {readRecordField(payload, 'direct_answer') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(payload, 'direct_answer')}</p> : null}
                        {readStringArray(payload, 'notes').length > 0 ? (
                          <ul className="bullet-list">
                            {readStringArray(payload, 'notes').map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        ) : null}
                        {typeof payload.omitted_items === 'number' && payload.omitted_items > 0 ? <p className="table-secondary">Hidden by current permissions: {String(payload.omitted_items)} trace item(s)</p> : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </details>
          </div>
        </>
      ) : null}
    </div>
  )
}
