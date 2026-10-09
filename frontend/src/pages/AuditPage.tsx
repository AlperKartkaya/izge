import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { AuditEventRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'

export function AuditPage() {
  const { t } = useLanguage()
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
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load audit events.', 'Denetim olayları yüklenemedi.'))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [isAdmin, session?.token, t])

  if (!isAdmin) {
    return (
      <div className="stack-xl">
        <PageIntro
          eyebrow={t('Audit log', 'Denetim kaydı')}
          title={t('Restricted audit surface', 'Kısıtlı denetim alanı')}
          description={t('Audit retrieval is admin-only in the current backend and remains scoped that way in the frontend.', 'Mevcut sistemde denetim kayıtlarına yalnızca yöneticiler erişebilir; arayüz de bu sınırı korur.')}
        />
        <Callout tone="warning">{t('Only Admin users can inspect audit events for the workspace.', 'Çalışma alanındaki denetim olaylarını yalnızca yöneticiler inceleyebilir.')}</Callout>
      </div>
    )
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Audit log', 'Denetim kaydı')}
        title={t('Inspect system events', 'Sistem olaylarını inceleyin')}
        description={t('A chronological record of sign-in, ingestion, query, and permission events.', 'Giriş, veri işleme, sorgu ve izin olaylarının kronolojik kaydı.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <Panel title={t('Event stream', 'Olay akışı')} description={t('Recent events ordered from newest to oldest.', 'Son olaylar yeniden eskiye sıralanır.')}>
        {events.length === 0 ? (
          <EmptyState title={t('No audit events returned', 'Denetim olayı bulunamadı')} description={t('Events will appear here after system actions create audit entries.', 'Sistem işlemleri denetim kayıtları oluşturduğunda olaylar burada görünür.')} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Timestamp', 'Zaman')}</th>
                  <th>{t('Event', 'Olay')}</th>
                  <th>{t('Target', 'Hedef')}</th>
                  <th>{t('Actor', 'Gerçekleştiren')}</th>
                  <th>{t('Metadata', 'Üst veri')}</th>
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
                    <td className="break-anywhere">{event.actor_user_id ?? t('System', 'Sistem')}</td>
                    <td>
                      <details className="metadata-details">
                        <summary>{t('View metadata', 'Üst veriyi görüntüle')}</summary>
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
