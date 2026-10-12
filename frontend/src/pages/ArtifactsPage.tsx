import { translate } from '../lib/language'
import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { useEffect, useMemo, useState, type FormEventHandler } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatDateTime, formatLabel } from "../lib/format";
import { useLanguage } from '../lib/i18n'
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
  const { t } = useLanguage()
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
              : translate("Unable to load memory.", "Hafıza yüklenemedi."),
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
      setError(translate("Choose a supported file before feeding memory.", "Hafızaya eklemeden önce desteklenen bir dosya seçin."));
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
        translate("File added. Memory indexing started and the source is ready for preview/download.", "Dosya eklendi. Hafıza işleme başladı; kaynak önizlemeye ve indirmeye hazır."),
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : translate("Unable to upload source file.", "Kaynak dosyası yüklenemedi."),
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
      setSuccess(translate("Text note added. Memory indexing started.", "Metin notu eklendi. Hafıza işleme başladı."));
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : translate("Unable to submit text note.", "Metin notu kaydedilemedi."),
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
          : translate("Unable to load source detail.", "Kaynak ayrıntıları yüklenemedi."),
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
      setSuccess(translate("Memory processing completed for the selected source.", "Seçilen kaynak hafızaya işlendi."));
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : translate("Unable to process source memory.", "Kaynak hafızaya işlenemedi."),
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
      setSuccess(translate("Trust state updated.", "Güven durumu güncellendi."));
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : translate("Unable to update trust state.", "Güven durumu güncellenemedi."),
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="stack-xl memory-page">
      <PageIntro
        title={t('Company memory', 'Şirket hafızası')}
        description={t('Review sources, permissions, trust, and extracted evidence.', 'Kaynakları, izinleri, güven durumunu ve çıkarılan kanıtları yönetin.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {success ? <Callout>{success}</Callout> : null}

      <details className="reasoning-disclosure">
        <summary>{t('Add a source', 'Kaynak ekle')}</summary>
      <section className="memory-feed-station" aria-label={t('Add a source', 'Kaynak ekle')}>
        <div className="memory-feed-head">
          <div>
            <h3>{t('File or note', 'Dosya veya not')}</h3>
          </div>
          <span>{isBusy ? t('Processing', 'İşleniyor') : t('Ready', 'Hazır')}</span>
        </div>

        <div className="memory-feed-cards">
          <form className="memory-feed-card" onSubmit={handleUpload}>
            <div className="memory-feed-card-head">
              <strong>{t('File', 'Dosya')}</strong>
              <small>PDF · MD · TXT</small>
            </div>
            <label className="field memory-quiet-field">
              <span className="field-label">{t('Title', 'Başlık')}</span>
              <input
                name="upload_title"
                autoComplete="off"
                value={uploadState.title}
                onChange={(event) =>
                  setUploadState((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={t('e.g. April coverage note…', 'Örn. Nisan kapsam notu…')}
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
                <span className="file-drop-copy">
                  <strong>
                    {uploadFile ? uploadFile.name : translate("Choose file", "Dosya seç")}
                  </strong>
                  <span>{uploadFile ? t('Ready', 'Hazır') : t('Drag or click', 'Sürükleyin veya tıklayın')}</span>
                </span>
                <input
                  className="file-input"
                  name="upload_file"
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
              <span className="field-label">{t('Visibility', 'Görünürlük')}</span>
              <select
                name="upload_visibility"
                autoComplete="off"
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
                <option value="workspace">{t('Workspace', 'Çalışma alanı')}</option>
                <option value="restricted">{t('Restricted', 'Kısıtlı')}</option>
              </select>
            </label>
            {uploadState.visibility_scope === "restricted" &&
            selectableUsers.length > 0 ? (
              <fieldset className="choice-grid memory-people-grid">
                <legend className="field-label">{t('People', 'Kişiler')}</legend>
                {selectableUsers.map((user) => (
                  <label key={user.user_id} className="checkbox-row">
                    <input
                      name="upload_permitted_users"
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
              {isBusy ? t('Adding…', 'Ekleniyor…') : t('Add file', 'Dosyayı ekle')}
            </button>
          </form>

          <form
            className="memory-feed-card memory-feed-card-note"
            onSubmit={handlePastedText}
          >
            <div className="memory-feed-card-head">
              <strong>{t('Note', 'Not')}</strong>
              <small>{t('Meeting, handoff, or decision', 'Toplantı, devir veya karar')}</small>
            </div>
            <label className="field memory-quiet-field">
              <span className="field-label">{t('Title', 'Başlık')}</span>
              <input
                name="note_title"
                autoComplete="off"
                value={pasteState.title}
                onChange={(event) =>
                  setPasteState((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={t('e.g. Customer call summary…', 'Örn. Müşteri görüşmesi özeti…')}
                required
              />
            </label>
            <label className="field field-block memory-quiet-field">
              <span className="field-label">{t('Text', 'Metin')}</span>
              <textarea
                name="note_text"
                autoComplete="off"
                value={pasteState.text}
                onChange={(event) =>
                  setPasteState((current) => ({
                    ...current,
                    text: event.target.value,
                  }))
                }
                rows={6}
                placeholder={t('Paste the useful part…', 'Yararlı bölümü yapıştırın…')}
                required
              />
            </label>
            <label className="field memory-quiet-field">
              <span className="field-label">{t('Visibility', 'Görünürlük')}</span>
              <select
                name="note_visibility"
                autoComplete="off"
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
                <option value="workspace">{t('Workspace', 'Çalışma alanı')}</option>
                <option value="restricted">{t('Restricted', 'Kısıtlı')}</option>
              </select>
            </label>
            {pasteState.visibility_scope === "restricted" &&
            selectableUsers.length > 0 ? (
              <fieldset className="choice-grid memory-people-grid">
                <legend className="field-label">{t('People', 'Kişiler')}</legend>
                {selectableUsers.map((user) => (
                  <label key={user.user_id} className="checkbox-row">
                    <input
                      name="note_permitted_users"
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
              {isBusy ? t('Adding…', 'Ekleniyor…') : t('Add note', 'Notu ekle')}
            </button>
          </form>
        </div>
      </section>
      </details>

      <div className="two-column-layout wide-right-column memory-source-grid">
        <Panel
          title={t('Sources', 'Kaynaklar')}
          description={t('Click a source for details, preview, or download.', 'Ayrıntı, önizleme veya indirme için bir kaynağa tıklayın.')}
        >
          {artifacts.length === 0 ? (
            <EmptyState
              title={t('No sources available', 'Kullanılabilir kaynak yok')}
              description={t('Feed memory with a file or note.', 'Hafızayı bir dosya veya notla besleyin.')}
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
                    <span className="memory-source-summary-copy">
                      <strong>{artifact.title}</strong>
                      <small>{artifact.original_filename ?? translate("Pasted text", "Yapıştırılan metin")}</small>
                    </span>
                    <span className="memory-source-badges">
                      <StatusBadge value={artifact.ingestion_status} />
                      <StatusBadge value={artifact.review_status} />
                    </span>
                  </summary>
                  <div className="memory-source-details">
                    <dl className="meta-list compact-meta-list">
                      <div>
                        <dt>{t('Type', 'Tür')}</dt>
                        <dd>{formatLabel(artifact.source_type)}</dd>
                      </div>
                      <div>
                        <dt>{t('Updated', 'Güncellendi')}</dt>
                        <dd>{formatDateTime(artifact.updated_at)}</dd>
                      </div>
                      <div>
                        <dt>{t('Visibility', 'Görünürlük')}</dt>
                        <dd>{formatLabel(artifact.visibility_scope)}</dd>
                      </div>
                    </dl>
                    <div
                      className="table-action-group"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <SourcePreviewButton artifactId={artifact.artifact_id} title={artifact.title} className="table-action-link">{t('Preview', 'Önizle')}</SourcePreviewButton>
                      <a
                        className="table-action-link"
                        href={api.artifactDownloadUrl(artifact.artifact_id)}
                      >{t("Download", "İndir")}</a>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={t('Selected source', 'Seçilen kaynak')}
          description={t('Storage, trust, extraction, and memory signals.', 'Depolama, güven, çıkarım ve hafıza sinyalleri.')}
          aside={
            selectedArtifact && isAdmin ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleRunIngestion()}
                disabled={isBusy}
              >
                {isBusy ? t('Processing…', 'İşleniyor…') : t('Process now', 'Şimdi işle')}
              </button>
            ) : null
          }
        >
          {!selectedArtifact ? (
            <EmptyState
              title={t('Select a source', 'Bir kaynak seçin')}
              description={t('Choose a file or note to inspect.', 'İncelemek için bir dosya veya not seçin.')}
            />
          ) : (
            <div className="stack-lg">
              <div className="memory-selected-head">
                <div>
                  <p className="section-label">
                    {selectedFilesystemArtifact?.retrieval_state ??
                      translate("Source record", "Kaynak kaydı")}
                  </p>
                  <h3 className="memory-selected-title">
                    {selectedArtifact.title}
                  </h3>
                </div>
                <div className="artifact-action-strip">
                  <SourcePreviewButton artifactId={selectedArtifact.artifact_id} title={selectedArtifact.title} className="secondary-button">{t('Preview', 'Önizle')}</SourcePreviewButton>
                  <a
                    className="secondary-button"
                    href={api.artifactDownloadUrl(selectedArtifact.artifact_id)}
                  >{t("Download", "İndir")}</a>
                </div>
              </div>

              <dl className="meta-list compact-memory-meta">
                <div>
                  <dt>{t('Visibility', 'Görünürlük')}</dt>
                  <dd>{formatLabel(selectedArtifact.visibility_scope)}</dd>
                </div>
                <div>
                  <dt>{t('Chunks', 'Bölümler')}</dt>
                  <dd>{selectedArtifact.chunk_count}</dd>
                </div>
                <div>
                  <dt>{t('Memory objects', 'Hafıza nesneleri')}</dt>
                  <dd>
                    {selectedFilesystemArtifact
                      ? sumMemoryCounts(selectedFilesystemArtifact)
                      : 0}
                  </dd>
                </div>
                <div>
                  <dt>{t('Signals', 'Sinyaller')}</dt>
                  <dd>{selectedFilesystemArtifact?.signal_count ?? 0}</dd>
                </div>
                <div>
                  <dt>{t('Review', 'İnceleme')}</dt>
                  <dd>
                    <StatusBadge
                      value={selectedArtifact.review_status}
                    />
                  </dd>
                </div>
                <div>
                  <dt>{t('Stored as', 'Saklama biçimi')}</dt>
                  <dd>{selectedArtifact.original_filename ?? translate("Pasted text", "Yapıştırılan metin")}</dd>
                </div>
              </dl>

              <div className="memory-path-strip">
                {(
                  selectedFilesystemArtifact?.organization_path ?? [
                    "workspace",
                    'memory',
                    selectedArtifact.artifact_id,
                  ]
                ).map((part, index) => (
                  <span key={`${part}-${index}`}>{part}</span>
                ))}
              </div>

              {lastIngestionJob?.artifact_id ===
              selectedArtifact.artifact_id ? (
                <Callout>{t("Last job:", "Son iş:")}{" "}
                  {formatLabel(lastIngestionJobStatus(lastIngestionJob))} ·{" "}
                  {lastIngestionJob.stage}
                </Callout>
              ) : null}

              <div className="panel-subtle stack-sm">
                <p className="section-label">{t('Trust', 'Güven')}</p>
                {isAdmin ? (
                  <>
                    <label className="field">
                      <span className="field-label">{t('Review status', 'İnceleme durumu')}</span>
                      <select
                        name="review_status"
                        autoComplete="off"
                        value={reviewState.review_status}
                        onChange={(event) =>
                          setReviewState((current) => ({
                            ...current,
                            review_status: event.target.value as ReviewStatus,
                          }))
                        }
                      >
                        <option value="submitted">{t('Submitted', 'Gönderildi')}</option>
                        <option value="needs_review">{t('Needs review', 'İnceleme gerekli')}</option>
                        <option value="reviewed">{t('Reviewed', 'İncelendi')}</option>
                        <option value="rejected">{t('Rejected', 'Reddedildi')}</option>
                      </select>
                    </label>
                    <label className="field field-block">
                      <span className="field-label">{t('Notes', 'Notlar')}</span>
                      <textarea
                        name="review_notes"
                        autoComplete="off"
                        value={reviewState.review_notes}
                        onChange={(event) =>
                          setReviewState((current) => ({
                            ...current,
                            review_notes: event.target.value,
                          }))
                        }
                        rows={3}
                        placeholder={t('Reason for trust, rejection, or review hold…', 'Güven, ret veya inceleme bekletme nedeni…')}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleReviewUpdate()}
                      disabled={isBusy}
                    >
                      {isBusy ? t('Updating…', 'Güncelleniyor…') : t('Save trust state', 'Güven durumunu kaydet')}
                    </button>
                  </>
                ) : (
                  <p className="muted-copy">
                    {selectedArtifact.review_status === "reviewed"
                      ? translate("Reviewed source. Izge can cite it inside your permissions.", "İncelenen kaynak. İzge bu kaynağı izinleriniz kapsamında referans gösterebilir.")
                      : translate("Visible source. Trust review is still marked in answers.", "Görünen kaynak. Güven incelemesi yanıtlarda belirtilmeye devam eder.")}
                  </p>
                )}
              </div>

              <div className="panel-subtle stack-sm">
                <p className="section-label">{t('Memory signals', 'Hafıza sinyalleri')}</p>
                {!selectedArtifactSignals ? (
                  <p className="muted-copy">{t("Signal summary is not loaded yet.", "Sinyal özeti henüz yüklenmedi.")}</p>
                ) : (
                  <>
                    <div className="memory-signal-grid">
                      <article>
                        <span>{t('Contradictions', 'Çelişkiler')}</span>
                        <strong>
                          {signalCount(
                            selectedArtifactSignals,
                            translate("contradictions", "çelişki"),
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>{t('Drift', 'Değişim')}</span>
                        <strong>
                          {signalCount(
                            selectedArtifactSignals,
                            "assumption_drift",
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>{t('Superseded', 'Yerine geçti')}</span>
                        <strong>
                          {signalCount(
                            selectedArtifactSignals,
                            translate("supersessions", "güncellenen karar"),
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>{t('Next', 'Sonraki')}</span>
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
                          <span className="table-secondary">{t('Open', 'Aç')}</span>
                        </Link>
                      ))}
                  </>
                )}
              </div>

              <div className="panel-subtle">
                <p className="section-label">{t('Preview text', 'Metin önizlemesi')}</p>
                <p className="evidence-block">
                  {selectedArtifact.extracted_text_preview ||
                    translate("No extracted text available yet.", "Henüz çıkarılmış metin yok.")}
                </p>
              </div>

              <div className="panel-subtle stack-sm">
                <p className="section-label">{t('Extraction path', 'Çıkarım yolu')}</p>
                {selectedChunkProvenance.length === 0 ? (
                  <p className="muted-copy">{t('No chunk-level provenance yet.', 'Henüz bölüm düzeyinde kaynak bilgisi yok.')}</p>
                ) : (
                  selectedChunkProvenance.slice(0, 4).map((chunk) => (
                    <article key={chunk.chunk_id} className="memory-chunk-row">
                      <strong>{t("Chunk ", "Parça ")}{chunk.sequence_number}</strong>
                      <span>
                        {chunk.extraction_method} · {chunk.extraction_status} ·{" "}
                        {chunk.extracted_object_count}{t("objects", "nesne")}</span>
                      <small>{chunk.chunk_excerpt}</small>
                    </article>
                  ))
                )}
              </div>

              {selectedArtifact.visibility_scope === "restricted" ? (
                <div className="panel-subtle">
                  <p className="section-label">{t('Permitted user IDs', 'İzinli kullanıcı kimlikleri')}</p>
                  <p className="muted-copy">
                    {selectedPermittedUserIds.join(", ") ||
                      translate("No explicit users recorded.", "Kayıtlı kullanıcı yok.")}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      {orchestrationJobs.length > 0 ? (
        <Panel
          title={t('Delegated memory work', 'Devredilen hafıza işi')}
          description={t('Queue-backed packets created for bounded follow-up.', 'Sınırlı takip için oluşturulan kuyruk destekli paketler.')}
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
