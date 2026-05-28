import { useEffect, useMemo, useState, type FormEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel } from '../lib/format'
import type { ArtifactStorageAdminRead, DatabaseOverviewRead } from '../lib/types'

function formatBytes(value: number | null): string {
  if (value === null) {
    return 'Missing'
  }
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function DataAdminPage() {
  const { session } = useAuth()
  const isAdmin = session?.user.role === 'Admin'
  const [overview, setOverview] = useState<DatabaseOverviewRead | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  async function loadOverview(preferredArtifactId?: string) {
    if (!session?.token) {
      return
    }
    const nextOverview = await api.getDatabaseOverview(session.token)
    setOverview(nextOverview)
    const nextSelectedArtifactId = preferredArtifactId || selectedArtifactId || nextOverview.artifacts[0]?.artifact_id || ''
    setSelectedArtifactId(nextSelectedArtifactId)
    const selected = nextOverview.artifacts.find((artifact) => artifact.artifact_id === nextSelectedArtifactId) ?? nextOverview.artifacts[0] ?? null
    setTitleDraft(selected?.title ?? '')
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !isAdmin) {
        return
      }
      setError(null)
      try {
        const nextOverview = await api.getDatabaseOverview(session.token)
        if (cancelled) {
          return
        }
        setOverview(nextOverview)
        const firstArtifact = nextOverview.artifacts[0] ?? null
        setSelectedArtifactId((current) => current || firstArtifact?.artifact_id || '')
        setTitleDraft(firstArtifact?.title ?? '')
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load database overview.')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [isAdmin, session?.token])

  const selectedArtifact = useMemo<ArtifactStorageAdminRead | null>(
    () => overview?.artifacts.find((artifact) => artifact.artifact_id === selectedArtifactId) ?? null,
    [overview?.artifacts, selectedArtifactId],
  )

  const totalRows = useMemo(() => overview?.tables.reduce((sum, table) => sum + table.row_count, 0) ?? 0, [overview?.tables])
  const totalSourceBytes = useMemo(
    () => overview?.artifacts.reduce((sum, artifact) => sum + (artifact.byte_size ?? 0), 0) ?? 0,
    [overview?.artifacts],
  )

  function handleSelectArtifact(artifact: ArtifactStorageAdminRead) {
    setSelectedArtifactId(artifact.artifact_id)
    setTitleDraft(artifact.title)
    setError(null)
    setSuccess(null)
  }

  const handleTitleSave: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token || !selectedArtifact) {
      return
    }

    setIsBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await api.updateArtifactMetadata(session.token, selectedArtifact.artifact_id, { title: titleDraft.trim() })
      await loadOverview(selectedArtifact.artifact_id)
      setSuccess('Artifact title updated. Source content remains unchanged.')
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to update artifact metadata.')
    } finally {
      setIsBusy(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="stack-xl">
        <PageIntro
          eyebrow="Admin data"
          title="Database inspection requires an admin account"
          description="Ask an admin to inspect stored artifacts, database row counts, and storage paths."
        />
        <Callout tone="warning">Your current role does not allow database administration.</Callout>
      </div>
    )
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Data and storage"
        title="Inspect the workspace database and artifact storage"
        description="Use this page to see where uploaded documents are stored, which tables hold workspace state, and which artifact fields can be safely modified."
        actions={
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={() => void loadOverview(selectedArtifactId)} disabled={isBusy || !session?.token}>
              Refresh
            </button>
            <Link className="primary-button" to="/artifacts">
              Add artifact
            </Link>
          </div>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {success ? <Callout>{success}</Callout> : null}

      <section className="data-overview-grid" aria-label="Database overview">
        <article className="data-overview-card panel-subtle">
          <p className="metric-label">Database revision</p>
          <code className="data-overview-value">{overview?.alembic_revision ?? 'Not loaded'}</code>
          <p className="metric-detail">Current Alembic migration version for this database.</p>
        </article>
        <article className="data-overview-card panel-subtle">
          <p className="metric-label">Tables</p>
          <p className="data-overview-number">{overview?.tables.length ?? '—'}</p>
          <p className="metric-detail">{totalRows} total stored rows across application tables.</p>
        </article>
        <article className="data-overview-card panel-subtle">
          <p className="metric-label">Artifacts</p>
          <p className="data-overview-number">{overview?.artifacts.length ?? '—'}</p>
          <p className="metric-detail">{formatBytes(totalSourceBytes)} stored source data visible to admins.</p>
        </article>
        <article className="data-overview-card panel-subtle">
          <p className="metric-label">Workspace</p>
          <code className="data-overview-value">{overview?.workspace_id ?? '—'}</code>
          <p className="metric-detail">Single-company workspace boundary for this deployment.</p>
        </article>
      </section>

      <div className="two-column-layout wide-right-column">
        <Panel title="Stored artifacts" description="Admin view of source storage, memory coverage, review state, and supported metadata changes.">
          {!overview || overview.artifacts.length === 0 ? (
            <EmptyState title="No stored artifacts" description="Upload or paste evidence to populate the storage inventory." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Artifact</th>
                    <th>Storage</th>
                    <th>Memory</th>
                    <th>Review</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.artifacts.map((artifact) => (
                    <tr
                      key={artifact.artifact_id}
                      className={artifact.artifact_id === selectedArtifactId ? 'row-selected' : undefined}
                      onClick={() => handleSelectArtifact(artifact)}
                    >
                      <td>
                        <button type="button" className="row-title-button" onClick={() => handleSelectArtifact(artifact)}>
                          {artifact.title}
                        </button>
                        <p className="table-secondary">{artifact.artifact_id}</p>
                      </td>
                      <td>
                        <StatusBadge value={artifact.storage_exists ? 'Stored' : 'Missing'} />
                        <p className="table-secondary">{formatBytes(artifact.byte_size)}</p>
                      </td>
                      <td>{artifact.memory_object_count} objects / {artifact.chunk_count} chunks</td>
                      <td>
                        <StatusBadge value={formatLabel(artifact.review_status)} />
                      </td>
                      <td>{formatDateTime(artifact.updated_at)}</td>
                      <td>
                        <div className="table-action-group" onClick={(event) => event.stopPropagation()}>
                          <a className="table-action-link" href={api.artifactPreviewUrl(artifact.artifact_id)} target="_blank" rel="noreferrer">
                            Preview
                          </a>
                          <a className="table-action-link" href={api.artifactDownloadUrl(artifact.artifact_id)}>
                            Download
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Selected artifact storage" description="Raw source content is immutable; supported edits are metadata, review, and permissions.">
          {!selectedArtifact ? (
            <EmptyState title="Select an artifact" description="Choose a stored artifact to inspect its database and storage record." />
          ) : (
            <div className="stack-lg">
              <div className="artifact-action-strip">
                <a className="secondary-button" href={api.artifactPreviewUrl(selectedArtifact.artifact_id)} target="_blank" rel="noreferrer">
                  Preview source
                </a>
                <a className="secondary-button" href={api.artifactDownloadUrl(selectedArtifact.artifact_id)}>
                  Download source
                </a>
                <Link className="secondary-button" to="/artifacts">
                  Open artifact workspace
                </Link>
              </div>

              <dl className="meta-list">
                <div>
                  <dt>Logical locator</dt>
                  <dd>{selectedArtifact.logical_locator}</dd>
                </div>
                <div>
                  <dt>Source path</dt>
                  <dd>{selectedArtifact.source_path}</dd>
                </div>
                <div>
                  <dt>Checksum</dt>
                  <dd>{selectedArtifact.checksum_sha256 ?? 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Source type</dt>
                  <dd>{formatLabel(selectedArtifact.source_type)}</dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>{formatLabel(selectedArtifact.visibility_scope)}</dd>
                </div>
                <div>
                  <dt>Ingestion</dt>
                  <dd>
                    <StatusBadge value={selectedArtifact.ingestion_status} />
                  </dd>
                </div>
              </dl>

              <form className="form-grid panel-subtle" onSubmit={handleTitleSave}>
                <label className="field">
                  <span className="field-label">Artifact title</span>
                  <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} required />
                </label>
                <button type="submit" className="secondary-button" disabled={isBusy}>
                  {isBusy ? 'Saving…' : 'Save title'}
                </button>
              </form>

              <Callout>
                Source bytes are not edited in place. To change document contents, upload or paste a replacement artifact, then mark the old artifact rejected or restrict its visibility if needed.
              </Callout>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Database tables" description="Operational table inventory with row counts and the UI/API surfaces that write and read each area.">
        {!overview ? (
          <EmptyState title="Loading database overview" description="The table inventory will appear after the admin endpoint responds." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Rows</th>
                  <th>Write surface</th>
                  <th>Read surface</th>
                </tr>
              </thead>
              <tbody>
                {overview.tables.map((table) => (
                  <tr key={table.table_name}>
                    <td className="table-primary">{table.table_name}</td>
                    <td>{table.row_count}</td>
                    <td>{table.write_surface}</td>
                    <td>{table.read_surface}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="How this database is managed" description="Use supported application surfaces first; direct database tools are for operator diagnostics only.">
        <div className="detail-grid">
          <article className="panel-subtle detail-card">
            <p className="section-label">SQLite database</p>
            <p className="table-primary">{overview?.sqlite_path ?? 'Not loaded'}</p>
          </article>
          <article className="panel-subtle detail-card">
            <p className="section-label">Uploaded files</p>
            <p className="table-primary">{overview?.storage_root ?? 'Not loaded'}</p>
          </article>
          <article className="panel-subtle detail-card">
            <p className="section-label">Pasted text</p>
            <p className="table-primary">{overview?.pasted_text_root ?? 'Not loaded'}</p>
          </article>
        </div>
        <ul className="evidence-list">
          {(overview?.management_notes ?? []).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
