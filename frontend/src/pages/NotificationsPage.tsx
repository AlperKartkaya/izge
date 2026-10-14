import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Mail, MailOpen, Trash2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AgentText, LoadingState } from '../components/AgentPrimitives'
import { ButtonIcon } from '../components/ButtonIcon'
import { IzgeLogo } from '../components/IzgeLogo'
import { Callout, EmptyState } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { compactMarkdownPreview } from '../lib/agentText'
import { formatDateTime } from '../lib/format'
import type { NotificationRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'
import './notifications.css'

function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError && error.message ? error.message : fallback }
type NotificationDetail = { status: 'loading' } | { status: 'ready'; body: string } | { status: 'error'; message: string }

export function NotificationsPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const unreadOnly = searchParams.get('filter') === 'unread'
  const [items, setItems] = useState<NotificationRead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, NotificationDetail>>({})
  const mutationRef = useRef(false)
  const revisionRef = useRef(0)
  const detailRevisionRef = useRef<Record<string, number>>({})
  const tokenRef = useRef(session?.token)
  tokenRef.current = session?.token

  useEffect(() => {
    detailRevisionRef.current = {}
    setDetails({})
  }, [session?.token, unreadOnly])

  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    const token = session.token
    async function load() {
      if (mutationRef.current) return
      const revision = revisionRef.current
      try {
        const payload = await api.listNotifications(token, unreadOnly)
        if (!cancelled && revision === revisionRef.current) { setItems(payload.items); setLoadError(null) }
      } catch (caughtError) { if (!cancelled && revision === revisionRef.current) setLoadError(errorMessage(caughtError, t('Notifications could not be loaded.', 'Bildirimler yüklenemedi.'))) }
      finally { if (!cancelled) setIsLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [session?.token, t, unreadOnly])

  async function changeReadState(notification: NotificationRead) {
    if (!session?.token || mutationRef.current) return
    mutationRef.current = true
    revisionRef.current += 1
    setBusyId(notification.notification_id)
    try {
      const updated = notification.read_at
        ? await api.markNotificationUnread(session.token, notification.notification_id)
        : await api.markNotificationRead(session.token, notification.notification_id)
      setItems((current) => unreadOnly && updated.read_at
        ? current.filter((item) => item.notification_id !== updated.notification_id)
        : current.map((item) => item.notification_id === updated.notification_id ? updated : item))
      setActionError(null)
    } catch (caughtError) {
      setActionError(errorMessage(caughtError, t('Notification could not be updated.', 'Bildirim güncellenemedi.')))
    } finally { mutationRef.current = false; setBusyId(null) }
  }

  async function removeNotification(notification: NotificationRead) {
    if (!session?.token || mutationRef.current) return
    if (confirmDeleteId !== notification.notification_id) { setConfirmDeleteId(notification.notification_id); return }
    mutationRef.current = true
    revisionRef.current += 1
    setBusyId(notification.notification_id)
    try {
      await api.deleteNotification(session.token, notification.notification_id)
      setItems((current) => current.filter((item) => item.notification_id !== notification.notification_id))
      setDetails((current) => { const next = { ...current }; delete next[notification.notification_id]; return next })
      setConfirmDeleteId(null)
      setActionError(null)
    } catch (caughtError) {
      setActionError(errorMessage(caughtError, t('Notification could not be deleted.', 'Bildirim silinemedi.')))
    } finally { mutationRef.current = false; setBusyId(null) }
  }

  function openConversation(notification: NotificationRead) {
    const threadId = notification.thread_id ?? 'izge-colleague'
    navigate(notification.kind === 'message' ? `/team-chat?thread=${encodeURIComponent(threadId)}` : `/query?thread=${encodeURIComponent(threadId)}${notification.run_id ? `&run=${encodeURIComponent(notification.run_id)}` : ''}`)
  }

  async function loadDetail(notification: NotificationRead, open: boolean) {
    const notificationId = notification.notification_id
    const revision = (detailRevisionRef.current[notificationId] ?? 0) + 1
    detailRevisionRef.current[notificationId] = revision
    if (!open) {
      setDetails((current) => { const next = { ...current }; delete next[notificationId]; return next })
      return
    }
    const token = session?.token
    if (!token) return
    setDetails((current) => ({ ...current, [notificationId]: { status: 'loading' } }))
    try {
      const detail = await api.getNotification(token, notificationId)
      if (tokenRef.current !== token || detailRevisionRef.current[notificationId] !== revision) return
      setDetails((current) => ({ ...current, [notificationId]: { status: 'ready', body: detail.body } }))
    } catch (caughtError) {
      if (tokenRef.current !== token || detailRevisionRef.current[notificationId] !== revision) return
      setDetails((current) => ({ ...current, [notificationId]: {
        status: 'error',
        message: errorMessage(caughtError, t('Notification could not be loaded.', 'Bildirim yüklenemedi.')),
      } }))
    }
  }

  return <div className="stack-lg notifications-page">
    <header className="employee-page-header"><div><h1>{t('Notifications', 'Bildirimler')}</h1><p>{t('Messages and findings that may need your attention.', 'Dikkatinizi gerektirebilecek mesajlar ve tespitler.')}</p></div></header>
    <div className="inline-actions" role="group" aria-label={t('Notification filter', 'Bildirim filtresi')}>
      <button type="button" className="secondary-button" aria-pressed={!unreadOnly} onClick={() => setSearchParams({})}>{t('All', 'Tümü')}</button>
      <button type="button" className="secondary-button" aria-pressed={unreadOnly} onClick={() => setSearchParams({ filter: 'unread' })}>{t('Unread', 'Okunmamış')}</button>
    </div>
    {actionError || loadError ? <Callout tone="warning">{actionError ?? loadError}</Callout> : null}
    {isLoading ? <LoadingState label={t('Loading notifications', 'Bildirimler yükleniyor')} /> : items.length ? (
      <section className="notification-list" aria-label={t('Notifications', 'Bildirimler')}>
        {items.map((item) => {
          const detail = details[item.notification_id]
          return (
          <article className={item.read_at ? 'notification-entry' : 'notification-entry notification-item-unread'} key={item.notification_id} aria-busy={busyId === item.notification_id}>
            <div className="notification-item">
              <span className="notification-icon" aria-hidden="true">{item.kind === 'agent' ? <IzgeLogo /> : <ButtonIcon name="team-chat" />}</span>
              <span className="notification-content">
                <span className="notification-heading"><strong>{item.title}</strong><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time></span>
                <span className="notification-copy notification-copy-compact">{compactMarkdownPreview(item.body)}</span>
              </span>
              {!item.read_at ? <span className="notification-unread-mark"><span className="sr-only">{t('Unread', 'Okunmadı')}</span></span> : null}
            </div>
            <details key={`${item.notification_id}:${unreadOnly ? 'unread' : 'all'}:${session?.user.user_id ?? 'signed-out'}`} className="notification-full-copy" onToggle={(event) => void loadDetail(item, event.currentTarget.open)}>
              <summary>{t('Continue reading', 'Devamını oku')}</summary>
              {detail?.status === 'loading' ? <p className="notification-detail-status" role="status">{t('Loading notification', 'Bildirim yükleniyor')}</p> : null}
              {detail?.status === 'error' ? <div className="notification-detail-error"><Callout tone="warning">{detail.message}</Callout><button type="button" className="secondary-button" onClick={() => void loadDetail(item, true)}>{t('Try again', 'Tekrar dene')}</button></div> : null}
              {detail?.status === 'ready' ? <div className="markdown-content"><AgentText text={detail.body} /></div> : null}
            </details>
            <div className="notification-actions">
              <button type="button" className="notification-action" disabled={busyId !== null} onClick={() => void changeReadState(item)}>{item.read_at ? <Mail aria-hidden="true" /> : <MailOpen aria-hidden="true" />}{item.read_at ? t('Mark unread', 'Okunmadı işaretle') : t('Mark read', 'Okundu işaretle')}</button>
              <button type="button" className="notification-action notification-action-open" disabled={busyId !== null} onClick={() => openConversation(item)}><ArrowUpRight aria-hidden="true" />{item.kind === 'message' ? t('Open chat', 'Sohbeti aç') : t('Open in Izge', 'İzge’de aç')}</button>
              <button type="button" className={`notification-action notification-action-danger${confirmDeleteId === item.notification_id ? ' notification-action-confirm' : ''}`} disabled={busyId !== null} onBlur={() => setConfirmDeleteId(null)} onClick={() => void removeNotification(item)}><Trash2 aria-hidden="true" />{confirmDeleteId === item.notification_id ? t('Confirm delete', 'Silmeyi onayla') : t('Delete', 'Sil')}</button>
            </div>
          </article>
          )
        })}
      </section>
    ) : <EmptyState title={t('No new notifications', 'Yeni bildirim yok')} description={t('New team messages and findings from Izge will appear here.', 'Yeni ekip mesajları ve İzge’nin tespitleri burada görünecek.')} />}

  </div>
}
