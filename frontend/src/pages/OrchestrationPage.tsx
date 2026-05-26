import { useEffect, useState, type FormEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatLabel, formatPercent } from '../lib/format'
import type {
  OrchestrationBlueprintRead,
  OrchestrationJobListRead,
  OrchestrationStageRunsRead,
  ScenarioImpactRead,
  ScenarioReplayRead,
  ScenarioRunListRead,
  ScenarioTemplateCatalogItem,
} from '../lib/types'

const DEFAULT_SCENARIO = 'Which evidence-backed memory should be reviewed if the company accelerates self-serve onboarding for enterprise expansion next quarter?'

export function OrchestrationPage() {
  const { session } = useAuth()
  const [blueprint, setBlueprint] = useState<OrchestrationBlueprintRead | null>(null)
  const [stageRuns, setStageRuns] = useState<OrchestrationStageRunsRead | null>(null)
  const [jobQueue, setJobQueue] = useState<OrchestrationJobListRead | null>(null)
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRunListRead | null>(null)
  const [scenarioReplay, setScenarioReplay] = useState<ScenarioReplayRead | null>(null)
  const [scenarioTemplates, setScenarioTemplates] = useState<ScenarioTemplateCatalogItem[]>([])
  const [scenarioText, setScenarioText] = useState(DEFAULT_SCENARIO)
  const [scenarioResult, setScenarioResult] = useState<ScenarioImpactRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isScenarioRunning, setIsScenarioRunning] = useState(false)
  const [replayingRunId, setReplayingRunId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }
      try {
        const [payload, runsPayload, jobsPayload, templatesPayload, scenarioRunsPayload] = await Promise.all([
          api.getOrchestrationBlueprint(session.token),
          api.listOrchestrationStageRuns(session.token, 40),
          api.listOrchestrationJobs(session.token, 20),
          api.listScenarioTemplates(session.token),
          api.listScenarioRuns(session.token, 12),
        ])
        if (!cancelled) {
          setBlueprint(payload)
          setStageRuns(runsPayload)
          setJobQueue(jobsPayload)
          setScenarioTemplates(templatesPayload)
          setScenarioRuns(scenarioRunsPayload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load orchestration blueprint.')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [session?.token])

  const handleScenario: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token) {
      return
    }
    setIsScenarioRunning(true)
    setError(null)
    setScenarioResult(null)
    setScenarioReplay(null)
    try {
      const result = await api.runScenarioImpact(session.token, scenarioText, 10)
      setScenarioResult(result)
      const runsPayload = await api.listScenarioRuns(session.token, 12)
      setScenarioRuns(runsPayload)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to run bounded scenario support.')
    } finally {
      setIsScenarioRunning(false)
    }
  }

  const updateScenarioText = (value: string) => {
    setScenarioText(value)
    setScenarioResult(null)
    setScenarioReplay(null)
    setError(null)
  }

  const handleReplayScenario = async (scenarioRunId: string) => {
    if (!session?.token) {
      return
    }
    setReplayingRunId(scenarioRunId)
    setError(null)
    try {
      const replay = await api.replayScenarioRun(session.token, scenarioRunId)
      setScenarioReplay(replay)
      const runsPayload = await api.listScenarioRuns(session.token, 12)
      setScenarioRuns(runsPayload)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to replay scenario run.')
    } finally {
      setReplayingRunId(null)
    }
  }

  const reflection = blueprint?.current_reflection ?? {}
  const templatePrompts = scenarioTemplates
    .map((template) => ({
      key: template.template_key,
      title: template.title,
      prompt: template.example_prompts[0] ?? template.review_lens[0],
    }))
    .filter((template) => template.prompt)

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Bounded internal orchestration"
        title="See how Izge divides evidence work into gated stages"
        description="This is the safe orchestration model: an orchestrator can divide work into bounded stages, but every stage returns cited evidence and passes deterministic provenance gates before it affects memory, graph, signals, or answers."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Execution model" value={blueprint ? formatLabel(blueprint.execution_model) : '—'} />
        <MetricCard label="Stages" value={blueprint?.stage_catalog.length ?? '—'} />
        <MetricCard label="Query runs" value={String(reflection.query_run_count ?? '—')} />
        <MetricCard label="Stage runs" value={String(reflection.stage_run_count ?? stageRuns?.runs.length ?? '—')} />
        <MetricCard label="DB jobs" value={String(reflection.orchestration_job_count ?? jobQueue?.jobs.length ?? '—')} />
        <MetricCard label="Active signals" value={String(reflection.active_signal_count ?? '—')} />
      </section>

      <Panel title="Current runtime boundary" description="Independent read-only specialist packets execute through a bounded local pool; deterministic gates still decide what can become trusted output.">
        {blueprint ? <p className="evidence-block">{blueprint.current_runtime_note}</p> : <EmptyState title="Loading blueprint" description="The backend is preparing orchestration stage metadata." />}
      </Panel>

      <Panel title="Stage catalog" description="Each stage declares inputs, outputs, authority, and the deterministic gate that prevents agent theater.">
        {blueprint ? (
          <div className="stack-sm">
            {blueprint.stage_catalog.map((stage) => (
              <article key={stage.stage_key} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{stage.agent_role}</p>
                    <p className="table-primary">{stage.title}</p>
                  </div>
                  <StatusBadge value={formatLabel(stage.status)} />
                </div>
                <p className="muted-copy">{stage.purpose}</p>
                <div className="two-column-layout">
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">Inputs</p>
                    {stage.inputs.map((input) => <p key={input} className="table-secondary">{input}</p>)}
                  </div>
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">Outputs</p>
                    {stage.outputs.map((output) => <p key={output} className="table-secondary">{output}</p>)}
                  </div>
                </div>
                <p className="evidence-block">Gate: {stage.deterministic_gate}</p>
                <p className="table-secondary">Authority: {formatLabel(stage.authority_level)} · Current reflection: {stage.current_reflection}</p>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title="Spawn policy" description="How a future orchestrator LLM may divide work without getting unrestricted authority.">
        {blueprint ? (
          <div className="stack-sm">
            {blueprint.spawn_policy.map((rule) => <p key={rule} className="evidence-block">{rule}</p>)}
          </div>
        ) : null}
      </Panel>

      <Panel title="Recent DB-backed job queue" description="Portable async-worker foundation: bounded payloads are queued, claimed with leases, and completed with structured results before future external agents can participate.">
        {jobQueue && jobQueue.jobs.length > 0 ? (
          <div className="stack-sm">
            {jobQueue.jobs.slice(0, 8).map((job) => (
              <article key={job.job_id} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{formatLabel(job.job_kind)} · priority {job.priority}</p>
                    <p className="table-primary">{job.stage_key ? formatLabel(job.stage_key) : job.job_id}</p>
                  </div>
                  <StatusBadge value={formatLabel(job.status)} />
                </div>
                <p className="table-secondary">Lease: {job.lease_owner ?? 'not claimed'} · Query: {job.query_run_id ?? 'standalone job'}</p>
                <p className="muted-copy">Created {new Date(job.created_at).toLocaleString()} · available {new Date(job.available_at).toLocaleString()}</p>
                <p className="evidence-block">Payload boundary: {String(job.payload_json.schema_version ?? 'bounded payload')} · trusted writes {job.payload_json.trusted_write_allowed === false ? 'blocked' : 'not requested'}</p>
                {job.completed_at ? <p className="table-secondary">Completed {new Date(job.completed_at).toLocaleString()}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No orchestration jobs yet" description="Run the synthetic company workflow or enqueue a bounded job to see DB-backed worker state." />
        )}
      </Panel>

      <Panel title="Recent stage-run ledger" description="Persisted bounded stage executions from query runs. This is the replayable audit layer that future sub-agents will write through.">
        {stageRuns && stageRuns.runs.length > 0 ? (
          <div className="stack-sm">
            {stageRuns.runs.slice(0, 12).map((run) => (
              <article key={run.stage_run_id} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{formatLabel(run.stage_key)}</p>
                    <p className="table-primary">{run.query_run_id}</p>
                  </div>
                  <StatusBadge value={formatLabel(run.status)} />
                </div>
                <p className="table-secondary">Authority: {formatLabel(run.authority_level)} · Verifier: {run.verifier_status ? formatLabel(run.verifier_status) : 'Unavailable'}</p>
                <p className="muted-copy">Context packet: {String(run.input_refs.context_packet_id ?? 'not recorded')}</p>
                {run.input_refs.stage_packet_id ? (
                  <p className="muted-copy">
                    Stage packet: {String(run.input_refs.stage_packet_id)} · {String(run.output_summary.execution_model ?? 'bounded stage')}
                  </p>
                ) : null}
                <p className="evidence-block">{String(run.output_summary.reason ?? 'No stage summary recorded.')}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No stage runs yet" description="Submit a query to create replayable bounded orchestration stage-run records." />
        )}
      </Panel>

      <Panel title="Bounded scenario support" description="Ask what known assumptions, commitments, constraints, decisions, or outcomes should be reviewed if a scenario changes. This is impact lookup, not unsupported forecasting.">
        <div className="stack-sm">
          <p className="section-label">Company scenario templates</p>
          <div className="signal-grid">
            {templatePrompts.map((template) => (
              <button key={template.key} type="button" className="prompt-card" onClick={() => updateScenarioText(template.prompt)}>
                <span className="section-label">{template.title}</span>
                {template.prompt}
              </button>
            ))}
          </div>
        </div>
        <form className="form-grid" onSubmit={handleScenario}>
          <label className="field">
            <span className="field-label">Scenario</span>
            <textarea value={scenarioText} onChange={(event) => updateScenarioText(event.target.value)} rows={4} required />
          </label>
          <button type="submit" className="primary-button" disabled={isScenarioRunning}>{isScenarioRunning ? 'Checking scenario…' : 'Run bounded scenario impact'}</button>
        </form>

        {scenarioResult ? (
          <div className="stack-md">
            <p className="evidence-block">{scenarioResult.answer_text}</p>
            <div className="panel-subtle stack-sm">
              <div className="timeline-card-head">
                <div>
                  <p className="section-label">Scenario lens</p>
                  <p className="table-primary">{scenarioResult.scenario_template.title}</p>
                </div>
                <StatusBadge value={formatPercent(scenarioResult.scenario_template.confidence_score)} />
              </div>
              <p className="table-secondary">Matched terms: {scenarioResult.scenario_template.matched_terms.length ? scenarioResult.scenario_template.matched_terms.join(', ') : 'general memory review'}</p>
              <p className="muted-copy">
                Packet: {scenarioResult.scenario_packet.schema_version} · {scenarioResult.scenario_packet.packet_id} · selected memory {scenarioResult.scenario_packet.evidence_budget.selected_memory_count} · candidate snapshot {scenarioResult.scenario_packet.candidate_memory_snapshot.length} · artifacts {scenarioResult.scenario_packet.evidence_budget.selected_artifact_count}
              </p>
              <p className="muted-copy">
                Replay: {scenarioResult.scenario_packet.replay_contract.replay_mode} · writes {scenarioResult.scenario_packet.replay_contract.trusted_write_allowed ? 'allowed' : 'blocked'} · forecasting {scenarioResult.scenario_packet.replay_contract.forecasting_allowed ? 'allowed' : 'blocked'}
              </p>
              <p className="muted-copy">
                Stored run: {scenarioResult.scenario_run_id ?? 'not persisted'} · input snapshot {scenarioResult.scenario_packet.input_snapshot_hash.slice(0, 20)}…
              </p>
              {scenarioResult.candidate_templates.length > 1 ? (
                <p className="table-secondary">Also matched: {scenarioResult.candidate_templates.slice(1).map((template) => template.title).join(', ')}</p>
              ) : null}
            </div>
            {scenarioResult.uncertainty_notes.map((note) => <p key={note} className="muted-copy">{note}</p>)}
            {scenarioResult.impacted_memory.length === 0 ? (
              <EmptyState title="No impact path found" description="Add more artifacts or ask a scenario closer to current memory." />
            ) : (
              <div className="stack-sm">
                {scenarioResult.impacted_memory.map((item) => (
                  <article key={`${item.memory_type}-${item.memory_id}`} className="panel-subtle stack-sm">
                    <div className="timeline-card-head">
                      <p className="table-primary">{item.title_or_label}</p>
                      <p className="table-secondary">Confidence {formatPercent(item.confidence_score)}</p>
                    </div>
                    <p className="table-secondary">{formatLabel(item.memory_type)} · {item.source_artifact_title}</p>
                    <p className="table-secondary">Matched evidence terms: {item.matched_terms.join(', ') || 'scenario topic'}</p>
                    <p className="muted-copy">{item.impact_reason}</p>
                    <p className="evidence-block">{item.evidence_excerpt}</p>
                    <Link className="text-button" to={`/memory/${item.memory_type}/${item.memory_id}`}>Open memory object</Link>
                  </article>
                ))}
              </div>
            )}
            <div className="panel-subtle stack-sm">
              <p className="section-label">Questions Izge recommends before action</p>
              {scenarioResult.recommended_questions.map((question) => <p key={question} className="table-secondary">{question}</p>)}
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel title="Scenario run history and replay" description="Stored scenario packets can be replayed under current permissions/evidence to prove impact lookup is deterministic and bounded.">
        {scenarioRuns && scenarioRuns.runs.length > 0 ? (
          <div className="stack-md">
            <div className="stack-sm">
              {scenarioRuns.runs.map((run) => (
                <article key={run.scenario_run_id} className="panel-subtle stack-sm">
                  <div className="timeline-card-head">
                    <div>
                      <p className="section-label">{formatLabel(run.selected_template_key)} · {formatLabel(run.replay_verdict)}</p>
                      <p className="table-primary">{run.packet_id}</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleReplayScenario(run.scenario_run_id)}
                      disabled={replayingRunId === run.scenario_run_id}
                    >
                      {replayingRunId === run.scenario_run_id ? 'Replaying…' : 'Replay'}
                    </button>
                  </div>
                  <p className="table-secondary">
                    Selected {run.selected_memory_count} of {run.candidate_memory_count} candidate memory objects · {run.scenario_run_id}
                  </p>
                </article>
              ))}
            </div>
            {scenarioReplay ? (
              <div className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <p className="table-primary">Replay verdict: {formatLabel(scenarioReplay.verdict)}</p>
                  <StatusBadge value={scenarioReplay.input_snapshot_changed || scenarioReplay.candidate_snapshot_changed ? 'Changed' : 'Stable'} />
                </div>
                <p className="evidence-block">{scenarioReplay.summary}</p>
                <p className="table-secondary">
                  Kept {scenarioReplay.selected_memory_kept.length} · added {scenarioReplay.selected_memory_added.length} · removed {scenarioReplay.selected_memory_removed.length}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No scenario runs yet" description="Run bounded scenario impact once to persist a replayable packet." />
        )}
      </Panel>
    </div>
  )
}
