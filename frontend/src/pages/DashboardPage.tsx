import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { canonicalWorkspacePrompt } from '../lib/workspacePrompts'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ArtifactRead, AssumptionDriftItem, ContradictionItem, GraphSummary, NextActionSignalItem, SignalRead } from '../lib/types'

type DashboardSignalTone = 'critical' | 'drift' | 'action' | 'neutral'

interface DashboardSignalRow {
  id: string
  type: string
  title: string
  summary: string
  detail: string
  tone: DashboardSignalTone
  to?: string
  fullTitle?: string
  fullSummary?: string
}

function signalTone(signalType: string): DashboardSignalTone {
  if (signalType === 'contradiction') {
    return 'critical'
  }
  if (signalType === 'assumption_drift') {
    return 'drift'
  }
  if (signalType === 'next_action' || signalType === 'continuity_overlap') {
    return 'action'
  }
  return 'neutral'
}

function decisionRowClass(tone: DashboardSignalTone): string {
  return `decision-row decision-row-${tone}`
}

const DASHBOARD_COPY_REPLACEMENTS: Array<[RegExp, string]> = [
  [
    /we decided to keep the self-serve launch decision gate open until security and activation instrumentation evidence can be compared/gi,
    'launch gate stays open',
  ],
  [
    /move the self-serve onboarding launch target to Q3 2026 and prioritize foundation work first/gi,
    'move launch to Q3 2026',
  ],
  [/security and activation instrumentation evidence/gi, 'security + activation evidence'],
]

function compactDashboardCopy(value: string | null | undefined, maxLength = 112): string {
  if (!value) {
    return ''
  }

  let copy = value.replace(/\s+/g, ' ').trim()
  for (const [pattern, replacement] of DASHBOARD_COPY_REPLACEMENTS) {
    copy = copy.replace(pattern, replacement)
  }
  copy = copy.replace(/^Resolve contradiction:\s*launch gate stays open\s*↔\s*move launch to Q3 2026$/i, 'Resolve launch timing: gate open ↔ Q3 2026')

  if (copy.length <= maxLength) {
    return copy
  }

  return `${copy.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function hasNoDashboardData(
  summary: GraphSummary | null,
  artifacts: ArtifactRead[],
  persistedSignals: SignalRead[],
  nextActions: NextActionSignalItem[],
): boolean {
  return !summary && artifacts.length === 0 && persistedSignals.length === 0 && nextActions.length === 0
}

export function DashboardPage() {
  const { session } = useAuth()
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
  }, [session?.token])

  const totalMemoryObjects = useMemo(
    () => Object.values(summary?.memory_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )
  const persistedSignalCount = useMemo(
    () => Object.values(summary?.signal_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )
  const isAdmin = session?.user.role === 'Admin'
  const isInitialLoad = isLoading && hasNoDashboardData(summary, artifacts, persistedSignals, nextActions)
  const reviewQueue = useMemo(
    () => artifacts.filter((artifact) => artifact.review_status === 'submitted' || artifact.review_status === 'needs_review'),
    [artifacts],
  )
  const reviewedArtifactCount = useMemo(() => artifacts.filter((artifact) => artifact.review_status === 'reviewed').length, [artifacts])
  const rejectedArtifactCount = useMemo(() => artifacts.filter((artifact) => artifact.review_status === 'rejected').length, [artifacts])
  const topPersistedSignal = persistedSignals[0] ?? null
  const latestCompletedArtifact =
    artifacts.find((artifact) => artifact.ingestion_status === 'completed' && artifact.review_status !== 'rejected') ??
    artifacts.find((artifact) => artifact.review_status !== 'rejected') ??
    artifacts[0] ??
    null
  const artifactCount = summary?.artifact_count ?? artifacts.length
  const reviewedRatio = artifactCount > 0 ? reviewedArtifactCount / artifactCount : 0

  const workspaceReadiness = useMemo(() => {
    if (isInitialLoad) {
      return {
        status: 'Loading',
        title: 'Loading workspace state',
        detail: 'Checking sources, memory, review state, and current signals.',
        actionLabel: 'Open memory',
        actionTo: '/memory',
      }
    }
    if (!latestCompletedArtifact) {
      return {
        status: 'Needs source',
        title: 'Load memory sources first',
        detail: 'Operational use starts only after real company artifacts exist in this workspace.',
        actionLabel: 'Open memory',
        actionTo: '/memory',
      }
    }
    if (!totalMemoryObjects) {
      return {
        status: 'Needs memory',
        title: 'Run ingestion before reasoning',
        detail: 'Artifacts exist, but reconstructed memory objects are required before answers are credible.',
        actionLabel: 'Build memory',
        actionTo: '/ingestion',
      }
    }
    if (isAdmin && reviewQueue.length > 0) {
      return {
        status: 'Needs review',
        title: 'Review source trust before relying on answers',
        detail: `${reviewQueue.length} artifact(s) are waiting for an admin trust decision.`,
        actionLabel: 'Open review queue',
        actionTo: '/admin',
      }
    }
    if (!topPersistedSignal) {
      return {
        status: 'Needs signal',
        title: 'Generate a durable signal',
        detail: 'Memory exists; persist a contradiction, drift, supersession, or next-action signal to make the workflow actionable.',
        actionLabel: 'Inspect graph',
        actionTo: '/graph',
      }
    }
    return {
      status: 'Ready',
      title: 'Ready for a grounded question',
      detail: 'Source, reconstructed memory, review state, and durable signals are present.',
      actionLabel: 'Ask workspace question',
      actionTo: `/query?prompt=${encodeURIComponent(canonicalWorkspacePrompt)}`,
    }
  }, [isAdmin, isInitialLoad, latestCompletedArtifact, reviewQueue.length, topPersistedSignal, totalMemoryObjects])

  const dashboardStats = useMemo(
    () => [
      {
        label: 'Sources',
        value: isInitialLoad ? '—' : artifactCount,
        detail: isInitialLoad ? 'Checking source inventory' : `${reviewQueue.length} awaiting review`,
      },
      {
        label: 'Memory objects',
        value: isInitialLoad ? '—' : totalMemoryObjects,
        detail: isInitialLoad ? 'Checking reconstructed memory' : 'Structured decisions, assumptions, constraints, outcomes, and commitments',
      },
      {
        label: 'Signals',
        value: isInitialLoad ? '—' : persistedSignalCount || nextActions.length,
        detail: isInitialLoad ? 'Checking active tensions' : `${contradictions.length + assumptionDrift.length} active tensions`,
      },
      {
        label: 'Review coverage',
        value: isInitialLoad ? '—' : artifactCount > 0 ? formatPercent(reviewedRatio) : '0%',
        detail: isInitialLoad ? 'Checking review state' : `${reviewedArtifactCount} reviewed / ${rejectedArtifactCount} rejected`,
      },
    ],
    [
      artifactCount,
      assumptionDrift.length,
      contradictions.length,
      isInitialLoad,
      nextActions.length,
      persistedSignalCount,
      rejectedArtifactCount,
      reviewQueue.length,
      reviewedArtifactCount,
      reviewedRatio,
      totalMemoryObjects,
    ],
  )

  const workflowSteps = useMemo(
    () => [
      {
        step: '01',
        label: 'Capture',
        title: latestCompletedArtifact?.title ?? 'Load company memory',
        detail: latestCompletedArtifact
          ? `${latestCompletedArtifact.artifact_id} is ${formatLabel(latestCompletedArtifact.ingestion_status)} and ${formatLabel(latestCompletedArtifact.review_status)}.`
          : 'Upload files or paste source text before relying on company memory.',
        status: latestCompletedArtifact ? formatLabel(latestCompletedArtifact.review_status) : 'Start here',
        to: '/memory',
      },
      {
        step: '02',
        label: 'Build',
        title: `${totalMemoryObjects} reconstructed memory objects`,
        detail: 'Ingestion extracts decisions, assumptions, constraints, outcomes, commitments, provenance, and graph links.',
        status: totalMemoryObjects > 0 ? 'Built' : 'Pending',
        to: '/ingestion',
      },
      {
        step: '03',
        label: 'Govern',
        title: isAdmin ? `${reviewQueue.length} source item(s) need review` : 'Source trust state is visible',
        detail: 'Review status is part of the reasoning record so unsupported or rejected material stays traceable.',
        status: reviewQueue.length > 0 ? 'Needs review' : 'Clear',
        to: isAdmin ? '/admin' : '/audit',
      },
      {
        step: '04',
        label: 'Use',
        title: topPersistedSignal ? compactDashboardCopy(topPersistedSignal.title, 78) : 'Ask an evidence-backed question',
        detail: topPersistedSignal
          ? compactDashboardCopy(topPersistedSignal.summary || 'Open the newest persisted signal or ask the canonical workspace question.', 118)
          : canonicalWorkspacePrompt,
        status: topPersistedSignal ? formatLabel(topPersistedSignal.signal_type) : 'Question',
        to: topPersistedSignal ? `/signals/${topPersistedSignal.signal_id}` : `/query?prompt=${encodeURIComponent(canonicalWorkspacePrompt)}`,
      },
    ],
    [isAdmin, latestCompletedArtifact, reviewQueue.length, topPersistedSignal, totalMemoryObjects],
  )

  const signalRows = useMemo<DashboardSignalRow[]>(() => {
    const rows: DashboardSignalRow[] = [
      ...persistedSignals.slice(0, 4).map((signal) => ({
        id: signal.signal_id,
        type: `Persisted ${formatLabel(signal.signal_type)}`,
        title: compactDashboardCopy(signal.title, 92),
        summary: compactDashboardCopy(signal.summary, 142),
        detail: compactDashboardCopy(
          `${signal.source_artifact_title ?? signal.source_artifact_id ?? 'Unknown source'} · urgency ${formatPercent(signal.urgency_score)} · ${formatDateTime(signal.created_at)}`,
          128,
        ),
        tone: signalTone(signal.signal_type),
        to: `/signals/${signal.signal_id}`,
        fullTitle: signal.title,
        fullSummary: signal.summary,
      })),
      ...contradictions.slice(0, 2).map((item) => {
        const fullTitle = `${item.from_title} ↔ ${item.to_title}`
        const fullSummary = item.evidence_provenance ?? 'Two pieces of memory conflict and require a decision.'
        return {
          id: item.edge_id,
          type: 'Contradiction',
          title: compactDashboardCopy(fullTitle, 92),
          summary: compactDashboardCopy(fullSummary, 142),
          detail: `Topic ${item.topic_key} · confidence ${formatPercent(item.confidence_score)}`,
          tone: 'critical' as const,
          fullTitle,
          fullSummary,
        }
      }),
      ...assumptionDrift.slice(0, 2).map((item) => {
        const fullSummary = item.validity_notes || item.evidence_provenance || 'Later evidence weakened this assumption.'
        return {
          id: item.assumption_id,
          type: 'Assumption drift',
          title: compactDashboardCopy(item.title_or_label, 92),
          summary: compactDashboardCopy(fullSummary, 142),
          detail: `Status ${formatLabel(item.status)} · topic ${item.topic_key}`,
          tone: 'drift' as const,
          fullTitle: item.title_or_label,
          fullSummary,
        }
      }),
      ...nextActions.slice(0, 2).map((item) => ({
        id: item.signal_id,
        type: 'Next action',
        title: compactDashboardCopy(item.title, 92),
        summary: compactDashboardCopy(item.recommended_action, 142),
        detail: `Urgency ${formatPercent(item.urgency_score)} · uncertainty ${formatPercent(item.uncertainty_score)}`,
        tone: 'action' as const,
        fullTitle: item.title,
        fullSummary: item.recommended_action,
      })),
    ]

    return rows.slice(0, 8)
  }, [assumptionDrift, contradictions, nextActions, persistedSignals])

  const accessibleArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.review_status !== 'rejected'),
    [artifacts],
  )
  const employeeEvidenceRows = useMemo(() => accessibleArtifacts.slice(0, 5), [accessibleArtifacts])
  const employeeReadiness = useMemo(() => {
    if (isInitialLoad) {
      return {
        status: 'Loading',
        title: 'Loading current focus',
        detail: 'Checking your accessible sources, memory graph, and current signals.',
        to: '/memory',
        actionLabel: 'Open memory',
      }
    }
    if (!latestCompletedArtifact) {
      return {
        status: 'Needs source',
        title: 'Add the first useful source',
        detail: 'Upload or paste the company material you need Izge to reason over, then ask your question from the assistant.',
        to: '/memory',
        actionLabel: 'Add source',
      }
    }
    if (!totalMemoryObjects) {
      return {
        status: 'Preparing memory',
        title: 'Memory sources are present',
        detail: 'Sources exist in this workspace. An admin may need to finish processing before every answer has full memory context.',
        to: '/memory',
        actionLabel: 'Open memory',
      }
    }
    if (signalRows.length > 0) {
      return {
        status: 'Action available',
        title: signalRows[0].title,
        detail: signalRows[0].summary,
        to: signalRows[0].to ?? '/graph',
        actionLabel: 'Open focus item',
      }
    }
    return {
      status: 'Ready',
      title: 'Ready for a grounded question',
      detail: 'Ask Izge about decisions, assumptions, next actions, or sources you are allowed to access.',
      to: `/query?prompt=${encodeURIComponent(canonicalWorkspacePrompt)}`,
      actionLabel: 'Ask Izge',
    }
  }, [isInitialLoad, latestCompletedArtifact, signalRows, totalMemoryObjects])
  const employeeActions = useMemo(
    () => [
      {
        title: 'Ask Izge',
        detail: 'Ask questions grounded in your permitted artifacts.',
        meta: isInitialLoad
          ? 'Checking memory access'
          : totalMemoryObjects > 0
            ? `${totalMemoryObjects} memory object${totalMemoryObjects === 1 ? '' : 's'} available`
            : 'Works best after evidence is processed',
        to: `/query?prompt=${encodeURIComponent(canonicalWorkspacePrompt)}`,
        cta: 'Ask now',
        icon: '✦',
        primary: true,
      },
      {
        title: 'Continue team chat',
        detail: 'Message coworkers without leaving the workspace.',
        meta: 'Company conversations stay in context',
        to: '/team-chat',
        cta: 'Open chat',
        icon: '◌',
        primary: false,
      },
      {
        title: 'Open memory',
        detail: 'Preview accessible sources and check their status.',
        meta: isInitialLoad ? 'Checking source access' : `${accessibleArtifacts.length} accessible source${accessibleArtifacts.length === 1 ? '' : 's'}`,
        to: '/memory',
        cta: 'View memory',
        icon: '□',
        primary: false,
      },
      {
        title: 'Inspect graph',
        detail: signalRows[0]?.title ?? (isInitialLoad ? 'Checking current signals.' : 'Explore linked decisions, assumptions, and evidence.'),
        meta: signalRows.length > 0 ? `${signalRows.length} focus item${signalRows.length === 1 ? '' : 's'}` : isInitialLoad ? 'Checking signals' : 'No urgent signals yet',
        to: signalRows[0]?.to ?? '/graph',
        cta: signalRows.length > 0 ? 'Review signal' : 'Open graph',
        icon: '◇',
        primary: false,
      },
    ],
    [accessibleArtifacts.length, isInitialLoad, signalRows, totalMemoryObjects],
  )

  const memoryComposition = useMemo(
    () => Object.entries(summary?.memory_counts ?? {}).sort(([, firstCount], [, secondCount]) => secondCount - firstCount),
    [summary],
  )

  if (!isAdmin) {
    return (
      <div className="stack-xl employee-home-page">
        <section className="employee-hero" aria-labelledby="employee-home-title">
          <div className="employee-hero-copy">
            <p className="eyebrow">Employee workspace</p>
            <h1 id="employee-home-title" className="brand-title">
              Get work done with company memory.
            </h1>
            <p className="page-description">
              Ask, check evidence, or message coworkers. Izge uses only the artifacts you are allowed to access.
            </p>
            <div className="employee-hero-actions">
              <Link className="primary-button" to={`/query?prompt=${encodeURIComponent(canonicalWorkspacePrompt)}`}>
                Ask Izge
              </Link>
              <Link className="secondary-button" to="/team-chat">
                Team chat
              </Link>
            </div>
          </div>

          <aside className="employee-focus-panel" aria-label="Current focus">
            <div className="employee-focus-header">
              <div>
                <p className="section-label">Current focus</p>
                <p className="table-primary">{employeeReadiness.title}</p>
              </div>
              <StatusBadge value={employeeReadiness.status} />
            </div>
            <details className="employee-focus-details">
              <summary>Details</summary>
              <p className="muted-copy">{employeeReadiness.detail}</p>
            </details>
            <Link className="secondary-button" to={employeeReadiness.to}>
              {employeeReadiness.actionLabel}
            </Link>
            <dl className="employee-context-list">
              <div>
                <dt>Signed in as</dt>
                <dd>{session?.user.display_name ?? 'Employee'}</dd>
              </div>
              <div>
                <dt>Access rule</dt>
                <dd>Your answers use only permitted company memory.</dd>
              </div>
            </dl>
          </aside>
        </section>

        {error ? <Callout tone="warning">{error}</Callout> : null}

        <section className="employee-action-grid" aria-label="Primary employee actions">
          {employeeActions.map((action) => (
            <Link key={action.title} className={action.primary ? 'employee-action-card employee-action-card-primary' : 'employee-action-card'} to={action.to}>
              <span className="employee-action-icon" aria-hidden="true">
                {action.icon}
              </span>
              <span className="employee-action-copy">
                <span className="table-primary">{action.title}</span>
                <span className="muted-copy">{action.detail}</span>
                <span className="table-secondary">{action.meta}</span>
              </span>
              <span className="employee-action-cta">{action.cta}</span>
            </Link>
          ))}
        </section>

        <div className="employee-content-grid">
          <Panel
            title="Work queue"
            description="Current signals that need attention."
            aside={
              <Link className="secondary-button" to="/graph">
                Open graph
              </Link>
            }
          >
            {isLoading ? <p className="muted-copy">Loading your workspace…</p> : null}
            {!isLoading && signalRows.length === 0 ? (
              <EmptyState
                title="No active focus items"
                description="Signals appear here when accessible evidence needs action."
              />
            ) : null}
            {signalRows.length > 0 ? (
              <div className="employee-work-list">
                {signalRows.slice(0, 5).map((row) => (
                  <Link
                    key={row.id}
                    className={`employee-work-item employee-work-item-${row.tone}`}
                    to={row.to ?? '/graph'}
                    title={`${row.fullTitle ?? row.title}. ${row.fullSummary ?? row.summary}. ${row.detail}`}
                  >
                    <span className="employee-work-kind">{row.type}</span>
                    <span className="employee-work-copy">
                      <span className="table-primary">{row.title}</span>
                      <span className="muted-copy">{row.summary}</span>
                      <span className="table-secondary">{row.detail}</span>
                    </span>
                    <span className="employee-work-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Recent memory sources"
            description="Accessible company sources."
            aside={
              <Link className="secondary-button" to="/memory">
                View all
              </Link>
            }
          >
            {isLoading ? <p className="muted-copy">Loading memory…</p> : null}
            {!isLoading && employeeEvidenceRows.length === 0 ? (
              <EmptyState title="No accessible sources yet" description="Add source material or ask an admin to grant access." />
            ) : null}
            {employeeEvidenceRows.length > 0 ? (
              <div className="table-wrap employee-evidence-table-wrap">
                <table className="data-table employee-evidence-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeEvidenceRows.map((artifact) => (
                      <tr key={artifact.artifact_id}>
                        <td>
                          <div>
                            <p className="table-primary">{artifact.title}</p>
                            <p className="table-secondary">{artifact.original_filename ?? formatLabel(artifact.source_type)}</p>
                          </div>
                        </td>
                        <td>
                          <StatusBadge value={formatLabel(artifact.ingestion_status)} />
                        </td>
                        <td>{formatDateTime(artifact.updated_at)}</td>
                        <td>
                          <Link className="text-button" to="/memory">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    )
  }

  const reasoningModes = [
    ['Decision lineage', 'Understand why a decision exists', 'Timeline, owner, evidence, and related commitments'],
    ['Contradiction analysis', 'Resolve conflicting claims', 'Conflicting memory objects with provenance and confidence'],
    ['Assumption drift', 'Find stale operating assumptions', 'Assumptions whose validity changed after later evidence'],
    ['Next-action guidance', 'Move from evidence to work', 'Recommended action with urgency, uncertainty, and supporting facts'],
  ]

  return (
    <div className="stack-xl dashboard-page">
      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div className="dashboard-hero-copy">
          <p className="eyebrow">Operations dashboard</p>
          <h1 id="dashboard-title" className="brand-title">
            Company memory control center
          </h1>
          <p className="page-description">
            A practical operating view for source intake, evidence governance, memory reconstruction, signal review, and grounded answers.
          </p>
          <div className="inline-actions">
            <Link className="primary-button" to={workspaceReadiness.actionTo}>
              {workspaceReadiness.actionLabel}
            </Link>
          </div>
        </div>

        <aside className="dashboard-hero-panel" aria-label="Current readiness and workspace boundary">
          <div className="readiness-header">
            <div>
              <p className="section-label">Current state</p>
              <p className="table-primary">{workspaceReadiness.title}</p>
            </div>
            <StatusBadge value={workspaceReadiness.status} />
          </div>
          <p className="muted-copy">{workspaceReadiness.detail}</p>
          <dl className="dashboard-meta-list">
            <div>
              <dt>User</dt>
              <dd>{session?.user.display_name ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{session?.user.role ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{summary?.workspace_id ?? session?.user.workspace_id ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Stance</dt>
              <dd>Reconstruct first. Compare second. Recommend last.</dd>
            </div>
          </dl>
        </aside>
      </section>

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="dashboard-kpi-strip" aria-label="Current workspace health">
        {dashboardStats.map((metric) => (
          <article key={metric.label} className="dashboard-kpi">
            <p className="section-label">{metric.label}</p>
            <p className="dashboard-kpi-value">{metric.value}</p>
            <p className="table-secondary">{metric.detail}</p>
          </article>
        ))}
      </section>

      <div className="dashboard-main-grid">
        <Panel
          title="Operating path"
          description="The next operational step should be clear without forcing employees through a wall of similar cards."
          aside={
            <Link className="secondary-button" to={workspaceReadiness.actionTo}>
              Continue
            </Link>
          }
        >
          <ol className="workflow-step-list">
            {workflowSteps.map((step) => (
              <li key={step.step} className="workflow-step">
                <span className="workflow-step-index">{step.step}</span>
                <div className="workflow-step-copy">
                  <div className="workflow-step-head">
                    <div>
                      <p className="section-label">{step.label}</p>
                      <p className="table-primary">{step.title}</p>
                    </div>
                    <StatusBadge value={step.status} />
                  </div>
                  <p className="muted-copy">{step.detail}</p>
                </div>
                <Link className="text-button" to={step.to}>
                  Open
                </Link>
              </li>
            ))}
          </ol>
        </Panel>

        {isAdmin ? (
          <Panel
            title="Evidence governance"
            description="Trusted answers depend on an explicit source review state. Stored records remain auditable even when rejected."
            aside={
              <Link className="secondary-button" to="/admin/users">
                Manage
              </Link>
            }
          >
            <dl className="review-ledger">
              <div>
                <dt>Waiting</dt>
                <dd>{reviewQueue.length}</dd>
              </div>
              <div>
                <dt>Reviewed</dt>
                <dd>{reviewedArtifactCount}</dd>
              </div>
              <div>
                <dt>Rejected</dt>
                <dd>{rejectedArtifactCount}</dd>
              </div>
            </dl>
            {reviewQueue.length > 0 ? (
              <div className="review-queue-list">
                {reviewQueue.slice(0, 4).map((artifact) => (
                  <Link key={artifact.artifact_id} className="review-queue-row" to="/admin/users">
                    <div>
                      <p className="table-primary">{artifact.title}</p>
                      <p className="table-secondary">
                        {formatLabel(artifact.ingestion_status)} · updated {formatDateTime(artifact.updated_at)}
                      </p>
                    </div>
                    <StatusBadge value={formatLabel(artifact.review_status)} />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted-copy">No submitted or needs-review artifacts are waiting in the admin queue.</p>
            )}
          </Panel>
        ) : (
          <Panel title="Evidence boundary" description="Permissions and trust state remain part of every answer.">
            <p className="muted-copy">
              You are viewing the workspace as {session?.user.display_name ?? 'the current user'}. Restricted evidence stays out of answers when permissions do not allow it.
            </p>
          </Panel>
        )}
      </div>

      <div className="dashboard-analysis-grid">
        <Panel title="Reasoning modes" description="Modes are operational tools, not marketing copy or chat personas.">
          <div className="table-wrap mode-table-wrap">
            <table className="data-table mode-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Use when</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                {reasoningModes.map(([mode, useWhen, output]) => (
                  <tr key={mode}>
                    <td>{mode}</td>
                    <td>{useWhen}</td>
                    <td>{output}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Memory composition" description="A compact graph of what ingestion reconstructed from company sources.">
          {memoryComposition.length === 0 ? (
            <EmptyState title="No memory graph yet" description="Run ingestion to populate the memory composition graph." />
          ) : (
            <div className="composition-chart" aria-label="Memory object composition">
              {memoryComposition.map(([memoryType, count]) => {
                const width = totalMemoryObjects > 0 ? Math.max(6, (count / totalMemoryObjects) * 100) : 0
                return (
                  <div key={memoryType} className="composition-row">
                    <span>{formatLabel(memoryType)}</span>
                    <span className="composition-track" aria-hidden="true">
                      <span style={{ width: `${width}%` }} />
                    </span>
                    <strong>{count}</strong>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Signals requiring a decision"
        description="Signals are shown as an action list so users can scan type, evidence, urgency, and next destination quickly."
        aside={
          <Link className="secondary-button" to="/graph">
            Inspect graph
          </Link>
        }
      >
        {signalRows.length === 0 ? (
          <EmptyState title="No active signals yet" description="Run ingestion on company artifacts to surface contradictions, drift, and grounded guidance." />
        ) : (
          <div className="decision-list">
            {signalRows.map((row) => {
              const content = (
                <>
                  <div className="decision-row-kind">
                    <span>{row.type}</span>
                  </div>
                  <div className="decision-row-copy">
                    <p className="table-primary">{row.title}</p>
                    <p className="muted-copy">{row.summary}</p>
                    <p className="table-secondary">{row.detail}</p>
                  </div>
                  <span className="decision-row-arrow" aria-hidden="true">
                    {row.to ? '↗' : '•'}
                  </span>
                </>
              )

              return row.to ? (
                <Link key={row.id} className={decisionRowClass(row.tone)} to={row.to} title={`${row.fullTitle ?? row.title}. ${row.fullSummary ?? row.summary}. ${row.detail}`}>
                  {content}
                </Link>
              ) : (
                <article key={row.id} className={decisionRowClass(row.tone)} title={`${row.fullTitle ?? row.title}. ${row.fullSummary ?? row.summary}. ${row.detail}`}>
                  {content}
                </article>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Recent memory sources entering memory"
        description="Sources are inspectable provenance, not background files."
        aside={
          <Link className="secondary-button" to="/memory">
            View all
          </Link>
        }
      >
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
                  <th>Review</th>
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
                      <StatusBadge value={formatLabel(artifact.ingestion_status)} />
                    </td>
                    <td>
                      <StatusBadge value={formatLabel(artifact.review_status)} />
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
