import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { useEffect, useMemo, useState, type FormEventHandler } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Callout, EmptyState, Panel, StatusBadge } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatDateTime, formatLabel } from "../lib/format";
import type {
  ArtifactDetail,
  ArtifactProactiveSignals,
  ArtifactRead,
  IngestionJobRead,
  MemoryFilesystemArtifact,
  MemoryFilesystemRead,
  OrchestrationJobRead,
  UserRead,
} from "../lib/types";

type VisibilityScope = "workspace" | "restricted";
type ReviewStatus = "submitted" | "needs_review" | "reviewed" | "rejected";

const defaultUploadState = {
  title: "",
  visibility_scope: "workspace" as VisibilityScope,
  permitted_user_ids: [] as string[],
};

const defaultPasteState = {
  title: "",
  text: "",
  visibility_scope: "workspace" as VisibilityScope,
  permitted_user_ids: [] as string[],
};

const defaultReviewState = {
  review_status: "submitted" as ReviewStatus,
  review_notes: "",
};

function sumMemoryCounts(artifact: MemoryFilesystemArtifact) {
  return Object.values(artifact.memory_counts).reduce(
    (total, value) => total + value,
    0,
  );
}

function signalCount(signals: ArtifactProactiveSignals | null, key: string) {
  return signals?.signal_counts[key] ?? 0;
}

export function ArtifactsPage() {
  const { session } = useAuth();
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([]);
  const [users, setUsers] = useState<UserRead[]>([]);
  const [memoryFilesystem, setMemoryFilesystem] =
    useState<MemoryFilesystemRead | null>(null);
  const [orchestrationJobs, setOrchestrationJobs] = useState<
    OrchestrationJobRead[]
  >([]);
  const [lastIngestionJob, setLastIngestionJob] =
    useState<IngestionJobRead | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>("");
  const [selectedArtifact, setSelectedArtifact] =
    useState<ArtifactDetail | null>(null);
  const [selectedArtifactSignals, setSelectedArtifactSignals] =
    useState<ArtifactProactiveSignals | null>(null);
  const [uploadState, setUploadState] = useState(defaultUploadState);
  const [pasteState, setPasteState] = useState(defaultPasteState);
  const [reviewState, setReviewState] = useState(defaultReviewState);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = session?.user.role === "Admin";

  async function loadMemorySurface(preferredArtifactId?: string) {
    if (!session?.token) {
      return;
    }

    const [artifactList, filesystem, jobList] = await Promise.all([
      api.listArtifacts(session.token),
      api.getMemoryFilesystem(session.token),
      api.listOrchestrationJobs(session.token, 8).catch(() => null),
    ]);
    setArtifacts(artifactList);
    setMemoryFilesystem(filesystem);
    setOrchestrationJobs(jobList?.jobs ?? []);

    const candidateId = preferredArtifactId || selectedArtifactId;
    const nextSelected = artifactList.some(
      (artifact) => artifact.artifact_id === candidateId,
    )
      ? candidateId
      : artifactList[0]?.artifact_id || "";
    setSelectedArtifactId(nextSelected);

    if (nextSelected) {
      const [detail, signals] = await Promise.all([
        api.getArtifact(session.token, nextSelected),
        api.getArtifactSignals(session.token, nextSelected),
      ]);
      setSelectedArtifact(detail);
      setReviewState({
        review_status: detail.review_status as ReviewStatus,
        review_notes: detail.review_notes ?? "",
      });
      setSelectedArtifactSignals(signals);
    } else {
      setSelectedArtifact(null);
      setReviewState(defaultReviewState);
      setSelectedArtifactSignals(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session?.token) {
        return;
      }

      setError(null);

      try {
        await loadMemorySurface();
        if (isAdmin) {
          const userList = await api.listUsers(session.token);
          if (!cancelled) {
            setUsers(userList);
          }
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof ApiError
              ? caughtError.message
              : "Unable to load memory.",
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, session?.token]);

  const selectableUsers = useMemo(
    () => users.filter((user) => user.is_active),
    [users],
  );
  const selectedChunkProvenance = selectedArtifact?.chunk_provenance ?? [];
  const selectedPermittedUserIds = selectedArtifact?.permitted_user_ids ?? [];
  const selectedFilesystemArtifact = useMemo(
    () =>
      memoryFilesystem?.artifacts.find(
        (artifact) => artifact.artifact_id === selectedArtifactId,
      ) ?? null,
    [memoryFilesystem?.artifacts, selectedArtifactId],
  );

  const memoryStats = useMemo(() => {
    const filesystemArtifacts = memoryFilesystem?.artifacts ?? [];
    const sourceCount = filesystemArtifacts.length || artifacts.length;
    const chunkCount = filesystemArtifacts.reduce(
      (total, artifact) => total + artifact.chunk_count,
      0,
    );
    const memoryObjectCount = filesystemArtifacts.reduce(
      (total, artifact) => total + sumMemoryCounts(artifact),
      0,
    );
    const signalTotal = filesystemArtifacts.reduce(
      (total, artifact) => total + artifact.signal_count,
      0,
    );
    const needsReview = artifacts.filter(
      (artifact) =>
        artifact.review_status === "submitted" ||
        artifact.review_status === "needs_review",
    ).length;
    return {
      sourceCount,
      chunkCount,
      memoryObjectCount,
      signalTotal,
      needsReview,
    };
  }, [artifacts, memoryFilesystem?.artifacts]);

  const memoryVitals = useMemo(
    () => [
      { label: "sources", value: memoryStats.sourceCount },
      { label: "objects", value: memoryStats.memoryObjectCount },
      { label: "signals", value: memoryStats.signalTotal },
      { label: "review", value: memoryStats.needsReview },
    ],
    [memoryStats],
  );

  function toggleUserSelection(
    userId: string,
    state: string[],
    setter: (next: string[]) => void,
  ) {
    setter(
      state.includes(userId)
        ? state.filter((value) => value !== userId)
        : [...state, userId],
    );
  }

  const handleUpload: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!session?.token || !uploadFile) {
      setError("Choose a supported file before feeding memory.");
      return;
    }

    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const artifact = await api.uploadArtifact(session.token, {
        file: uploadFile,
        ...uploadState,
      });
      setUploadState(defaultUploadState);
      setUploadFile(null);
      await loadMemorySurface(artifact.artifact_id);
      setSuccess(
        "File added. Memory indexing started and the source is ready for preview/download.",
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Unable to upload source file.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handlePastedText: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!session?.token) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const artifact = await api.createPastedText(session.token, pasteState);
      setPasteState(defaultPasteState);
      await loadMemorySurface(artifact.artifact_id);
      setSuccess("Text note added. Memory indexing started.");
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Unable to submit text note.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  async function handleArtifactSelection(artifactId: string) {
    if (!session?.token) {
      return;
    }

    setSelectedArtifactId(artifactId);
    try {
      const [detail, signals] = await Promise.all([
        api.getArtifact(session.token, artifactId),
        api.getArtifactSignals(session.token, artifactId),
      ]);
      setSelectedArtifact(detail);
      setReviewState({
        review_status: detail.review_status as ReviewStatus,
        review_notes: detail.review_notes ?? "",
      });
      setSelectedArtifactSignals(signals);
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Unable to load source detail.",
      );
    }
  }

  async function handleRunIngestion() {
    if (!session?.token || !selectedArtifact) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const job = await api.runIngestion(
        session.token,
        selectedArtifact.artifact_id,
      );
      setLastIngestionJob(job);
      await loadMemorySurface(selectedArtifact.artifact_id);
      setSuccess("Memory processing completed for the selected source.");
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Unable to process source memory.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReviewUpdate() {
    if (!session?.token || !selectedArtifact) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const detail = await api.updateArtifactReview(
        session.token,
        selectedArtifact.artifact_id,
        {
          review_status: reviewState.review_status,
          review_notes: reviewState.review_notes.trim() || null,
        },
      );
      setSelectedArtifact(detail);
      setReviewState({
        review_status: detail.review_status as ReviewStatus,
        review_notes: detail.review_notes ?? "",
      });
      setArtifacts((current) =>
        current.map((artifact) =>
          artifact.artifact_id === detail.artifact_id
            ? {
                ...artifact,
                ingestion_status: detail.ingestion_status,
                review_status: detail.review_status,
                reviewed_by: detail.reviewed_by,
                reviewed_at: detail.reviewed_at,
                review_notes: detail.review_notes,
                updated_at: detail.updated_at,
              }
            : artifact,
        ),
      );
      await loadMemorySurface(detail.artifact_id);
      setSuccess("Trust state updated.");
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Unable to update trust state.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="stack-xl memory-page">
      <section className="memory-live-hero" aria-label="Living company memory">
        <div className="memory-heart-card">
          <div className="memory-heart-orb" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="memory-heart-copy">
            <p className="eyebrow">Memory</p>
            <h2>Living workspace memory</h2>
          </div>
        </div>

        <div className="memory-vitals-grid" aria-label="Memory vitals">
          {memoryVitals.map((vital) => (
            <article key={vital.label} className="memory-vital-card">
              <span>{vital.label}</span>
              <strong>{vital.value}</strong>
            </article>
          ))}
        </div>
      </section>

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {success ? <Callout>{success}</Callout> : null}

      <section className="memory-feed-station panel" aria-label="Feed memory">
        <div className="memory-feed-head">
          <div>
            <p className="eyebrow">Add source</p>
            <h3>File or note</h3>
          </div>
          <span>{isBusy ? "processing" : "ready"}</span>
        </div>

        <div className="memory-feed-cards">
          <form className="memory-feed-card" onSubmit={handleUpload}>
            <div className="memory-feed-card-head">
              <span aria-hidden="true">⇧</span>
              <strong>File</strong>
              <small>PDF · MD · TXT</small>
            </div>
            <label className="field memory-quiet-field">
              <span className="field-label">Title</span>
              <input
                value={uploadState.title}
                onChange={(event) =>
                  setUploadState((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="e.g. April coverage note"
                required
              />
            </label>
            <label className="field field-block memory-quiet-field">
              <span
                className={
                  uploadFile
                    ? "file-drop-zone file-drop-zone-active memory-drop-zone"
                    : "file-drop-zone memory-drop-zone"
                }
              >
                <span className="file-upload-icon" aria-hidden="true">
                  +
                </span>
                <span className="file-drop-copy">
                  <strong>
                    {uploadFile ? uploadFile.name : "Choose file"}
                  </strong>
                  <span>{uploadFile ? "Ready." : "Drag or click."}</span>
                </span>
                <input
                  className="file-input"
                  type="file"
                  accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf"
                  onChange={(event) =>
                    setUploadFile(event.target.files?.[0] ?? null)
                  }
                  required
                />
              </span>
            </label>
            <label className="field memory-quiet-field">
              <span className="field-label">Visibility</span>
              <select
                value={uploadState.visibility_scope}
                onChange={(event) =>
                  setUploadState((current) => ({
                    ...current,
                    visibility_scope: event.target.value as VisibilityScope,
                    permitted_user_ids:
                      event.target.value === "workspace"
                        ? []
                        : current.permitted_user_ids,
                  }))
                }
              >
                <option value="workspace">Workspace</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            {uploadState.visibility_scope === "restricted" &&
            selectableUsers.length > 0 ? (
              <fieldset className="choice-grid memory-people-grid">
                <legend className="field-label">People</legend>
                {selectableUsers.map((user) => (
                  <label key={user.user_id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={uploadState.permitted_user_ids.includes(
                        user.user_id,
                      )}
                      onChange={() =>
                        toggleUserSelection(
                          user.user_id,
                          uploadState.permitted_user_ids,
                          (next) =>
                            setUploadState((current) => ({
                              ...current,
                              permitted_user_ids: next,
                            })),
                        )
                      }
                    />
                    <span>{user.display_name}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? "Feeding…" : "Feed file"}
            </button>
          </form>

          <form
            className="memory-feed-card memory-feed-card-note"
            onSubmit={handlePastedText}
          >
            <div className="memory-feed-card-head">
              <span aria-hidden="true">✎</span>
              <strong>Note</strong>
              <small>meeting · handoff · decision</small>
            </div>
            <label className="field memory-quiet-field">
              <span className="field-label">Title</span>
              <input
                value={pasteState.title}
                onChange={(event) =>
                  setPasteState((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="e.g. Customer call summary"
                required
              />
            </label>
            <label className="field field-block memory-quiet-field">
              <span className="field-label">Text</span>
              <textarea
                value={pasteState.text}
                onChange={(event) =>
                  setPasteState((current) => ({
                    ...current,
                    text: event.target.value,
                  }))
                }
                rows={6}
                placeholder="Paste the useful part. Izge will keep provenance and permissions attached."
                required
              />
            </label>
            <label className="field memory-quiet-field">
              <span className="field-label">Visibility</span>
              <select
                value={pasteState.visibility_scope}
                onChange={(event) =>
                  setPasteState((current) => ({
                    ...current,
                    visibility_scope: event.target.value as VisibilityScope,
                    permitted_user_ids:
                      event.target.value === "workspace"
                        ? []
                        : current.permitted_user_ids,
                  }))
                }
              >
                <option value="workspace">Workspace</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            {pasteState.visibility_scope === "restricted" &&
            selectableUsers.length > 0 ? (
              <fieldset className="choice-grid memory-people-grid">
                <legend className="field-label">People</legend>
                {selectableUsers.map((user) => (
                  <label key={user.user_id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={pasteState.permitted_user_ids.includes(
                        user.user_id,
                      )}
                      onChange={() =>
                        toggleUserSelection(
                          user.user_id,
                          pasteState.permitted_user_ids,
                          (next) =>
                            setPasteState((current) => ({
                              ...current,
                              permitted_user_ids: next,
                            })),
                        )
                      }
                    />
                    <span>{user.display_name}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? "Feeding…" : "Feed note"}
            </button>
          </form>
        </div>
      </section>

      <div className="two-column-layout wide-right-column memory-source-grid">
        <Panel
          title="Sources"
          description="Click a source for details, preview, or download."
        >
          {artifacts.length === 0 ? (
            <EmptyState
              title="No sources available"
              description="Feed memory with a file or note."
            />
          ) : (
            <div className="memory-source-list">
              {artifacts.map((artifact) => (
                <details
                  key={artifact.artifact_id}
                  className={
                    artifact.artifact_id === selectedArtifactId
                      ? "memory-source-disclosure memory-source-disclosure-active"
                      : "memory-source-disclosure"
                  }
                  open={artifact.artifact_id === selectedArtifactId}
                >
                  <summary
                    onClick={() =>
                      void handleArtifactSelection(artifact.artifact_id)
                    }
                  >
                    <span className="memory-source-icon" aria-hidden="true">
                      {artifact.source_type === "pasted_text" ? "✎" : "▣"}
                    </span>
                    <span className="memory-source-summary-copy">
                      <strong>{artifact.title}</strong>
                      <small>{artifact.original_filename ?? "Pasted text"}</small>
                    </span>
                    <span className="memory-source-badges">
                      <StatusBadge value={formatLabel(artifact.ingestion_status)} />
                      <StatusBadge value={formatLabel(artifact.review_status)} />
                    </span>
                  </summary>
                  <div className="memory-source-details">
                    <dl className="meta-list compact-meta-list">
                      <div>
                        <dt>Type</dt>
                        <dd>{formatLabel(artifact.source_type)}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatDateTime(artifact.updated_at)}</dd>
                      </div>
                      <div>
                        <dt>Visibility</dt>
                        <dd>{formatLabel(artifact.visibility_scope)}</dd>
                      </div>
                    </dl>
                    <div
                      className="table-action-group"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <SourcePreviewButton artifactId={artifact.artifact_id} title={artifact.title} className="table-action-link">Preview</SourcePreviewButton>
                      <a
                        className="table-action-link"
                        href={api.artifactDownloadUrl(artifact.artifact_id)}
                      >
                        Download
                      </a>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Selected source"
          description="Storage, trust, extraction, and memory signals."
          aside={
            selectedArtifact && isAdmin ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleRunIngestion()}
                disabled={isBusy}
              >
                {isBusy ? "Processing…" : "Process now"}
              </button>
            ) : null
          }
        >
          {!selectedArtifact ? (
            <EmptyState
              title="Select a source"
              description="Choose a file or note to inspect."
            />
          ) : (
            <div className="stack-lg">
              <div className="memory-selected-head">
                <div>
                  <p className="section-label">
                    {selectedFilesystemArtifact?.retrieval_state ??
                      "Source record"}
                  </p>
                  <h3 className="memory-selected-title">
                    {selectedArtifact.title}
                  </h3>
                </div>
                <div className="artifact-action-strip">
                  <SourcePreviewButton artifactId={selectedArtifact.artifact_id} title={selectedArtifact.title} className="secondary-button">Preview</SourcePreviewButton>
                  <a
                    className="secondary-button"
                    href={api.artifactDownloadUrl(selectedArtifact.artifact_id)}
                  >
                    Download
                  </a>
                </div>
              </div>

              <dl className="meta-list compact-memory-meta">
                <div>
                  <dt>Visibility</dt>
                  <dd>{formatLabel(selectedArtifact.visibility_scope)}</dd>
                </div>
                <div>
                  <dt>Chunks</dt>
                  <dd>{selectedArtifact.chunk_count}</dd>
                </div>
                <div>
                  <dt>Memory objects</dt>
                  <dd>
                    {selectedFilesystemArtifact
                      ? sumMemoryCounts(selectedFilesystemArtifact)
                      : 0}
                  </dd>
                </div>
                <div>
                  <dt>Signals</dt>
                  <dd>{selectedFilesystemArtifact?.signal_count ?? 0}</dd>
                </div>
                <div>
                  <dt>Review</dt>
                  <dd>
                    <StatusBadge
                      value={formatLabel(selectedArtifact.review_status)}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Stored as</dt>
                  <dd>{selectedArtifact.original_filename ?? "Pasted text"}</dd>
                </div>
              </dl>

              <div className="memory-path-strip">
                {(
                  selectedFilesystemArtifact?.organization_path ?? [
                    "workspace",
                    "memory",
                    selectedArtifact.artifact_id,
                  ]
                ).map((part, index) => (
                  <span key={`${part}-${index}`}>{part}</span>
                ))}
              </div>

              {lastIngestionJob?.artifact_id ===
              selectedArtifact.artifact_id ? (
                <Callout>
                  Last job:{" "}
                  {formatLabel(lastIngestionJobStatus(lastIngestionJob))} ·{" "}
                  {lastIngestionJob.stage}
                </Callout>
              ) : null}

              <div className="panel-subtle stack-sm">
                <p className="section-label">Trust</p>
                {isAdmin ? (
                  <>
                    <label className="field">
                      <span className="field-label">Review status</span>
                      <select
                        value={reviewState.review_status}
                        onChange={(event) =>
                          setReviewState((current) => ({
                            ...current,
                            review_status: event.target.value as ReviewStatus,
                          }))
                        }
                      >
                        <option value="submitted">Submitted</option>
                        <option value="needs_review">Needs review</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </label>
                    <label className="field field-block">
                      <span className="field-label">Notes</span>
                      <textarea
                        value={reviewState.review_notes}
                        onChange={(event) =>
                          setReviewState((current) => ({
                            ...current,
                            review_notes: event.target.value,
                          }))
                        }
                        rows={3}
                        placeholder="Reason for trust, rejection, or review hold."
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleReviewUpdate()}
                      disabled={isBusy}
                    >
                      {isBusy ? "Updating…" : "Save trust state"}
                    </button>
                  </>
                ) : (
                  <p className="muted-copy">
                    {selectedArtifact.review_status === "reviewed"
                      ? "Reviewed source. Izge can cite it inside your permissions."
                      : "Visible source. Trust review is still marked in answers."}
                  </p>
                )}
              </div>

              <div className="panel-subtle stack-sm">
                <p className="section-label">Memory signals</p>
                {!selectedArtifactSignals ? (
                  <p className="muted-copy">
                    Signal summary is not loaded yet.
                  </p>
                ) : (
                  <>
                    <div className="memory-signal-grid">
                      <article>
                        <span>Contradictions</span>
                        <strong>
                          {signalCount(
                            selectedArtifactSignals,
                            "contradictions",
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>Drift</span>
                        <strong>
                          {signalCount(
                            selectedArtifactSignals,
                            "assumption_drift",
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>Superseded</span>
                        <strong>
                          {signalCount(
                            selectedArtifactSignals,
                            "supersessions",
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>Next</span>
                        <strong>
                          {signalCount(selectedArtifactSignals, "next_actions")}
                        </strong>
                      </article>
                    </div>
                    <p className="muted-copy">
                      {selectedArtifactSignals.summary}
                    </p>
                    {selectedArtifactSignals.persisted_signals
                      .slice(0, 3)
                      .map((signal) => (
                        <Link
                          key={signal.signal_id}
                          className="record-link panel-subtle"
                          to={`/signals/${signal.signal_id}`}
                        >
                          <div>
                            <p className="table-primary">{signal.title}</p>
                            <p className="table-secondary">
                              {formatLabel(signal.signal_type)} ·{" "}
                              {signal.related_topic}
                            </p>
                          </div>
                          <span className="table-secondary">Open</span>
                        </Link>
                      ))}
                  </>
                )}
              </div>

              <div className="panel-subtle">
                <p className="section-label">Preview text</p>
                <p className="evidence-block">
                  {selectedArtifact.extracted_text_preview ||
                    "No extracted text available yet."}
                </p>
              </div>

              <div className="panel-subtle stack-sm">
                <p className="section-label">Extraction path</p>
                {selectedChunkProvenance.length === 0 ? (
                  <p className="muted-copy">No chunk-level provenance yet.</p>
                ) : (
                  selectedChunkProvenance.slice(0, 4).map((chunk) => (
                    <article key={chunk.chunk_id} className="memory-chunk-row">
                      <strong>Chunk {chunk.sequence_number}</strong>
                      <span>
                        {chunk.extraction_method} · {chunk.extraction_status} ·{" "}
                        {chunk.extracted_object_count} objects
                      </span>
                      <small>{chunk.chunk_excerpt}</small>
                    </article>
                  ))
                )}
              </div>

              {selectedArtifact.visibility_scope === "restricted" ? (
                <div className="panel-subtle">
                  <p className="section-label">Permitted user IDs</p>
                  <p className="muted-copy">
                    {selectedPermittedUserIds.join(", ") ||
                      "No explicit users recorded."}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      {orchestrationJobs.length > 0 ? (
        <Panel
          title="Delegated memory work"
          description="Queue-backed packets the oracle path created for bounded follow-up."
        >
          <div className="memory-job-list">
            {orchestrationJobs.slice(0, 5).map((job) => (
              <article key={job.job_id} className="memory-job-card">
                <span>{formatLabel(job.status)}</span>
                <strong>
                  {job.stage_key
                    ? formatLabel(job.stage_key)
                    : formatLabel(job.job_kind)}
                </strong>
                <small>
                  {job.error_message ||
                    `Priority ${job.priority} · ${formatDateTime(job.updated_at)}`}
                </small>
              </article>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function lastIngestionJobStatus(job: IngestionJobRead) {
  return job.status || job.stage;
}
