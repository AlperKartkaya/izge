import { useEffect, useMemo, useState, type FormEventHandler } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ArtifactDetail, ArtifactProactiveSignals, ArtifactRead, UserRead } from '../lib/types'

type VisibilityScope = 'workspace' | 'restricted'

const defaultUploadState = {
  title: '',
  visibility_scope: 'workspace' as VisibilityScope,
  permitted_user_ids: [] as string[],
}

const defaultPasteState = {
  title: '',
  text: '',
  visibility_scope: 'workspace' as VisibilityScope,
  permitted_user_ids: [] as string[],
}

export function ArtifactsPage() {
  const { session } = useAuth()
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [users, setUsers] = useState<UserRead[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>('')
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail | null>(null)
  const [selectedArtifactSignals, setSelectedArtifactSignals] = useState<ArtifactProactiveSignals | null>(null)
  const [uploadState, setUploadState] = useState(defaultUploadState)
  const [pasteState, setPasteState] = useState(defaultPasteState)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isAdmin = session?.user.role === 'Admin'

  async function loadArtifacts(preferredArtifactId?: string) {
    if (!session?.token) {
      return
    }

    const artifactList = await api.listArtifacts(session.token)
    setArtifacts(artifactList)
    const nextSelected = preferredArtifactId || selectedArtifactId || artifactList[0]?.artifact_id || ''
    setSelectedArtifactId(nextSelected)

    if (nextSelected) {
      const [detail, signals] = await Promise.all([
        api.getArtifact(session.token, nextSelected),
        api.getArtifactSignals(session.token, nextSelected),
      ])
      setSelectedArtifact(detail)
      setSelectedArtifactSignals(signals)
    } else {
      setSelectedArtifact(null)
      setSelectedArtifactSignals(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }

      setError(null)

      try {
        await loadArtifacts()
        if (isAdmin) {
          const userList = await api.listUsers(session.token)
          if (!cancelled) {
            setUsers(userList)
          }
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load artifacts.')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, selectedArtifactId, session?.token])

  const selectableUsers = useMemo(() => users.filter((user) => user.is_active), [users])
  const selectedChunkProvenance = selectedArtifact?.chunk_provenance ?? []
  const selectedPermittedUserIds = selectedArtifact?.permitted_user_ids ?? []

  function toggleUserSelection(userId: string, state: string[], setter: (next: string[]) => void) {
    setter(state.includes(userId) ? state.filter((value) => value !== userId) : [...state, userId])
  }

  const handleUpload: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token || !uploadFile) {
      setError('Choose a supported file before submitting.')
      return
    }

    setIsBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const artifact = await api.uploadArtifact(session.token, {
        file: uploadFile,
        ...uploadState,
      })
      setUploadState(defaultUploadState)
      setUploadFile(null)
      await loadArtifacts(artifact.artifact_id)
      setSuccess('File artifact stored and ready for ingestion.')
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to upload artifact.')
    } finally {
      setIsBusy(false)
    }
  }

  const handlePastedText: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token) {
      return
    }

    setIsBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const artifact = await api.createPastedText(session.token, pasteState)
      setPasteState(defaultPasteState)
      await loadArtifacts(artifact.artifact_id)
      setSuccess('Pasted text stored as a new artifact.')
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to submit pasted text.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleArtifactSelection(artifactId: string) {
    if (!session?.token) {
      return
    }

    setSelectedArtifactId(artifactId)
    try {
      const [detail, signals] = await Promise.all([
        api.getArtifact(session.token, artifactId),
        api.getArtifactSignals(session.token, artifactId),
      ])
      setSelectedArtifact(detail)
      setSelectedArtifactSignals(signals)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load artifact detail.')
    }
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Evidence intake"
        title="Load the record before the system reasons"
        description="Capture roadmap history, meeting notes, product decisions, and copied snippets as inspectable evidence. Izge does not reason from vibes; it reasons from artifacts."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {success ? <Callout>{success}</Callout> : null}

      <div className="two-column-layout">
        <Panel title="Upload source artifact" description="Accepted inputs match the MVP contract: Markdown, plain text, and text-extractable PDFs.">
          <form className="form-grid" onSubmit={handleUpload}>
            <label className="field">
              <span className="field-label">Title</span>
              <input
                value={uploadState.title}
                onChange={(event) => setUploadState((current) => ({ ...current, title: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">File</span>
              <input type="file" accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} required />
            </label>
            <label className="field">
              <span className="field-label">Visibility</span>
              <select
                value={uploadState.visibility_scope}
                onChange={(event) =>
                  setUploadState((current) => ({
                    ...current,
                    visibility_scope: event.target.value as VisibilityScope,
                    permitted_user_ids: event.target.value === 'workspace' ? [] : current.permitted_user_ids,
                  }))
                }
              >
                <option value="workspace">Workspace</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            {uploadState.visibility_scope === 'restricted' && selectableUsers.length > 0 ? (
              <fieldset className="choice-grid">
                <legend className="field-label">Permitted users</legend>
                {selectableUsers.map((user) => (
                  <label key={user.user_id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={uploadState.permitted_user_ids.includes(user.user_id)}
                      onChange={() =>
                        toggleUserSelection(user.user_id, uploadState.permitted_user_ids, (next) =>
                          setUploadState((current) => ({ ...current, permitted_user_ids: next })),
                        )
                      }
                    />
                    <span>{user.display_name}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? 'Submitting…' : 'Store artifact'}
            </button>
          </form>
        </Panel>

        <Panel title="Capture raw institutional memory" description="Use for meeting excerpts, copied notes, or historical snippets that should join the evidence record.">
          <form className="form-grid" onSubmit={handlePastedText}>
            <label className="field">
              <span className="field-label">Title</span>
              <input
                value={pasteState.title}
                onChange={(event) => setPasteState((current) => ({ ...current, title: event.target.value }))}
                required
              />
            </label>
            <label className="field field-block">
              <span className="field-label">Text</span>
              <textarea
                value={pasteState.text}
                onChange={(event) => setPasteState((current) => ({ ...current, text: event.target.value }))}
                rows={9}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Visibility</span>
              <select
                value={pasteState.visibility_scope}
                onChange={(event) =>
                  setPasteState((current) => ({
                    ...current,
                    visibility_scope: event.target.value as VisibilityScope,
                    permitted_user_ids: event.target.value === 'workspace' ? [] : current.permitted_user_ids,
                  }))
                }
              >
                <option value="workspace">Workspace</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            {pasteState.visibility_scope === 'restricted' && selectableUsers.length > 0 ? (
              <fieldset className="choice-grid">
                <legend className="field-label">Permitted users</legend>
                {selectableUsers.map((user) => (
                  <label key={user.user_id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={pasteState.permitted_user_ids.includes(user.user_id)}
                      onChange={() =>
                        toggleUserSelection(user.user_id, pasteState.permitted_user_ids, (next) =>
                          setPasteState((current) => ({ ...current, permitted_user_ids: next })),
                        )
                      }
                    />
                    <span>{user.display_name}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? 'Submitting…' : 'Store pasted text'}
            </button>
          </form>
        </Panel>
      </div>

      <div className="two-column-layout wide-right-column">
        <Panel title="Evidence inventory" description="Visible artifacts and their current ingestion state.">
          {artifacts.length === 0 ? (
            <EmptyState title="No artifacts available" description="Add a file or pasted text artifact to begin populating evidence." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {artifacts.map((artifact) => (
                    <tr
                      key={artifact.artifact_id}
                      className={artifact.artifact_id === selectedArtifactId ? 'row-selected' : undefined}
                      onClick={() => void handleArtifactSelection(artifact.artifact_id)}
                    >
                      <td>
                        <div>
                          <p className="table-primary">{artifact.title}</p>
                          <p className="table-secondary">{artifact.artifact_id}</p>
                        </div>
                      </td>
                      <td>{artifact.source_type}</td>
                      <td>
                        <StatusBadge value={artifact.ingestion_status} />
                      </td>
                      <td>{formatDateTime(artifact.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Selected evidence detail" description="Detail pane backed by `/api/artifacts/:id`, including provenance and extraction state.">
          {!selectedArtifact ? (
            <EmptyState title="Select an artifact" description="Choose an artifact from the inventory to inspect extracted text previews and permissions." />
          ) : (
            <div className="stack-lg">
              <dl className="meta-list">
                <div>
                  <dt>Artifact ID</dt>
                  <dd>{selectedArtifact.artifact_id}</dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>{selectedArtifact.visibility_scope}</dd>
                </div>
                <div>
                  <dt>Chunks</dt>
                  <dd>{selectedArtifact.chunk_count}</dd>
                </div>
                <div>
                  <dt>Original file</dt>
                  <dd>{selectedArtifact.original_filename ?? 'Pasted text'}</dd>
                </div>
              </dl>
              <div className="panel-subtle">
                <p className="section-label">Extracted text preview</p>
                <p className="evidence-block">{selectedArtifact.extracted_text_preview || 'No extracted text available yet.'}</p>
              </div>
              <div className="panel-subtle stack-sm">
                <p className="section-label">What this artifact changed</p>
                {!selectedArtifactSignals ? (
                  <p className="muted-copy">Proactive signal summary is not loaded yet.</p>
                ) : (
                  <>
                    <p className="muted-copy">{selectedArtifactSignals.summary}</p>
                    <div className="detail-grid">
                      <article className="panel-subtle detail-card">
                        <p className="section-label">Contradictions</p>
                        <p className="table-primary">{selectedArtifactSignals.signal_counts.contradictions ?? 0}</p>
                      </article>
                      <article className="panel-subtle detail-card">
                        <p className="section-label">Drift</p>
                        <p className="table-primary">{selectedArtifactSignals.signal_counts.assumption_drift ?? 0}</p>
                      </article>
                      <article className="panel-subtle detail-card">
                        <p className="section-label">Supersessions</p>
                        <p className="table-primary">{selectedArtifactSignals.signal_counts.supersessions ?? 0}</p>
                      </article>
                      <article className="panel-subtle detail-card">
                        <p className="section-label">Next actions</p>
                        <p className="table-primary">{selectedArtifactSignals.signal_counts.next_actions ?? 0}</p>
                      </article>
                    </div>

                    {selectedArtifactSignals.introduced_contradictions.slice(0, 2).map((item) => (
                      <article key={item.edge_id} className="panel-subtle stack-sm critical-card">
                        <p className="section-label">Introduced contradiction</p>
                        <p className="table-primary">{item.from_title} ↔ {item.to_title}</p>
                        <p className="table-secondary">Topic {item.topic_key} · confidence {formatPercent(item.confidence_score)}</p>
                        <p className="muted-copy">{item.evidence_provenance}</p>
                      </article>
                    ))}

                    {selectedArtifactSignals.revealed_assumption_drift.slice(0, 2).map((item) => (
                      <article key={item.assumption_id} className="panel-subtle stack-sm drift-card">
                        <p className="section-label">Revealed drift</p>
                        <p className="table-primary">{item.title_or_label}</p>
                        <p className="table-secondary">Status {formatLabel(item.status)} · topic {item.topic_key}</p>
                        <p className="muted-copy">{item.evidence_provenance || item.validity_notes}</p>
                      </article>
                    ))}

                    {selectedArtifactSignals.superseded_memory.slice(0, 2).map((item) => (
                      <article key={item.edge_id} className="panel-subtle stack-sm">
                        <p className="section-label">Supersession / reopening</p>
                        <p className="table-primary">{item.from_title} supersedes {item.to_title}</p>
                        <p className="table-secondary">Topic {item.topic_key} · confidence {formatPercent(item.confidence_score)}</p>
                        <p className="muted-copy">{item.evidence_provenance}</p>
                      </article>
                    ))}

                    {selectedArtifactSignals.recommended_next_actions.slice(0, 2).map((item) => (
                      <article key={item.signal_id} className="panel-subtle stack-sm action-card">
                        <p className="section-label">Grounded next action</p>
                        <p className="table-primary">{item.title}</p>
                        <p className="evidence-block">{item.recommended_action}</p>
                        <p className="table-secondary">Urgency {formatPercent(item.urgency_score)} · uncertainty {formatPercent(item.uncertainty_score)}</p>
                      </article>
                    ))}
                  </>
                )}
              </div>
              <div className="panel-subtle stack-sm">
                <p className="section-label">Chunk extraction provenance</p>
                {selectedChunkProvenance.length === 0 ? (
                  <p className="muted-copy">No chunk-level provenance is available until ingestion has processed this artifact.</p>
                ) : (
                  selectedChunkProvenance.map((chunk) => (
                    <article key={chunk.chunk_id} className="panel-subtle stack-sm">
                      <p className="table-primary">Chunk {chunk.sequence_number}</p>
                      <p className="table-secondary">
                        Method {chunk.extraction_method} · Status {chunk.extraction_status} · Objects {chunk.extracted_object_count}
                      </p>
                      <p className="muted-copy">{chunk.chunk_excerpt}</p>
                      {chunk.fallback_reason ? <p className="table-secondary">Fallback: {chunk.fallback_reason}</p> : null}
                    </article>
                  ))
                )}
              </div>
              {selectedArtifact.visibility_scope === 'restricted' ? (
                <div className="panel-subtle">
                  <p className="section-label">Permitted user IDs</p>
                  <p className="muted-copy">{selectedPermittedUserIds.join(', ') || 'No explicit users recorded.'}</p>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
