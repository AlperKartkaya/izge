import { useEffect, useMemo, useState, type FormEventHandler } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, MetricCard, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatLabel } from '../lib/format'
import type { ArtifactDetail, ArtifactRead, UserRead, UserRole } from '../lib/types'

type VisibilityScope = 'workspace' | 'restricted'
type ReviewStatus = 'submitted' | 'needs_review' | 'reviewed' | 'rejected'

const emptyUserForm = {
  display_name: '',
  email: '',
  role: 'Member' as UserRole,
  password: '',
  is_active: true,
}

export function AdminPage() {
  const { session, refreshUser } = useAuth()
  const isAdmin = session?.user.role === 'Admin'
  const [users, setUsers] = useState<UserRead[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
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

  async function loadAdminState(nextArtifactId?: string) {
    if (!session?.token) {
      return
    }

    const [userList, artifactList] = await Promise.all([
      api.listUsers(session.token),
      api.listArtifacts(session.token),
    ])

    setUsers(userList)
    setArtifacts(artifactList)

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
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load admin state.')
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
      setSuccess('User created successfully.')
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to create user.')
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
      setSuccess('User updated successfully.')
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to update user.')
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
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load artifact permissions.')
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
      setSuccess('Artifact permissions updated successfully.')
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to update artifact permissions.')
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
      setSuccess(`Artifact marked ${formatLabel(review_status)}.`)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to update artifact review status.')
    } finally {
      setIsBusy(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="stack-xl">
        <PageIntro
          eyebrow="Admin"
          title="Restricted admin surface"
          description="Only Admin users can manage people, roles, and artifact visibility in the MVP workspace."
        />
        <Callout tone="warning">Your current session does not have access to admin user and permission management.</Callout>
      </div>
    )
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Admin users, permissions & evidence review"
        title="Govern the workspace memory boundary"
        description="Admin-only controls for user lifecycle, artifact-scoped visibility, and the evidence review queue that determines trusted reasoning inputs."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {success ? <Callout>{success}</Callout> : null}

      <section className="metric-grid">
        <MetricCard label="Needs review" value={reviewCounts.needs_review + reviewCounts.submitted} detail="Submitted or ingested evidence waiting for admin trust review." />
        <MetricCard label="Reviewed" value={reviewCounts.reviewed} detail="Artifacts marked accepted for trusted memory." />
        <MetricCard label="Rejected" value={reviewCounts.rejected} detail="Artifacts excluded from trusted reasoning and persisted-signal visibility." />
        <MetricCard label="Active users" value={activeUsers.length} detail="Users currently eligible for workspace access." />
      </section>

      <Panel title="Evidence review queue" description="Review status is now part of the reasoning boundary: rejected artifacts remain stored, but are excluded from trusted query, graph, and signal support.">
        {artifacts.length === 0 ? (
          <EmptyState title="No artifacts available" description="Artifacts must exist before the memory boundary can be governed." />
        ) : reviewQueue.length === 0 ? (
          <EmptyState title="No artifacts waiting for review" description="All visible artifacts are either reviewed or rejected." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Artifact</th>
                  <th>Ingestion</th>
                  <th>Review</th>
                  <th>Updated</th>
                  <th>Actions</th>
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
                      <StatusBadge value={formatLabel(artifact.ingestion_status)} />
                    </td>
                    <td>
                      <StatusBadge value={formatLabel(artifact.review_status)} />
                    </td>
                    <td>{formatDateTime(artifact.updated_at)}</td>
                    <td>
                      <div className="inline-actions">
                        <button type="button" className="text-button" onClick={() => void handleReviewStatusUpdate(artifact, 'reviewed')} disabled={isBusy}>
                          Mark reviewed
                        </button>
                        <button type="button" className="text-button" onClick={() => void handleReviewStatusUpdate(artifact, 'rejected')} disabled={isBusy}>
                          Reject
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

      <div className="two-column-layout">
        <Panel title="Create user" description="Adds a new member or admin to the single workspace.">
          <form className="form-grid" onSubmit={handleCreateUser}>
            <label className="field">
              <span className="field-label">Display name</span>
              <input value={createUserForm.display_name} onChange={(event) => setCreateUserForm((current) => ({ ...current, display_name: event.target.value }))} required />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" value={createUserForm.email} onChange={(event) => setCreateUserForm((current) => ({ ...current, email: event.target.value }))} required />
            </label>
            <label className="field">
              <span className="field-label">Role</span>
              <select value={createUserForm.role} onChange={(event) => setCreateUserForm((current) => ({ ...current, role: event.target.value as UserRole }))}>
                <option value="Member">Member</option>
                <option value="Admin">Admin</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input type="password" minLength={8} value={createUserForm.password} onChange={(event) => setCreateUserForm((current) => ({ ...current, password: event.target.value }))} required />
            </label>
            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? 'Creating…' : 'Create user'}
            </button>
          </form>
        </Panel>

        <Panel title="Artifact permissions" description="Edit the visibility scope and permitted user list for a selected artifact.">
          {artifacts.length === 0 ? (
            <EmptyState title="No artifacts available" description="Artifacts must exist before permissions can be managed." />
          ) : (
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Artifact</span>
                <select value={selectedArtifactId} onChange={(event) => void handleArtifactSelection(event.target.value)}>
                  {artifacts.map((artifact) => (
                    <option key={artifact.artifact_id} value={artifact.artifact_id}>
                      {artifact.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Visibility</span>
                <select
                  value={permissionDraft.visibility_scope}
                  onChange={(event) =>
                    setPermissionDraft((current) => ({
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
              {permissionDraft.visibility_scope === 'restricted' ? (
                <fieldset className="choice-grid">
                  <legend className="field-label">Permitted users</legend>
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
                {isBusy ? 'Saving…' : 'Save permissions'}
              </button>
              {selectedArtifact ? (
                <div className="panel-subtle">
                  <p className="section-label">Selected artifact</p>
                  <p className="table-primary">{selectedArtifact.title}</p>
                  <p className="muted-copy">Updated {formatDateTime(selectedArtifact.updated_at)}</p>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Workspace users" description="Admin-only view backed by `/api/users` and `/api/users/:id`.">
        {users.length === 0 ? (
          <EmptyState title="No users returned" description="User records will appear here once available in the workspace." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                    <td>{user.is_active ? 'Active' : 'Inactive'}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void handleUserUpdate(user, { role: user.role === 'Admin' ? 'Member' : 'Admin' })}
                        >
                          Toggle role
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void handleUserUpdate(user, { is_active: !user.is_active })}
                        >
                          {user.is_active ? 'Deactivate' : 'Activate'}
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
