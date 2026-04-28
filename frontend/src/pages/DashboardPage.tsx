import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { canonicalDemoPrompt } from '../lib/demo'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ArtifactRead, AssumptionDriftItem, ContradictionItem, GraphSummary, NextActionSignalItem, SignalRead } from '../lib/types'

function signalCardClass(signalType: string): string {
  if (signalType === 'contradiction') {
    return 'record-link signal-card panel-subtle critical-card'
  }
  if (signalType === 'assumption_drift') {
    return 'record-link signal-card panel-subtle drift-card'
  }
  if (signalType === 'next_action') {
    return 'record-link signal-card panel-subtle action-card'
  }
  return 'record-link signal-card panel-subtle'
}

export function DashboardPage() {
  const { session, refreshUser } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([])
  const [assumptionDrift, setAssumptionDrift] = useState<AssumptionDriftItem[]>([])
  const [nextActions, setNextActions] = useState<NextActionSignalItem[]>([])
  const [persistedSignals, setPersistedSignals] = useState<SignalRead[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const [graphSummary, artifactList, contradictionList, driftList, actionList, signalList] = await Promise.all([
          api.getGraphSummary(session.token),
          api.listArtifacts(session.token),
          api.listContradictions(session.token),
          api.listAssumptionDrift(session.token),
          api.listNextActions(session.token),
          api.listSignals(session.token),
          refreshUser(),
        ])

        if (!cancelled) {
          setSummary(graphSummary)
          setArtifacts(artifactList)
          setContradictions(contradictionList)
          setAssumptionDrift(driftList)
          setNextActions(actionList)
          setPersistedSignals(signalList)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load dashboard state.')
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
  }, [refreshUser, session?.token])

  const totalMemoryObjects = useMemo(
    () => Object.values(summary?.memory_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )
  const persistedSignalCount = useMemo(
    () => Object.values(summary?.signal_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )
  const topPersistedSignal = persistedSignals[0] ?? null
  const latestCompletedArtifact = artifacts.find((artifact) => artifact.ingestion_status === 'completed') ?? artifacts[0] ?? null
  const demoReadiness = useMemo(() => {
    if (!latestCompletedArtifact) {
      return {
        status: 'Needs source',
        title: 'Load evidence first',
        detail: 'The demo path starts only after real artifacts exist in the workspace.',
        actionLabel: 'Load evidence',
        actionTo: '/artifacts',
      }
    }
    if (!totalMemoryObjects) {
      return {
        status: 'Needs memory',
        title: 'Run ingestion before reasoning',
        detail: 'Artifacts exist, but the workspace still needs reconstructed memory objects before the intelligence path is credible.',
        actionLabel: 'Build memory',
        actionTo: '/ingestion',
      }
    }
    if (!topPersistedSignal) {
      return {
        status: 'Needs signal',
        title: 'Generate a durable signal',
        detail: 'Memory exists, but the strongest demo needs a persisted contradiction, drift, supersession, or next-action signal.',
        actionLabel: 'Inspect graph',
        actionTo: '/graph',
      }
    }
    return {
      status: 'Ready',
      title: 'Ready for the canonical question',
      detail: 'Source, reconstructed memory, and persisted signals are all present. Ask the question and drill into the linked evidence.',
      actionLabel: 'Ask demo question',
      actionTo: `/query?prompt=${encodeURIComponent(canonicalDemoPrompt)}`,
    }
  }, [latestCompletedArtifact, topPersistedSignal, totalMemoryObjects])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Decision intelligence command board"
        title="See what changed before the team moves again"
        description="Izge turns artifacts into a hard-edged institutional record: decisions, later conflicts, drifting assumptions, evidence spans, and grounded next actions."
        actions={
          <div className="inline-actions">
            <Link className="secondary-button" to="/artifacts">
              Load evidence
            </Link>
            <Link className="primary-button" to="/query">
              Interrogate history
            </Link>
          </div>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Visible sources" value={summary?.artifact_count ?? '—'} detail="Artifacts currently available in your permitted scope." />
        <MetricCard label="Memory objects" value={totalMemoryObjects || '—'} detail="Structured decisions, assumptions, constraints, outcomes, and commitments." />
        <MetricCard label="Active tensions" value={contradictions.length + assumptionDrift.length} detail="Contradictions and assumption drift visible in your permitted scope." />
        <MetricCard label="Persisted signals" value={persistedSignalCount || nextActions.length} detail="Durable proactive signals generated from ingested artifact impact." />
      </section>

      <Panel
        title="Canonical demo path"
        description="One clean path for jury review: show source material, show memory construction, inspect a durable signal, ask the question, then drill into evidence."
        aside={
          <Link className="primary-button" to={demoReadiness.actionTo}>
            {demoReadiness.actionLabel}
          </Link>
        }
      >
        <article className="panel-subtle stack-sm">
          <div className="timeline-card-head">
            <div>
              <p className="section-label">Current proof state</p>
              <p className="table-primary">{demoReadiness.title}</p>
            </div>
            <StatusBadge value={demoReadiness.status} />
          </div>
          <p className="muted-copy">{demoReadiness.detail}</p>
        </article>
        <div className="signal-grid">
          <Link className="record-link signal-card panel-subtle" to="/artifacts">
            <p className="section-label">1 / Source state</p>
            <p className="signal-title">{latestCompletedArtifact?.title ?? 'Load the demo artifacts'}</p>
            <p className="muted-copy">
              {latestCompletedArtifact
                ? `Visible source ${latestCompletedArtifact.artifact_id} is ready for evidence inspection.`
                : 'Add or seed source artifacts before demonstrating institutional memory.'}
            </p>
          </Link>
          <Link className="record-link signal-card panel-subtle" to="/ingestion">
            <p className="section-label">2 / Memory build</p>
            <p className="signal-title">{totalMemoryObjects || 0} reconstructed memory objects</p>
            <p className="muted-copy">Ingestion turns artifacts into decisions, assumptions, constraints, outcomes, commitments, and graph links.</p>
          </Link>
          {topPersistedSignal ? (
            <Link className={signalCardClass(topPersistedSignal.signal_type)} to={`/signals/${topPersistedSignal.signal_id}`}>
              <p className="section-label">3 / Durable signal</p>
              <p className="signal-title">{topPersistedSignal.title}</p>
              <p className="muted-copy">Open the persisted signal to inspect evidence, memory objects, and the intelligence path.</p>
            </Link>
          ) : (
            <Link className="record-link signal-card panel-subtle" to="/graph">
              <p className="section-label">3 / Durable signal</p>
              <p className="signal-title">No persisted signal yet</p>
              <p className="muted-copy">Run ingestion on conflicting or drifting evidence to create contradiction, drift, supersession, or next-action signals.</p>
            </Link>
          )}
          <Link className="record-link signal-card panel-subtle action-card" to={`/query?prompt=${encodeURIComponent(canonicalDemoPrompt)}`}>
            <p className="section-label">4 / Question</p>
            <p className="signal-title">Ask what changed and what to do next</p>
            <p className="muted-copy">{canonicalDemoPrompt}</p>
          </Link>
        </div>
      </Panel>

      <div className="two-column-layout">
        <Panel title="Reasoning modes, not chat modes" description="Each block is a fixed institutional-memory operation designed to expose why a recommendation is justified.">
          <div className="signal-grid">
            {[
              ['Decision lineage', 'Trace who decided what, when, and under which source record.'],
              ['Contradiction analysis', 'Make later claims visually collide with earlier commitments.'],
              ['Assumption drift', 'Mark stale assumptions as operational risk, not weak metadata.'],
              ['Next-action guidance', 'Recommend moves only after evidence, conflict, and uncertainty are visible.'],
            ].map(([item, detail]) => (
              <article key={item} className="signal-card panel-subtle">
                <p className="signal-title">{item}</p>
                <p className="muted-copy">{detail}</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="Current memory boundary" description="Scope and permissions are part of the reasoning record; hidden evidence must stay visible as a constraint.">
          <dl className="meta-list">
            <div>
              <dt>Name</dt>
              <dd>{session?.user.display_name ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{session?.user.email ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Workspace ID</dt>
              <dd>{summary?.workspace_id ?? session?.user.workspace_id ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Product stance</dt>
              <dd>Reconstruct first. Compare second. Recommend last.</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel
        title="Signals requiring a decision"
        description="Workspace-level contradiction, drift, and next-action guidance are first-class memory products, not analytics widgets."
        aside={
          <Link className="secondary-button" to="/graph">
            Inspect graph
          </Link>
        }
      >
        {contradictions.length === 0 && assumptionDrift.length === 0 && nextActions.length === 0 && persistedSignals.length === 0 ? (
          <EmptyState title="No active signals yet" description="Run ingestion on demo artifacts to surface contradictions, drift, and grounded guidance." />
        ) : (
          <div className="signal-grid">
            {persistedSignals.slice(0, 3).map((signal) => (
              <Link key={signal.signal_id} className={signalCardClass(signal.signal_type)} to={`/signals/${signal.signal_id}`}>
                <p className="section-label">Persisted {formatLabel(signal.signal_type)}</p>
                <p className="signal-title">{signal.title}</p>
                <p className="muted-copy">{signal.summary}</p>
                <p className="table-secondary">
                  {signal.source_artifact_title ?? signal.source_artifact_id ?? 'Unknown source'} · urgency {formatPercent(signal.urgency_score)} · {formatDateTime(signal.created_at)}
                </p>
              </Link>
            ))}
            {contradictions.slice(0, 2).map((item) => (
              <article key={item.edge_id} className="signal-card panel-subtle critical-card">
                <p className="section-label">Contradiction</p>
                <p className="signal-title">{item.from_title} ↔ {item.to_title}</p>
                <p className="muted-copy">{item.evidence_provenance}</p>
                <p className="table-secondary">Topic {item.topic_key} · confidence {formatPercent(item.confidence_score)}</p>
              </article>
            ))}
            {assumptionDrift.slice(0, 2).map((item) => (
              <article key={item.assumption_id} className="signal-card panel-subtle drift-card">
                <p className="section-label">Assumption drift</p>
                <p className="signal-title">{item.title_or_label}</p>
                <p className="muted-copy">{item.validity_notes || item.evidence_provenance || 'Later evidence weakened this assumption.'}</p>
                <p className="table-secondary">Status {formatLabel(item.status)} · topic {item.topic_key}</p>
              </article>
            ))}
            {nextActions.slice(0, 2).map((item) => (
              <article key={item.signal_id} className="signal-card panel-subtle action-card">
                <p className="section-label">Next action</p>
                <p className="signal-title">{item.title}</p>
                <p className="muted-copy">{item.recommended_action}</p>
                <p className="table-secondary">
                  Urgency {formatPercent(item.urgency_score)} · uncertainty {formatPercent(item.uncertainty_score)}
                </p>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent evidence entering memory" description="Sources are treated as inspectable provenance, not background files.">
        {isLoading ? <p className="muted-copy">Loading source inventory…</p> : null}
        {!isLoading && artifacts.length === 0 ? (
          <EmptyState title="No sources yet" description="Upload a file or submit pasted text to start reconstructing institutional memory." />
        ) : null}
        {artifacts.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Visibility</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.slice(0, 6).map((artifact) => (
                  <tr key={artifact.artifact_id}>
                    <td>
                      <div>
                        <p className="table-primary">{artifact.title}</p>
                        <p className="table-secondary">{artifact.artifact_id}</p>
                      </div>
                    </td>
                    <td>{artifact.visibility_scope}</td>
                    <td>
                      <StatusBadge value={artifact.ingestion_status} />
                    </td>
                    <td>{formatDateTime(artifact.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
