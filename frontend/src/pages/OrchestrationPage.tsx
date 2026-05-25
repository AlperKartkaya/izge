import { useEffect, useState, type FormEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatLabel, formatPercent } from '../lib/format'
import type { OrchestrationBlueprintRead, ScenarioImpactRead } from '../lib/types'

const DEFAULT_SCENARIO = 'What changes if the company accelerates self-serve onboarding for enterprise expansion next quarter?'

export function OrchestrationPage() {
  const { session } = useAuth()
  const [blueprint, setBlueprint] = useState<OrchestrationBlueprintRead | null>(null)
  const [scenarioText, setScenarioText] = useState(DEFAULT_SCENARIO)
  const [scenarioResult, setScenarioResult] = useState<ScenarioImpactRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isScenarioRunning, setIsScenarioRunning] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }
      try {
        const payload = await api.getOrchestrationBlueprint(session.token)
        if (!cancelled) {
          setBlueprint(payload)
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
    try {
      const result = await api.runScenarioImpact(session.token, scenarioText, 10)
      setScenarioResult(result)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to run bounded scenario support.')
    } finally {
      setIsScenarioRunning(false)
    }
  }

  const reflection = blueprint?.current_reflection ?? {}

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
        <MetricCard label="Active signals" value={String(reflection.active_signal_count ?? '—')} />
      </section>

      <Panel title="Current runtime boundary" description="The implementation remains deterministic and single-process; this page exposes the safe contract for future sub-agent execution.">
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

      <Panel title="Bounded scenario support" description="Ask what known assumptions, commitments, constraints, decisions, or outcomes should be reviewed if a scenario changes. This is impact lookup, not unsupported forecasting.">
        <form className="form-grid" onSubmit={handleScenario}>
          <label className="field">
            <span className="field-label">Scenario</span>
            <textarea value={scenarioText} onChange={(event) => setScenarioText(event.target.value)} rows={4} required />
          </label>
          <button type="submit" className="primary-button" disabled={isScenarioRunning}>{isScenarioRunning ? 'Checking scenario…' : 'Run bounded scenario impact'}</button>
        </form>

        {scenarioResult ? (
          <div className="stack-md">
            <p className="evidence-block">{scenarioResult.answer_text}</p>
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
    </div>
  )
}
