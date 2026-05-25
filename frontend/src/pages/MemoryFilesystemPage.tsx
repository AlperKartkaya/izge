import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel } from '../lib/format'
import type { MemoryFilesystemArtifact, MemoryFilesystemRead } from '../lib/types'

function totalMemoryObjects(artifact: MemoryFilesystemArtifact) {
  return Object.values(artifact.memory_counts).reduce((sum, count) => sum + count, 0)
}

export function MemoryFilesystemPage() {
  const { session } = useAuth()
  const [filesystem, setFilesystem] = useState<MemoryFilesystemRead | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }
      try {
        const payload = await api.getMemoryFilesystem(session.token)
        if (!cancelled) {
          setFilesystem(payload)
          setSelectedArtifactId(payload.artifacts[0]?.artifact_id ?? null)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load memory file-system.')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [session?.token])

  const selectedArtifact = useMemo(
    () => filesystem?.artifacts.find((artifact) => artifact.artifact_id === selectedArtifactId) ?? filesystem?.artifacts[0] ?? null,
    [filesystem, selectedArtifactId],
  )

  const totals = useMemo(() => {
    const artifacts = filesystem?.artifacts ?? []
    return {
      artifacts: artifacts.length,
      chunks: artifacts.reduce((sum, artifact) => sum + artifact.chunk_count, 0),
      memory: artifacts.reduce((sum, artifact) => sum + totalMemoryObjects(artifact), 0),
      signals: artifacts.reduce((sum, artifact) => sum + artifact.signal_count, 0),
    }
  }, [filesystem])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Evidence substrate / memory file-system"
        title="See how Izge organizes company memory"
        description="This is the safe internal file-system view: source artifacts become chunks, chunks become typed memory, memory becomes graph edges, signals, traces, and evidence-backed answers."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Visible artifacts" value={totals.artifacts || '—'} detail="Source roots in your permission scope." />
        <MetricCard label="Indexed chunks" value={totals.chunks || '—'} detail="Retrieval leaves under the evidence substrate." />
        <MetricCard label="Memory objects" value={totals.memory || '—'} detail="Decision, assumption, constraint, outcome, commitment rows." />
        <MetricCard label="Artifact signals" value={totals.signals || '—'} detail="Persisted contradiction, drift, continuity, and action signals." />
      </section>

      <Panel title="Database organization guide" description="Step-by-step organization rule for making Izge portable to any company workspace.">
        {filesystem ? (
          <div className="stack-sm">
            {filesystem.organization_guide.map((step) => (
              <article key={step.step} className="panel-subtle stack-sm">
                <p className="section-label">Step {step.step}</p>
                <p className="table-primary">{step.title}</p>
                <p className="muted-copy">{step.description}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Loading organization guide" description="Izge is reading the current workspace memory layers." />
        )}
      </Panel>

      <div className="two-column-layout wide-right-column">
        <Panel title="Memory roots" description="The high-level folders of the internal memory database.">
          {filesystem ? (
            <div className="stack-sm">
              {filesystem.roots.map((root) => (
                <article key={root.node_id} className="panel-subtle stack-sm">
                  <div className="timeline-card-head">
                    <p className="table-primary">{root.label}</p>
                    <StatusBadge value={formatLabel(root.node_type)} />
                  </div>
                  <p className="table-secondary">{root.status} · {root.children_count} children</p>
                  <p className="muted-copy">{root.description}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No roots yet" description="Memory roots appear after the backend returns the substrate read model." />
          )}
        </Panel>

        <Panel title="Artifact organization tree" description="Each artifact is shown with its logical locator, trust state, retrieval state, and downstream coverage.">
          {!filesystem || filesystem.artifacts.length === 0 ? (
            <EmptyState title="No artifacts uploaded" description="Upload or paste an artifact, run ingestion, and return here to inspect the memory file-system." />
          ) : (
            <div className="stack-sm">
              {filesystem.artifacts.map((artifact) => (
                <button
                  key={artifact.artifact_id}
                  type="button"
                  className={selectedArtifact?.artifact_id === artifact.artifact_id ? 'timeline-card timeline-card-active' : 'timeline-card'}
                  onClick={() => setSelectedArtifactId(artifact.artifact_id)}
                >
                  <div className="timeline-card-head">
                    <p className="table-primary">{artifact.title}</p>
                    <StatusBadge value={formatLabel(artifact.retrieval_state)} />
                  </div>
                  <p className="table-secondary">{artifact.organization_path.join(' / ')}</p>
                  <p className="muted-copy">{artifact.storage_locator}</p>
                  <div className="timeline-stats">
                    <span>{artifact.chunk_count} chunks</span>
                    <span>{totalMemoryObjects(artifact)} memory objects</span>
                    <span>{artifact.graph_edge_count} edges</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={selectedArtifact ? 'Selected artifact substrate' : 'Artifact substrate'} description="Safe metadata only: logical locators and checksums, not host filesystem paths.">
        {selectedArtifact ? (
          <div className="stack-md">
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">Logical locator</p>
                <p className="table-primary">{selectedArtifact.storage_locator}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Checksum</p>
                <p className="table-primary">{selectedArtifact.checksum_sha256?.slice(0, 16) ?? 'Unavailable'}…</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Trust boundary</p>
                <p className="table-primary">{formatLabel(selectedArtifact.review_status)}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Updated</p>
                <p className="table-primary">{formatDateTime(selectedArtifact.updated_at)}</p>
              </article>
            </div>

            <div className="panel-subtle stack-sm">
              <p className="section-label">Trust boundary</p>
              <p className="muted-copy">{selectedArtifact.trust_boundary}</p>
            </div>

            <div className="two-column-layout">
              <div className="panel-subtle stack-sm">
                <p className="section-label">Memory object coverage</p>
                {Object.entries(selectedArtifact.memory_counts).map(([kind, count]) => (
                  <div key={kind} className="stat-row">
                    <span>{formatLabel(kind)}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
              <div className="panel-subtle stack-sm">
                <p className="section-label">Coverage notes</p>
                {selectedArtifact.coverage_notes.map((note) => (
                  <p key={note} className="muted-copy">{note}</p>
                ))}
              </div>
            </div>

            <Link className="secondary-button" to={`/artifacts?artifactId=${selectedArtifact.artifact_id}`}>Open artifact evidence detail</Link>
          </div>
        ) : (
          <EmptyState title="No artifact selected" description="Choose an artifact from the organization tree to inspect its substrate metadata." />
        )}
      </Panel>

      <Panel title="Database blueprint" description="How the current SQLite database should be organized for any company deployment.">
        {filesystem ? (
          <div className="stack-sm">
            {filesystem.database_blueprint.map((layer) => (
              <article key={layer.layer} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <p className="table-primary">{layer.layer}</p>
                  <p className="table-secondary">{layer.table_names.join(', ')}</p>
                </div>
                <p className="muted-copy">{layer.purpose}</p>
                <p className="table-secondary">Write path: {layer.write_path}</p>
                <p className="table-secondary">Read path: {layer.read_path}</p>
                <p className="evidence-block">{layer.organization_rule}</p>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
