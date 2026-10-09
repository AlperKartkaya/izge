import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatDateTime } from '../lib/format'
import { applyThemePreference, nextThemePreference, readInitialThemePreference, type ThemePreference } from '../lib/theme'
import { api } from '../lib/api'
import { ButtonIcon } from '../components/ButtonIcon'
import { useLanguage } from '../lib/i18n'

const navigationIcons: Record<string, string> = { '/': 'home', '/query': 'ask-izge', '/team-chat': 'team-chat', '/memory': 'memory', '/tasks': 'tasks', '/automations': 'automations', '/notifications': 'notifications', '/operations': 'operations', '/ingestion': 'ingestion', '/graph': 'knowledge-graph', '/memory-filesystem': 'filesystem', '/orchestration': 'run', '/readiness': 'task-done', '/admin/data': 'memory', '/audit': 'audit', '/admin/users': 'users' }

const employeeNavigation = [
  { to: '/', label: ['Home', 'Ana sayfa'] as const, end: true },
  { to: '/query', label: ['İzge', 'İzge'] as const },
  { to: '/team-chat', label: ['Team Chat', 'Ekip sohbeti'] as const },
  { to: '/memory', label: ['Memory', 'Hafıza'] as const },
  { to: '/tasks', label: ['My tasks', 'İşlerim'] as const },
  { to: '/automations', label: ['Automations', 'Otomasyonlar'] as const },
  { to: '/notifications', label: ['Notifications', 'Bildirimler'] as const },
]
const adminNavigation = [
  { to: '/', label: ['Dashboard', 'Kontrol paneli'] as const, end: true }, { to: '/operations', label: ['Operations', 'Operasyonlar'] as const },
  { to: '/memory', label: ['Memory', 'Hafıza'] as const }, { to: '/ingestion', label: ['Ingestion', 'İşleme'] as const },
  { to: '/team-chat', label: ['Team Chat', 'Ekip sohbeti'] as const }, { to: '/graph', label: ['Knowledge graph', 'Bilgi grafiği'] as const },
  { to: '/tasks', label: ['Tasks', 'İşler'] as const }, { to: '/memory-filesystem', label: ['Filesystem', 'Dosya sistemi'] as const },
  { to: '/automations', label: ['Automations', 'Otomasyonlar'] as const }, { to: '/notifications', label: ['Notifications', 'Bildirimler'] as const },
  { to: '/orchestration', label: ['Runs', 'Çalışmalar'] as const }, { to: '/readiness', label: ['Readiness', 'Hazırlık'] as const },
]

export function AppShell() {
  const { session, signOut } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const { pathname } = useLocation()
  const isChatPage = pathname === '/query' || pathname === '/team-chat'
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialThemePreference())
  const [unreadCount, setUnreadCount] = useState(0)
  const isAdmin = session?.user.role === 'Admin'
  const navigationItems = isAdmin ? [...adminNavigation, { to: '/admin/data', label: ['Data', 'Veri'] as const }, { to: '/audit', label: ['Audit', 'Denetim'] as const }, { to: '/admin/users', label: ['Users', 'Kullanıcılar'] as const }] : employeeNavigation
  const nextTheme = nextThemePreference(theme)
  useEffect(() => { applyThemePreference(theme) }, [theme])
  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    const load = () => api.listNotifications(session.token, true).then((payload) => { if (!cancelled) setUnreadCount(payload.unread_count) }).catch(() => undefined)
    void load()
    const timer = window.setInterval(load, 10000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [session?.token, pathname])

  return <div className={isChatPage ? 'app-frame app-frame-chat' : 'app-frame'}>
    <div className="site-atmosphere" aria-hidden="true"><span className="atmosphere-plane atmosphere-plane-one" /><span className="atmosphere-plane atmosphere-plane-two" /><span className="atmosphere-scanline" /></div>
    <header className="top-nav">
      <NavLink to="/" end className="brand-mark" aria-label={t("Izge home", "Izge ana sayfa")}><span className="brand-sigil">İZ</span><span><span className="brand-kicker">{isAdmin ? t('Memory operations', 'Hafıza operasyonları') : t('Company memory', 'Şirket hafızası')}</span><span className="brand-name">Izge</span></span></NavLink>
      <nav className="nav-group" aria-label={t("Main navigation", "Ana menü")}>{navigationItems.map((item) => <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={({ isActive }) => isActive ? 'nav-link nav-link-active' : 'nav-link'}><ButtonIcon name={navigationIcons[item.to]} />{t(item.label[0], item.label[1])}{item.to === '/notifications' && unreadCount ? <span className="nav-badge" aria-label={t(`${unreadCount} unread notifications`, `${unreadCount} okunmamış bildirim`)}>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}</NavLink>)}</nav>
      <div className="session-cluster">
        <label className="language-select"><ButtonIcon name="language" /><span className="sr-only">{t("Language", "Dil")}</span><select value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "tr")} aria-label={t("Language", "Dil")}><option value="tr">Türkçe</option><option value="en">English</option></select></label>
        <button type="button" className="theme-toggle" aria-label={nextTheme === 'dark' ? t('Switch to dark theme', 'Koyu temaya geç') : t('Switch to light theme', 'Açık temaya geç')} aria-pressed={theme === 'light'} onClick={() => setTheme(nextTheme)}><span aria-hidden="true" className="theme-toggle-icon"><ButtonIcon name="theme" /></span><span className="theme-toggle-label">{theme === 'dark' ? t('Light', 'Açık') : t('Dark', 'Koyu')}</span></button>
        <div className="identity-block"><p className="identity-name">{session?.user.display_name}</p><p className="identity-meta">{isAdmin ? t('Admin', 'Yönetici') : t('Employee', 'Çalışan')} / {session?.expiresAt ? formatDateTime(session.expiresAt) : t('Signed in', 'Oturum açık')}</p></div>
        <button type="button" className="text-button" onClick={signOut}><ButtonIcon name="sign-out" />{t("Sign out", "Çıkış yap")}</button>
      </div>
    </header>
    <main className="workspace-column"><section className="workspace-content"><Outlet /></section></main>
  </div>
}
