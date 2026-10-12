import { SourcePreviewButton } from '../components/SourcePreviewButton'
import { useEffect, useMemo, useState, type FormEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel } from '../lib/format'
import type { ArtifactStorageAdminRead, DatabaseOverviewRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'
import { filterSourceList } from '../lib/sourceList'
import { Select } from '../components/Select'

function formatBytes(value: number | null, missing: string): string {
  if (value === null) {
    return missing
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
  const { t } = useLanguage()
  const { session } = useAuth()
  const isAdmin = session?.user.role === 'Admin'
  const [overview, setOverview] = useState<DatabaseOverviewRead | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState('')
  const [sourceSearch, setSourceSearch] = useState('')
  const [sourceSort, setSourceSort] = useState<'title' | 'recent'>('recent')
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
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load database overview.', 'Veritabanı özeti yüklenemedi.'))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [isAdmin, session?.token, t])

  const selectedArtifact = useMemo<ArtifactStorageAdminRead | null>(
    () => overview?.artifacts.find((artifact) => artifact.artifact_id === selectedArtifactId) ?? null,
    [overview?.artifacts, selectedArtifactId],
  )

  const visibleArtifacts = filterSourceList(overview?.artifacts ?? [], sourceSearch, sourceSort, t('en-GB', 'tr-TR'))

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
      setSuccess(t('Artifact title updated. Source content remains unchanged.', 'Kaynak başlığı güncellendi. Kaynak içeriği değişmedi.'))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to update artifact metadata.', 'Kaynak üst verisi güncellenemedi.'))
    } finally {
      setIsBusy(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="stack-xl data-admin-page">
        <PageIntro
          eyebrow={t('Admin data', 'Yönetici verileri')}
          title={t('Database inspection requires an admin account', 'Veritabanı incelemesi için yönetici hesabı gerekir')}
          description={t('Ask an admin to inspect stored artifacts, database row counts, and storage paths.', 'Kayıtlı kaynakları, veritabanı satır sayılarını ve depolama yollarını incelemek için bir yöneticiye başvurun.')}
        />
        <Callout tone="warning">{t('Your current role does not allow database administration.', 'Mevcut rolünüz veritabanı yönetimine izin vermiyor.')}</Callout>
      </div>
    )
  }

  return (
    <div className="stack-xl data-admin-page">
      <PageIntro
        eyebrow={t('Data and storage', 'Veri ve depolama')}
        title={t('Stored sources', 'Kayıtlı kaynaklar')}
        description={t('Review source storage, coverage, and supported metadata changes.', 'Kaynak depolamasını, kapsamını ve desteklenen üst veri değişikliklerini inceleyin.')}
        actions={
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={() => void loadOverview(selectedArtifactId)} disabled={isBusy || !session?.token}>{t("Refresh", "Yenile")}</button>
            <Link className="primary-button" to="/artifacts">{t("Add artifact", "Kaynak ekle")}</Link>
          </div>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {success ? <Callout>{success}</Callout> : null}

      <dl className="review-ledger" aria-label={t('Storage summary', 'Depolama özeti')}>
        <div><dt>{t('Sources', 'Kaynaklar')}</dt><dd>{overview?.artifacts.length ?? '—'}</dd></div>
        <div><dt>{t('Stored data', 'Kayıtlı veri')}</dt><dd>{formatBytes(totalSourceBytes, t('Missing', 'Eksik'))}</dd></div>
        <div><dt>{t('Database rows', 'Veritabanı kayıtları')}</dt><dd>{totalRows}</dd></div>
      </dl>

      <div className="two-column-layout wide-right-column">
        <Panel title={t('Stored artifacts', 'Kayıtlı kaynaklar')} description={t('Admin view of source storage, memory coverage, review state, and supported metadata changes.', 'Kaynak depolama, hafıza kapsamı, inceleme durumu ve desteklenen üst veri değişikliklerinin yönetici görünümü.')}>
          <div className="source-list-controls">
            <label className="field"><span className="field-label">{t('Find source', 'Kaynak ara')}</span><input type="search" name="source-search" autoComplete="off" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder={t('Search by title…', 'Başlığa göre ara…')} /></label>
            <label className="field"><span className="field-label">{t('Sort', 'Sıralama')}</span><Select aria-label={t('Sort', 'Sıralama')} value={sourceSort} onValueChange={(value) => setSourceSort(value as 'title' | 'recent')} options={[{ value: 'recent', label: t('Recently updated', 'Son güncellenen') }, { value: 'title', label: t('Title', 'Başlık') }]} /></label>
          </div>
          {overview && sourceSearch && !visibleArtifacts.length ? <p role="status" className="muted-copy">{t('No matching sources. Try another title.', 'Eşleşen kaynak yok. Başka bir başlık deneyin.')}</p> : null}
          {!overview || overview.artifacts.length === 0 ? (
            <EmptyState title={t('No stored artifacts', 'Kayıtlı kaynak yok')} description={t('Upload or paste evidence to populate the storage inventory.', 'Depolama envanterini doldurmak için kanıt yükleyin veya yapıştırın.')} />
          ) : (
            <div className="table-wrap" role="region" aria-label={t('Stored sources', 'Kayıtlı kaynaklar')} tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th aria-sort={sourceSort === 'title' ? 'ascending' : 'none'}>{t('Artifact', 'Kaynak')}</th>
                    <th>{t('Storage', 'Depolama')}</th>
                    <th>{t('Memory', 'Hafıza')}</th>
                    <th>{t('Review', 'İnceleme')}</th>
                    <th aria-sort={sourceSort === 'recent' ? 'descending' : 'none'}>{t('Updated', 'Güncellendi')}</th>
                    <th>{t('Actions', 'İşlemler')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleArtifacts.map((artifact) => (
                    <tr
                      key={artifact.artifact_id}
                      className={artifact.artifact_id === selectedArtifactId ? 'row-selected' : undefined}
                    >
                      <td>
                        <button type="button" className="row-title-button" onClick={() => handleSelectArtifact(artifact)}>
                          {artifact.title}
                        </button>
                      </td>
                      <td>
                        <StatusBadge value={artifact.storage_exists ? t('Stored', 'Kayıtlı') : t('Missing', 'Eksik')} />
                        <p className="table-secondary">{formatBytes(artifact.byte_size, t('Missing', 'Eksik'))}</p>
                      </td>
                      <td>{artifact.memory_object_count} {t('objects', 'nesne')} / {artifact.chunk_count} {t('chunks', 'bölüm')}</td>
                      <td>
                        <StatusBadge value={artifact.review_status} />
                      </td>
                      <td>{formatDateTime(artifact.updated_at)}</td>
                      <td>
                        <div className="table-action-group">
                          <SourcePreviewButton artifactId={artifact.artifact_id} title={artifact.title} className="table-action-link">{t('Preview', 'Önizle')}</SourcePreviewButton>
                          <a className="table-action-link" href={api.artifactDownloadUrl(artifact.artifact_id)}>{t("Download", "İndir")}</a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t('Selected artifact storage', 'Seçilen kaynak depolaması')} description={t('Raw source content is immutable; supported edits are metadata, review, and permissions.', 'Ham kaynak içeriği değiştirilemez; üst veri, inceleme ve izinler düzenlenebilir.')}>
          {!selectedArtifact ? (
            <EmptyState title={t('Select an artifact', 'Bir kaynak seçin')} description={t('Choose a stored artifact to inspect its database and storage record.', 'Veritabanı ve depolama kaydını incelemek için kayıtlı bir kaynak seçin.')} />
          ) : (
            <div className="stack-lg">
              <div className="artifact-action-strip">
                <SourcePreviewButton artifactId={selectedArtifact.artifact_id} title={selectedArtifact.title} className="secondary-button">{t('Preview source', 'Kaynağı önizle')}</SourcePreviewButton>
                <a className="secondary-button" href={api.artifactDownloadUrl(selectedArtifact.artifact_id)}>{t("Download source", "Kaynağı indir")}</a>
                <Link className="secondary-button" to="/artifacts">{t("Open artifact workspace", "Kaynak çalışma alanını aç")}</Link>
              </div>

              <dl className="meta-list">
                <div>
                  <dt>{t('Source type', 'Kaynak türü')}</dt>
                  <dd>{formatLabel(selectedArtifact.source_type)}</dd>
                </div>
                <div>
                  <dt>{t('Visibility', 'Görünürlük')}</dt>
                  <dd>{formatLabel(selectedArtifact.visibility_scope)}</dd>
                </div>
                <div>
                  <dt>{t('Ingestion', 'İşleme')}</dt>
                  <dd>
                    <StatusBadge value={selectedArtifact.ingestion_status} />
                  </dd>
                </div>
              </dl>

              <details className="employee-focus-details">
                <summary>{t('Technical storage details', 'Teknik depolama ayrıntıları')}</summary>
                <dl className="meta-list">
                  <div><dt>{t('Artifact ID', 'Kaynak kimliği')}</dt><dd>{selectedArtifact.artifact_id}</dd></div>
                  <div><dt>{t('Logical locator', 'Mantıksal konum')}</dt><dd>{selectedArtifact.logical_locator}</dd></div>
                  <div><dt>{t('Source path', 'Kaynak yolu')}</dt><dd>{selectedArtifact.source_path}</dd></div>
                  <div><dt>{t('Checksum', 'Sağlama toplamı')}</dt><dd>{selectedArtifact.checksum_sha256 ?? t('Not recorded', 'Kaydedilmedi')}</dd></div>
                </dl>
              </details>

              <form className="form-grid panel-subtle" onSubmit={handleTitleSave}>
                <label className="field">
                  <span className="field-label">{t('Artifact title', 'Kaynak başlığı')}</span>
                  <input name="artifact-title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} autoComplete="off" required />
                </label>
                <button type="submit" className="secondary-button" disabled={isBusy}>
                  {isBusy ? t('Saving…', 'Kaydediliyor…') : t('Save title', 'Başlığı kaydet')}
                </button>
              </form>

              <Callout>
                {t('Source bytes are not edited in place. To change document contents, upload or paste a replacement source, then mark the old source rejected or restrict its visibility if needed.', 'Kaynak içeriği yerinde düzenlenmez. Belge içeriğini değiştirmek için yeni bir kaynak yükleyin veya yapıştırın; ardından eski kaynağı reddedilmiş olarak işaretleyin ya da gerekirse görünürlüğünü kısıtlayın.')}
              </Callout>
            </div>
          )}
        </Panel>
      </div>

      <details className="employee-focus-details">
        <summary>{t('Database tables', 'Veritabanı tabloları')}</summary>
        {!overview ? (
          <EmptyState title={t('Loading database overview', 'Veritabanı özeti yükleniyor')} description={t('The table inventory will appear after the admin endpoint responds.', 'Yönetici hizmeti yanıt verdiğinde tablo envanteri görünecek.')} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Table', 'Tablo')}</th>
                  <th>{t('Rows', 'Satırlar')}</th>
                  <th>{t('Write surface', 'Yazma yüzeyi')}</th>
                  <th>{t('Read surface', 'Okuma yüzeyi')}</th>
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
      </details>

      <details className="employee-focus-details">
        <summary>{t('Database diagnostics', 'Veritabanı tanılama bilgileri')}</summary>
        <div className="detail-grid">
          <article className="panel-subtle detail-card">
            <p className="section-label">{t('SQLite database', 'SQLite veritabanı')}</p>
            <p className="table-primary">{overview?.sqlite_path ?? t('Not loaded', 'Yüklenmedi')}</p>
          </article>
          <article className="panel-subtle detail-card">
            <p className="section-label">{t('Uploaded files', 'Yüklenen dosyalar')}</p>
            <p className="table-primary">{overview?.storage_root ?? t('Not loaded', 'Yüklenmedi')}</p>
          </article>
          <article className="panel-subtle detail-card">
            <p className="section-label">{t('Pasted text', 'Yapıştırılan metin')}</p>
            <p className="table-primary">{overview?.pasted_text_root ?? t('Not loaded', 'Yüklenmedi')}</p>
          </article>
        </div>
        <ul className="evidence-list">
          {(overview?.management_notes ?? []).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}
