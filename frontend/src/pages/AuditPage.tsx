import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { AuditEventRead } from '../lib/types'

export function AuditPage() {
  const { session } = useAuth()
  const isAdmin = session?.user.role === 'Admin'
  const [events, setEvents] = useState<AuditEventRead[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !isAdmin) {
        return
      }

      try {
        const payload = await api.listAuditEvents(session.token)
        if (!cancelled) {
          setEvents(payload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load audit events.')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [isAdmin, session?.token])

  if (!isAdmin) {
    return (
      <div className="stack-xl">
        <PageIntro
          eyebrow="Audit log"
          title="Restricted audit surface"
          description="Audit retrieval is admin-only in the current backend and remains scoped that way in the frontend."
        />
        <Callout tone="warning">Only Admin users can inspect audit events for the workspace.</Callout>
      </div>
    )
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Audit log"
        title="Inspect system events"
        description="A chronological record of sign-in, ingestion, query, and permission events sourced from `/api/audit/events`."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <Panel title="Event stream" description="Recent events ordered from newest to oldest.">
        {events.length === 0 ? (
          <EmptyState title="No audit events returned" description="Events will appear here after backend actions create audit entries." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Target</th>
                  <th>Actor</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.event_id}>
                    <td>{formatDateTime(event.timestamp)}</td>
                    <td>
                      <p className="table-primary">{event.event_type}</p>
                      <p className="table-secondary">{event.event_id}</p>
                    </td>
                    <td>
                      <p className="table-primary">{event.target_type}</p>
                      <p className="table-secondary">{event.target_id}</p>
                    </td>
                    <td className="break-anywhere">{event.actor_user_id ?? 'System'}</td>
                    <td>
                      <details className="metadata-details">
                        <summary>View metadata</summary>
                        <pre className="metadata-code audit-metadata">{JSON.stringify(event.event_metadata, null, 2)}</pre>
                      </details>
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
