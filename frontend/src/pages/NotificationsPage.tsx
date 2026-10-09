import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadingState } from '../components/AgentPrimitives'
import { Callout, EmptyState } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { NotificationRead } from '../lib/types'

function errorMessage(error: unknown) { return error instanceof ApiError && error.message ? error.message : 'Bildirimler yüklenemedi.' }

export function NotificationsPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<NotificationRead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    const token = session.token
    async function load() {
      try {
        const payload = await api.listNotifications(token)
        if (!cancelled) { setItems(payload.items); setError(null) }
      } catch (caughtError) { if (!cancelled) setError(errorMessage(caughtError)) }
      finally { if (!cancelled) setIsLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [session?.token])

  async function openNotification(notification: NotificationRead) {
    if (!session?.token) return
    if (!notification.read_at) {
      try {
        const updated = await api.markNotificationRead(session.token, notification.notification_id)
        setItems((current) => current.map((item) => item.notification_id === updated.notification_id ? updated : item))
      } catch (caughtError) { setError(errorMessage(caughtError)); return }
    }
    const threadId = notification.thread_id ?? 'izge-colleague'
    navigate(notification.kind === 'message' ? `/team-chat?thread=${encodeURIComponent(threadId)}` : `/query?thread=${encodeURIComponent(threadId)}${notification.run_id ? `&run=${encodeURIComponent(notification.run_id)}` : ''}`)
  }

  return <div className="stack-lg notifications-page">
    <header className="employee-page-header"><div><p className="eyebrow">Canlı şirket akışı</p><h1>Bildirimler</h1><p>Ekip mesajları ve İzge’nin dikkat gerektiren tespitleri burada toplanır.</p></div></header>
    {error ? <Callout tone="warning">{error}</Callout> : null}
    {isLoading ? <LoadingState label="Bildirimler yükleniyor" /> : items.length ? <section className="notification-list" aria-label="Bildirimler">{items.map((item) => <button type="button" className={item.read_at ? 'notification-item' : 'notification-item notification-item-unread'} key={item.notification_id} onClick={() => void openNotification(item)}><span className="notification-icon" aria-hidden="true">{item.kind === 'agent' ? 'İZ' : '●'}</span><span><strong>{item.title}</strong><p>{item.body}</p><time>{formatDateTime(item.created_at)}</time></span>{!item.read_at ? <i aria-label="Okunmadı" /> : null}</button>)}</section> : <EmptyState title="Yeni bildirim yok" description="Yeni ekip mesajları ve İzge’nin tespitleri burada görünecek." />}
  </div>
}
