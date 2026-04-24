import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { ArtifactRead, GraphSummary } from '../lib/types'

export function DashboardPage() {
  const { session, refreshUser } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
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
        const [graphSummary, artifactList] = await Promise.all([
          api.getGraphSummary(session.token),
          api.listArtifacts(session.token),
          refreshUser(),
        ])

        if (!cancelled) {
          setSummary(graphSummary)
          setArtifacts(artifactList)
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

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Workspace dashboard"
        title="Institutional memory at a glance"
        description="Track which sources have been ingested, how much structured memory is available, and where to inspect the current decision history."
        actions={
          <div className="inline-actions">
            <Link className="secondary-button" to="/artifacts">
              Review sources
            </Link>
            <Link className="primary-button" to="/query">
              Ask the history
            </Link>
          </div>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Visible sources" value={summary?.artifact_count ?? '—'} detail="Artifacts currently available in your permitted scope." />
        <MetricCard label="Memory objects" value={totalMemoryObjects || '—'} detail="Structured decisions, assumptions, constraints, outcomes, and commitments." />
        <MetricCard label="Relationship types" value={Object.keys(summary?.edge_counts ?? {}).length || '—'} detail="Explicit graph coverage across the remembered history." />
        <MetricCard label="Signed-in role" value={session?.user.role ?? '—'} detail="Permissions determine which artifacts and evidence are surfaced." />
      </section>

      <div className="two-column-layout">
        <Panel title="How Izge reasons" description="The MVP reconstructs history through fixed institutional-memory modes instead of open-ended chat.">
          <div className="signal-grid">
            {[
              'Decision lineage',
              'Contradiction analysis',
              'Assumption drift',
              'Next-action guidance',
            ].map((item) => (
              <article key={item} className="signal-card panel-subtle">
                <p className="signal-title">{item}</p>
                <p className="muted-copy">Available through the history workspace with evidence-backed sections and inspectable supporting memory.</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="Current workspace identity" description="Session and scope details for the single remembered workspace.">
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
              <dd>Institutional memory first, decision guidance second.</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel title="Recent memory sources" description="Latest permitted artifacts, ready for inspection or ingestion.">
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
