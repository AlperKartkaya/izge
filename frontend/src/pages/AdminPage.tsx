import { translate } from '../lib/language'
import { useEffect, useMemo, useState, type FormEventHandler } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel } from '../lib/format'
import type { ArtifactDetail, ArtifactRead, LocalLLMSmokeRead, LocalLLMStatusRead, UserRead, UserRole } from '../lib/types'
import { useLanguage } from '../lib/i18n'
import { Select } from '../components/Select'

type VisibilityScope = 'workspace' | 'restricted'
type ReviewStatus = 'submitted' | 'needs_review' | 'reviewed' | 'rejected'

function llmStatusLabel(status: LocalLLMStatusRead | null): string {
  if (!status) {
    return 'Checking'
  }
  if (status.gateway_status === 'ready') {
    return 'Ready'
  }
  if (status.gateway_status === 'model_missing') {
    return translate("Model missing", "Model bulunamadı")
  }
  if (status.gateway_status === 'unreachable') {
    return 'Unreachable'
  }
  return 'Disabled'
}

function enabledFlagLabels(status: LocalLLMStatusRead | null): string {
  if (!status) {
    return translate("Loading feature flags…", "Özellik ayarları yükleniyor…")
  }
  const labels = [
    status.feature_flags.extraction ? 'extraction' : null,
    status.feature_flags.query_routing ? translate("query routing", "soru yönlendirme") : null,
    status.feature_flags.answer_synthesis ? translate("answer synthesis", "yanıt oluşturma") : null,
    status.feature_flags.signal_explanation ? translate("signal explanation", "sinyal açıklama") : null,
  ].filter(Boolean)
  return labels.length ? labels.join(', ') : translate("No LLM-assisted capability enabled", "LLM destekli özellik etkin değil")
}

const emptyUserForm = {
  display_name: '',
  email: '',
  role: 'Member' as UserRole,
  password: '',
  is_active: true,
}

export function AdminPage() {
  const { t } = useLanguage()
  const { session, refreshUser } = useAuth()
  const isAdmin = session?.user.role === 'Admin'
  const [users, setUsers] = useState<UserRead[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [llmStatus, setLlmStatus] = useState<LocalLLMStatusRead | null>(null)
  const [llmSmoke, setLlmSmoke] = useState<LocalLLMSmokeRead | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState('')
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail | null>(null)
  const [createUserForm, setCreateUserForm] = useState(emptyUserForm)
  const [permissionDraft, setPermissionDraft] = useState<{ visibility_scope: VisibilityScope; permitted_user_ids: string[] }>({
    visibility_scope: 'workspace',
    permitted_user_ids: [],
  })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isSmokeRunning, setIsSmokeRunning] = useState(false)

  async function loadAdminState(nextArtifactId?: string) {
    if (!session?.token) {
      return
    }

    const [userList, artifactList, localLlmStatus] = await Promise.all([
      api.listUsers(session.token),
      api.listArtifacts(session.token),
      api.getLocalLLMStatus(session.token),
    ])

    setUsers(userList)
    setArtifacts(artifactList)
    setLlmStatus(localLlmStatus)

    const artifactId = nextArtifactId || selectedArtifactId || artifactList[0]?.artifact_id || ''
    setSelectedArtifactId(artifactId)

    if (artifactId) {
      const detail = await api.getArtifact(session.token, artifactId)
      setSelectedArtifact(detail)
      setPermissionDraft({
        visibility_scope: detail.visibility_scope,
        permitted_user_ids: detail.permitted_user_ids,
      })
    } else {
      setSelectedArtifact(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !isAdmin) {
        return
      }

      try {
        await loadAdminState()
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load admin state.', 'Yönetici durumu yüklenemedi.'))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, selectedArtifactId, session?.token])

  const activeUsers = useMemo(() => users.filter((user) => user.is_active), [users])
  const reviewCounts = useMemo(
    () => ({
      submitted: artifacts.filter((artifact) => artifact.review_status === 'submitted').length,
      needs_review: artifacts.filter((artifact) => artifact.review_status === 'needs_review').length,
      reviewed: artifacts.filter((artifact) => artifact.review_status === 'reviewed').length,
      rejected: artifacts.filter((artifact) => artifact.review_status === 'rejected').length,
    }),
    [artifacts],
  )
  const reviewQueue = useMemo(
    () => artifacts.filter((artifact) => artifact.review_status === 'submitted' || artifact.review_status === 'needs_review'),
    [artifacts],
  )

  const handleCreateUser: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token) {
      return
    }

    setIsBusy(true)
    setError(null)
    setSuccess(null)

    try {
      await api.createUser(session.token, createUserForm)
      setCreateUserForm(emptyUserForm)
      await loadAdminState()
      await refreshUser()
      setSuccess(t('User created successfully.', 'Kullanıcı başarıyla oluşturuldu.'))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to create user.', 'Kullanıcı oluşturulamadı.'))
    } finally {
      setIsBusy(false)
    }
  }

  async function handleUserUpdate(user: UserRead, changes: Partial<{ role: UserRole; is_active: boolean }>) {
    if (!session?.token) {
      return
    }

    setIsBusy(true)
    setError(null)
    setSuccess(null)

    try {
      await api.updateUser(session.token, user.user_id, changes)
      await loadAdminState()
      setSuccess(t('User updated successfully.', 'Kullanıcı başarıyla güncellendi.'))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to update user.', 'Kullanıcı güncellenemedi.'))
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
      const detail = await api.getArtifact(session.token, artifactId)
      setSelectedArtifact(detail)
      setPermissionDraft({
        visibility_scope: detail.visibility_scope,
        permitted_user_ids: detail.permitted_user_ids,
      })
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load artifact permissions.', 'Kaynak izinleri yüklenemedi.'))
    }
  }

  async function handlePermissionSave() {
    if (!session?.token || !selectedArtifactId) {
      return
    }

    setIsBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const detail = await api.updateArtifactPermissions(session.token, selectedArtifactId, permissionDraft)
      setSelectedArtifact(detail)
      await loadAdminState(selectedArtifactId)
      setSuccess(t('Artifact permissions updated successfully.', 'Kaynak izinleri başarıyla güncellendi.'))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to update artifact permissions.', 'Kaynak izinleri güncellenemedi.'))
    } finally {
      setIsBusy(false)
    }
  }

  async function handleReviewStatusUpdate(artifact: ArtifactRead, review_status: ReviewStatus) {
    if (!session?.token) {
      return
    }

    setIsBusy(true)
    setError(null)
    setSuccess(null)

    try {
      await api.updateArtifactReview(session.token, artifact.artifact_id, {
        review_status,
        review_notes:
          review_status === 'reviewed'
            ? 'Admin review queue: marked as reviewed for trusted memory.'
            : review_status === 'rejected'
              ? 'Admin review queue: rejected from trusted reasoning.'
              : null,
      })
      await loadAdminState(artifact.artifact_id)
      setSuccess(t(`Artifact marked ${formatLabel(review_status)}.`, `Kaynak ${formatLabel(review_status)} olarak işaretlendi.`))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to update artifact review status.', 'Kaynak inceleme durumu güncellenemedi.'))
    } finally {
      setIsBusy(false)
    }
  }

  async function handleLocalLLMSmoke() {
    if (!session?.token) {
      return
    }

    setIsSmokeRunning(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await api.runLocalLLMSmoke(session.token)
      const latestStatus = await api.getLocalLLMStatus(session.token)
      setLlmSmoke(result)
      setLlmStatus(latestStatus)
      setSuccess(result.status === 'passed' ? t('Local/private LLM smoke test passed.', 'Yerel/özel LLM hızlı testi geçti.') : t(`Local/private LLM smoke test ${result.status}.`, `Yerel LLM testi ${formatLabel(result.status)}.`))
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to run local/private LLM smoke test.', 'Yerel/özel LLM hızlı testi çalıştırılamadı.'))
    } finally {
      setIsSmokeRunning(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="stack-xl">
        <PageIntro
          eyebrow={t('Admin', 'Yönetim')}
          title={t('Restricted admin surface', 'Kısıtlı yönetim alanı')}
          description={t('Only Admin users can manage people, roles, and artifact visibility in the MVP workspace.', 'MVP çalışma alanında kişileri, rolleri ve kaynak görünürlüğünü yalnızca yöneticiler düzenleyebilir.')}
        />
        <Callout tone="warning">{t('Your current session does not have access to admin user and permission management.', 'Mevcut oturumunuz kullanıcı ve izin yönetimine erişemiyor.')}</Callout>
      </div>
    )
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Admin users, permissions & evidence review', 'Kullanıcılar, izinler ve kanıt incelemesi')}
        title={t('Govern the workspace memory boundary', 'Çalışma alanı hafıza sınırını yönetin')}
        description={t('Admin-only controls for user lifecycle, source-scoped visibility, and the evidence review queue that determines trusted reasoning inputs.', 'Kullanıcı yaşam döngüsü, kaynak kapsamlı görünürlük ve güvenilir akıl yürütme girdilerini belirleyen kanıt inceleme kuyruğu için yönetici kontrolleri.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {success ? <Callout>{success}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label={t('Needs review', 'İnceleme gerekli')} value={reviewCounts.needs_review + reviewCounts.submitted} detail={t('Submitted or processed evidence waiting for admin trust review.', 'Yönetici güven incelemesini bekleyen gönderilmiş veya işlenmiş kanıt.')} />
        <MetricCard label={t('Reviewed', 'İncelendi')} value={reviewCounts.reviewed} detail={t('Sources marked accepted for trusted memory.', 'Güvenilir hafıza için kabul edilen kaynaklar.')} />
        <MetricCard label={t('Rejected', 'Reddedildi')} value={reviewCounts.rejected} detail={t('Sources excluded from trusted reasoning and persisted-signal visibility.', 'Güvenilir akıl yürütme ve kalıcı sinyal görünürlüğünden çıkarılan kaynaklar.')} />
        <MetricCard label={t('Active users', 'Etkin kullanıcılar')} value={activeUsers.length} detail={t('Users currently eligible for workspace access.', 'Çalışma alanına erişebilen kullanıcılar.')} />
      </section>

      <Panel
        title={t('Local/private LLM readiness', 'Yerel/özel LLM hazırlığı')}
        description={t('Operational proof that the deployment can reach a controlled private model gateway while deterministic memory and evidence logic remain the authority.', 'Kurulumun kontrollü özel model geçidine erişebildiğinin ve belirleyici hafıza ile kanıt mantığının yetkili kaldığının operasyonel kanıtı.')}
        aside={<StatusBadge value={llmStatusLabel(llmStatus)} />}
      >
        <div className="detail-grid">
          <article className={llmStatus?.gateway_status === 'ready' ? 'panel-subtle detail-card action-card' : 'panel-subtle detail-card'}>
            <p className="section-label">{t('Gateway', 'Geçit')}</p>
            <p className="table-primary">{llmStatus?.base_url ?? t('Checking gateway…', 'Geçit kontrol ediliyor…')}</p>
            <p className="muted-copy">
              {llmStatus?.gateway_reachable
                ? t('The system can reach the configured Ollama-compatible gateway without exposing it publicly.', 'Sistem, yapılandırılmış Ollama uyumlu geçide onu herkese açmadan erişebiliyor.')
                : llmStatus?.error || t('Waiting for gateway status.', 'Geçit durumu bekleniyor.')}
            </p>
          </article>
          <article className="panel-subtle detail-card">
            <p className="section-label">{t('Configured model', 'Yapılandırılan model')}</p>
            <p className="table-primary">{llmStatus?.configured_model ?? t('Unknown', 'Bilinmiyor')}</p>
            <p className="muted-copy">
              {llmStatus?.configured_model_available
                ? t('Configured model is available at the gateway.', 'Yapılandırılan model geçitte mevcut.')
                : llmStatus?.available_models.length
                  ? `${t('Available models', 'Mevcut modeller')}: ${llmStatus.available_models.join(', ')}`
                  : t('No model list returned yet.', 'Henüz model listesi dönmedi.')}
            </p>
          </article>
          <article className="panel-subtle detail-card">
            <p className="section-label">{t('LLM-assisted paths', 'LLM destekli yollar')}</p>
            <p className="table-primary">{enabledFlagLabels(llmStatus)}</p>
            <p className="muted-copy">{t('Extraction, query intent, answer wording, and signal explanations can use local inference; permission filtering and evidence authority stay deterministic.', 'Çıkarım, sorgu niyeti, yanıt yazımı ve sinyal açıklamaları yerel çıkarımı kullanabilir; izin filtreleme ve kanıt yetkisi belirleyici kalır.')}</p>
          </article>
        </div>
        <div className="panel-subtle stack-sm">
          <div className="timeline-card-head">
            <div>
              <p className="section-label">{t('Structured smoke test', 'Yapılandırılmış hızlı test')}</p>
              <p className="table-primary">{llmSmoke ? `${formatLabel(llmSmoke.status)} · ${llmSmoke.duration_ms}ms` : t('Not run in this browser session', 'Bu tarayıcı oturumunda çalıştırılmadı')}</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => void handleLocalLLMSmoke()} disabled={isSmokeRunning}>
              {isSmokeRunning ? t('Testing…', 'Test ediliyor…') : t('Run LLM smoke', 'LLM hızlı testini çalıştır')}
            </button>
          </div>
          <p className="muted-copy">
            {llmSmoke ? llmSmoke.error || llmSmoke.message : t('This triggers a tiny structured JSON generation through the same local/private gateway used by Izge reasoning.', 'Bu işlem İzge’nin akıl yürütmesinde kullanılan aynı yerel/özel geçit üzerinden küçük bir yapılandırılmış JSON üretimi başlatır.')}
          </p>
        </div>
      </Panel>

      <Panel title={t('Evidence review queue', 'Kanıt inceleme kuyruğu')} description={t('Review status is part of the reasoning boundary: rejected sources remain stored, but are excluded from trusted query, graph, and signal support.', 'İnceleme durumu akıl yürütme sınırının parçasıdır: reddedilen kaynaklar saklanır ancak güvenilir sorgu, grafik ve sinyal desteğinden çıkarılır.')}>
        {artifacts.length === 0 ? (
          <EmptyState title={t('No artifacts available', 'Kullanılabilir kaynak yok')} description={t('Sources must exist before the memory boundary can be governed.', 'Hafıza sınırı yönetilmeden önce kaynaklar bulunmalıdır.')} />
        ) : reviewQueue.length === 0 ? (
          <EmptyState title={t('No artifacts waiting for review', 'İnceleme bekleyen kaynak yok')} description={t('All visible sources are either reviewed or rejected.', 'Tüm görünür kaynaklar incelendi veya reddedildi.')} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Artifact', 'Kaynak')}</th>
                  <th>{t('Ingestion', 'İşleme')}</th>
                  <th>{t('Review', 'İnceleme')}</th>
                  <th>{t('Updated', 'Güncellendi')}</th>
                  <th>{t('Actions', 'İşlemler')}</th>
                </tr>
              </thead>
              <tbody>
                {reviewQueue.map((artifact) => (
                  <tr key={artifact.artifact_id}>
                    <td>
                      <div>
                        <p className="table-primary">{artifact.title}</p>
                        <p className="table-secondary">{artifact.artifact_id}</p>
                      </div>
                    </td>
                    <td>
                      <StatusBadge value={artifact.ingestion_status} />
                    </td>
                    <td>
                      <StatusBadge value={artifact.review_status} />
                    </td>
                    <td>{formatDateTime(artifact.updated_at)}</td>
                    <td>
                      <div className="inline-actions">
                        <button type="button" className="text-button" onClick={() => void handleReviewStatusUpdate(artifact, 'reviewed')} disabled={isBusy}>{t("Mark reviewed", "İncelendi olarak işaretle")}</button>
                        <button type="button" className="text-button" onClick={() => void handleReviewStatusUpdate(artifact, 'rejected')} disabled={isBusy}>{t("Reject", "Reddet")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="two-column-layout">
        <Panel title={t('Create user', 'Kullanıcı oluştur')} description={t('Adds a new member or admin to the single workspace.', 'Tek çalışma alanına yeni bir üye veya yönetici ekler.')}>
          <form className="form-grid" onSubmit={handleCreateUser}>
            <label className="field">
              <span className="field-label">{t('Display name', 'Görünen ad')}</span>
              <input value={createUserForm.display_name} onChange={(event) => setCreateUserForm((current) => ({ ...current, display_name: event.target.value }))} required />
            </label>
            <label className="field">
              <span className="field-label">{t('Email', 'E-posta')}</span>
              <input type="email" value={createUserForm.email} onChange={(event) => setCreateUserForm((current) => ({ ...current, email: event.target.value }))} required />
            </label>
            <label className="field">
              <span className="field-label">{t('Role', 'Rol')}</span>
              <Select aria-label={t('Role', 'Rol')} value={createUserForm.role} onValueChange={(value) => setCreateUserForm((current) => ({ ...current, role: value as UserRole }))} options={[{ value: 'Member', label: t('Member', 'Üye') }, { value: 'Admin', label: t('Admin', 'Yönetici') }]} />
            </label>
            <label className="field">
              <span className="field-label">{t('Password', 'Parola')}</span>
              <input type="password" minLength={8} value={createUserForm.password} onChange={(event) => setCreateUserForm((current) => ({ ...current, password: event.target.value }))} required />
            </label>
            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? t('Creating…', 'Oluşturuluyor…') : t('Create user', 'Kullanıcı oluştur')}
            </button>
          </form>
        </Panel>

        <Panel title={t('Artifact permissions', 'Kaynak izinleri')} description={t('Edit the visibility scope and permitted user list for a selected source.', 'Seçilen kaynağın görünürlük kapsamını ve izinli kullanıcı listesini düzenleyin.')}>
          {artifacts.length === 0 ? (
            <EmptyState title={t('No artifacts available', 'Kullanılabilir kaynak yok')} description={t('Sources must exist before permissions can be managed.', 'İzinler yönetilmeden önce kaynaklar bulunmalıdır.')} />
          ) : (
            <div className="form-grid">
              <label className="field">
                <span className="field-label">{t('Artifact', 'Kaynak')}</span>
                <Select aria-label={t('Artifact', 'Kaynak')} value={selectedArtifactId} onValueChange={(value) => void handleArtifactSelection(value)} options={artifacts.map((artifact) => ({ value: artifact.artifact_id, label: artifact.title }))} />
              </label>
              <label className="field">
                <span className="field-label">{t('Visibility', 'Görünürlük')}</span>
                <Select
                  aria-label={t('Visibility', 'Görünürlük')}
                  value={permissionDraft.visibility_scope}
                  onValueChange={(value) =>
                    setPermissionDraft((current) => ({
                      ...current,
                      visibility_scope: value as VisibilityScope,
                      permitted_user_ids: value === 'workspace' ? [] : current.permitted_user_ids,
                    }))
                  }
                  options={[{ value: 'workspace', label: t('Workspace', 'Çalışma alanı') }, { value: 'restricted', label: t('Restricted', 'Kısıtlı') }]}
                />
              </label>
              {permissionDraft.visibility_scope === 'restricted' ? (
                <fieldset className="choice-grid">
                  <legend className="field-label">{t('Permitted users', 'İzinli kullanıcılar')}</legend>
                  {activeUsers.map((user) => (
                    <label key={user.user_id} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={permissionDraft.permitted_user_ids.includes(user.user_id)}
                        onChange={() =>
                          setPermissionDraft((current) => ({
                            ...current,
                            permitted_user_ids: current.permitted_user_ids.includes(user.user_id)
                              ? current.permitted_user_ids.filter((value) => value !== user.user_id)
                              : [...current.permitted_user_ids, user.user_id],
                          }))
                        }
                      />
                      <span>{user.display_name}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <button type="button" className="secondary-button" onClick={() => void handlePermissionSave()} disabled={isBusy || !selectedArtifactId}>
                {isBusy ? t('Saving…', 'Kaydediliyor…') : t('Save permissions', 'İzinleri kaydet')}
              </button>
              {selectedArtifact ? (
                <div className="panel-subtle">
                  <p className="section-label">{t('Selected artifact', 'Seçilen kaynak')}</p>
                  <p className="table-primary">{selectedArtifact.title}</p>
                  <p className="muted-copy">{t('Updated', 'Güncellendi')} {formatDateTime(selectedArtifact.updated_at)}</p>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('Workspace users', 'Çalışma alanı kullanıcıları')} description={t('Admin-only workspace user view.', 'Yalnızca yöneticilere açık çalışma alanı kullanıcı görünümü.')}>
        {users.length === 0 ? (
          <EmptyState title={t('No users returned', 'Kullanıcı bulunamadı')} description={t('User records will appear here once available in the workspace.', 'Kullanıcı kayıtları çalışma alanında kullanılabilir olduğunda burada görünür.')} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('User', 'Kullanıcı')}</th>
                  <th>{t('Role', 'Rol')}</th>
                  <th>{t('Status', 'Durum')}</th>
                  <th>{t('Actions', 'İşlemler')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id}>
                    <td>
                      <div>
                        <p className="table-primary">{user.display_name}</p>
                        <p className="table-secondary">{user.email}</p>
                      </div>
                    </td>
                    <td>{user.role}</td>
                    <td>{user.is_active ? t('Active', 'Etkin') : t('Inactive', 'Etkin değil')}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void handleUserUpdate(user, { role: user.role === 'Admin' ? 'Member' : 'Admin' })}
                        >{t("Toggle role", "Rolü değiştir")}</button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void handleUserUpdate(user, { is_active: !user.is_active })}
                        >
                          {user.is_active ? t('Deactivate', 'Devre dışı bırak') : t('Activate', 'Etkinleştir')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
