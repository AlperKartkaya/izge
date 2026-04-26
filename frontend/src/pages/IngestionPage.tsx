import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ArtifactProactiveSignals, ArtifactRead, IngestionJobRead } from '../lib/types'

export function IngestionPage() {
  const { session } = useAuth()
  const location = useLocation()
  const preferredArtifactId = (location.state as { artifactId?: string } | null)?.artifactId
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState(preferredArtifactId || '')
  const [job, setJob] = useState<IngestionJobRead | null>(null)
  const [artifactSignals, setArtifactSignals] = useState<ArtifactProactiveSignals | null>(null)
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
      const [artifactList, signals] = await Promise.all([
        api.listArtifacts(session.token),
        api.getArtifactSignals(session.token, selectedArtifactId),
      ])
      setArtifacts(artifactList)
      setArtifactSignals(signals)
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
      const nextJob = await api.getIngestionJob(session.token, manualJobId)
      setJob(nextJob)
      setArtifactSignals(await api.getArtifactSignals(session.token, nextJob.artifact_id))
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
              <select
                value={selectedArtifactId}
                onChange={(event) => {
                  setSelectedArtifactId(event.target.value)
                  setArtifactSignals(null)
                }}
              >
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

      <Panel title="Proactive output from this ingestion" description="Artifact-scoped contradiction, drift, supersession, and next-action signals generated against existing memory.">
        {!artifactSignals ? (
          <EmptyState title="No artifact signal summary loaded" description="Run ingestion or load a job to see what the artifact changed in the memory graph." />
        ) : (
          <div className="stack-lg">
            <div className="panel-subtle">
              <p className="section-label">Artifact impact summary</p>
              <p className="muted-copy">{artifactSignals.summary}</p>
            </div>
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">Contradictions</p>
                <p className="table-primary">{artifactSignals.signal_counts.contradictions ?? 0}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Drift</p>
                <p className="table-primary">{artifactSignals.signal_counts.assumption_drift ?? 0}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Supersessions</p>
                <p className="table-primary">{artifactSignals.signal_counts.supersessions ?? 0}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">Next actions</p>
                <p className="table-primary">{artifactSignals.signal_counts.next_actions ?? 0}</p>
              </article>
            </div>

            {artifactSignals.persisted_signals.length > 0 ? (
              <div className="stack-sm">
                <p className="section-label">Durable signals created from this artifact</p>
                {artifactSignals.persisted_signals.slice(0, 5).map((signal) => (
                  <Link key={signal.signal_id} className="record-link panel-subtle" to={`/signals/${signal.signal_id}`}>
                    <div>
                      <p className="table-primary">{signal.title}</p>
                      <p className="table-secondary">
                        {formatLabel(signal.signal_type)} · urgency {formatPercent(signal.urgency_score)}
                      </p>
                    </div>
                    <span className="table-secondary">Open intelligence path</span>
                  </Link>
                ))}
              </div>
            ) : null}

            {artifactSignals.introduced_contradictions.length === 0 &&
            artifactSignals.revealed_assumption_drift.length === 0 &&
            artifactSignals.superseded_memory.length === 0 &&
            artifactSignals.recommended_next_actions.length === 0 ? (
              <EmptyState title="No grounded proactive signals" description="This artifact was ingested, but no contradiction, drift, supersession, or next action could be justified from visible evidence." />
            ) : (
              <div className="stack-md">
                {artifactSignals.introduced_contradictions.slice(0, 2).map((item) => (
                  <article key={item.edge_id} className="panel-subtle stack-sm critical-card">
                    <p className="section-label">Contradiction introduced by this artifact</p>
                    <p className="table-primary">{item.from_title} ↔ {item.to_title}</p>
                    <p className="muted-copy">{item.evidence_provenance}</p>
                  </article>
                ))}
                {artifactSignals.revealed_assumption_drift.slice(0, 2).map((item) => (
                  <article key={item.assumption_id} className="panel-subtle stack-sm drift-card">
                    <p className="section-label">Assumption drift revealed</p>
                    <p className="table-primary">{item.title_or_label}</p>
                    <p className="table-secondary">Status {formatLabel(item.status)} · topic {item.topic_key}</p>
                    <p className="muted-copy">{item.evidence_provenance || item.validity_notes}</p>
                  </article>
                ))}
                {artifactSignals.superseded_memory.slice(0, 2).map((item) => (
                  <article key={item.edge_id} className="panel-subtle stack-sm">
                    <p className="section-label">Supersession / reopening</p>
                    <p className="table-primary">{item.from_title} supersedes {item.to_title}</p>
                    <p className="muted-copy">{item.evidence_provenance}</p>
                  </article>
                ))}
                {artifactSignals.recommended_next_actions.slice(0, 3).map((item) => (
                  <article key={item.signal_id} className="panel-subtle stack-sm action-card">
                    <p className="section-label">Grounded next action · urgency {formatPercent(item.urgency_score)}</p>
                    <p className="table-primary">{item.title}</p>
                    <p className="evidence-block">{item.recommended_action}</p>
                    <p className="muted-copy">{item.grounded_reasoning}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
