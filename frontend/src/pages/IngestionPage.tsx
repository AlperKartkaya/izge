import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { ArtifactRead, IngestionJobRead } from '../lib/types'

export function IngestionPage() {
  const { session } = useAuth()
  const location = useLocation()
  const preferredArtifactId = (location.state as { artifactId?: string } | null)?.artifactId
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState(preferredArtifactId || '')
  const [job, setJob] = useState<IngestionJobRead | null>(null)
  const [manualJobId, setManualJobId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadArtifacts() {
      if (!session?.token) {
        return
      }

      try {
        const artifactList = await api.listArtifacts(session.token)
        if (!cancelled) {
          setArtifacts(artifactList)
          if (!selectedArtifactId) {
            setSelectedArtifactId(preferredArtifactId || artifactList[0]?.artifact_id || '')
          }
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load ingestion state.')
        }
      }
    }

    void loadArtifacts()

    return () => {
      cancelled = true
    }
  }, [preferredArtifactId, selectedArtifactId, session?.token])

  useEffect(() => {
    if (!session?.token || !job || !['pending', 'running'].includes(job.status)) {
      return
    }

    const intervalId = window.setInterval(async () => {
      try {
        const refreshed = await api.getIngestionJob(session.token, job.job_id)
        setJob(refreshed)
      } catch {
        window.clearInterval(intervalId)
      }
    }, 2500)

    return () => window.clearInterval(intervalId)
  }, [job, session?.token])

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.artifact_id === selectedArtifactId) || null,
    [artifacts, selectedArtifactId],
  )

  async function handleRunIngestion() {
    if (!session?.token || !selectedArtifactId) {
      setError('Choose an artifact before starting an ingestion run.')
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      const nextJob = await api.runIngestion(session.token, selectedArtifactId)
      setJob(nextJob)
      setManualJobId(nextJob.job_id)
      const artifactList = await api.listArtifacts(session.token)
      setArtifacts(artifactList)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to start ingestion run.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleFetchJob() {
    if (!session?.token || !manualJobId) {
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      setJob(await api.getIngestionJob(session.token, manualJobId))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load ingestion job.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Memory construction"
        title="Turn evidence into traceable memory objects"
        description="Create an ingestion run for a stored artifact, then inspect the persisted job record as text extraction, source chunks, and graph persistence make the reasoning substrate visible."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className="two-column-layout">
        <Panel title="Start memory build" description="Creates a new `/api/ingestion/run` job for the selected artifact.">
          {artifacts.length === 0 ? (
            <EmptyState title="No artifacts ready" description="Artifacts must be stored before you can run ingestion." />
          ) : (
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Artifact</span>
                <select value={selectedArtifactId} onChange={(event) => setSelectedArtifactId(event.target.value)}>
                  {artifacts.map((artifact) => (
                    <option key={artifact.artifact_id} value={artifact.artifact_id}>
                      {artifact.title}
                    </option>
                  ))}
                </select>
              </label>
              {selectedArtifact ? (
                <div className="panel-subtle">
                  <p className="table-primary">{selectedArtifact.title}</p>
                  <p className="muted-copy">Current ingestion status: {selectedArtifact.ingestion_status}</p>
                </div>
              ) : null}
              <button type="button" className="primary-button" onClick={() => void handleRunIngestion()} disabled={isBusy || !selectedArtifactId}>
                {isBusy ? 'Starting…' : 'Run ingestion'}
              </button>
            </div>
          )}
        </Panel>

        <Panel title="Inspect build job" description="Retrieve a specific job by ID if you want to re-open an existing run.">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Job ID</span>
              <input value={manualJobId} onChange={(event) => setManualJobId(event.target.value)} placeholder="job_…" />
            </label>
            <button type="button" className="secondary-button" onClick={() => void handleFetchJob()} disabled={isBusy || !manualJobId}>
              Load status
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Current memory build detail" description="Live view of the selected ingestion job record.">
        {!job ? (
          <EmptyState title="No job selected" description="Start an ingestion run or load a known job ID to inspect its current status." />
        ) : (
          <div className="stack-lg">
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">Job status</p>
                <StatusBadge value={job.status} />
                <p className="muted-copy">Stage: {job.stage}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Artifact</p>
                <p className="table-primary">{job.artifact_id}</p>
                <p className="muted-copy">Created {formatDateTime(job.created_at)}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Actor</p>
                <p className="table-primary">{job.created_by}</p>
                <p className="muted-copy">Updated {formatDateTime(job.updated_at)}</p>
              </article>
            </div>
            <div className="panel-subtle">
              <p className="section-label">Detail</p>
              <p className="muted-copy">{job.detail || 'No additional detail recorded by the backend.'}</p>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
