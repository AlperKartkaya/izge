import { IzgeLogo } from '../components/IzgeLogo'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ButtonIcon } from '../components/ButtonIcon'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useLanguage } from '../lib/i18n'
import { isNavigationActive } from '../lib/navigation'
import { applyThemePreference, nextThemePreference, readInitialThemePreference, type ThemePreference } from '../lib/theme'

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
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialThemePreference())
  const mainRef = useRef<HTMLElement>(null)
  const previousPath = useRef(pathname)
  const [unreadCount, setUnreadCount] = useState(0)
  const isAdmin = session?.user.role === 'Admin'
  const navigationItems = isAdmin ? [...adminNavigation, { to: '/admin/data', label: ['Data', 'Veri'] as const }, { to: '/audit', label: ['Audit', 'Denetim'] as const }, { to: '/admin/users', label: ['Users', 'Kullanıcılar'] as const }] : employeeNavigation
  const nextTheme = nextThemePreference(theme)
  const sidebarAction = sidebarExpanded ? t('Collapse menu', 'Menüyü daralt') : t('Expand menu', 'Menüyü genişlet')

  useEffect(() => {
    if (previousPath.current !== pathname) {
      mainRef.current?.focus({ preventScroll: true })
      previousPath.current = pathname
    }
  }, [pathname])

  useEffect(() => { applyThemePreference(theme) }, [theme])
  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    const load = () => api.listNotifications(session.token, true).then((payload) => { if (!cancelled) setUnreadCount(payload.unread_count) }).catch(() => undefined)
    void load()
    const timer = window.setInterval(load, 10000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [session?.token, pathname])

  return <div className={`${isChatPage ? 'app-frame app-frame-chat' : 'app-frame'}${sidebarExpanded ? ' app-frame-sidebar-expanded' : ''}`}>
    <a className="skip-link" href="#main-content">{t('Skip to content', 'İçeriğe geç')}</a>
    <header className="top-nav app-sidebar" onKeyDown={(event) => { if (event.key === 'Escape') { setSidebarExpanded(false); event.currentTarget.querySelector<HTMLButtonElement>('.sidebar-toggle')?.focus() } }}>
      <button type="button" className="sidebar-toggle" onClick={() => setSidebarExpanded((value) => !value)} aria-expanded={sidebarExpanded} aria-label={sidebarAction} title={sidebarAction}>
        <span className="brand-sigil"><IzgeLogo /></span>
        <span className="sidebar-brand-copy"><span className="brand-kicker">{isAdmin ? t('Memory operations', 'Hafıza operasyonları') : t('Company memory', 'Şirket hafızası')}</span><span className="brand-name">Izge</span></span>
        <span className="sidebar-toggle-arrow" aria-hidden="true">›</span>
      </button>
      <nav className="nav-group" aria-label={t('Main navigation', 'Ana menü')}>{navigationItems.map((item) => {
        const label = t(item.label[0], item.label[1])
        const active = isNavigationActive(pathname, item.to)
        return <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} onClick={() => { if (window.matchMedia('(max-width: 700px)').matches) setSidebarExpanded(false) }} aria-label={label} title={sidebarExpanded ? undefined : label} aria-current={active ? 'page' : undefined} className={active ? 'nav-link nav-link-active' : 'nav-link'}><ButtonIcon name={navigationIcons[item.to]} /><span className="nav-link-label">{label}</span>{item.to === '/notifications' && unreadCount ? <span className="nav-badge" aria-label={t(`${unreadCount} unread notifications`, `${unreadCount} okunmamış bildirim`)}>{unreadCount > 99 ? '99+' : unreadCount}</span> : null}</NavLink>
      })}</nav>
      <div className="session-cluster">
        <label className="language-select sidebar-control" title={t('Language', 'Dil')}><ButtonIcon name="language" /><span className="sr-only">{t('Language', 'Dil')}</span><select value={language} onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'tr')} aria-label={t('Language', 'Dil')}><option value="tr">Türkçe</option><option value="en">English</option></select></label>
        <button type="button" className="theme-toggle sidebar-control" aria-label={nextTheme === 'dark' ? t('Switch to dark theme', 'Koyu temaya geç') : t('Switch to light theme', 'Açık temaya geç')} title={nextTheme === 'dark' ? t('Switch to dark theme', 'Koyu temaya geç') : t('Switch to light theme', 'Açık temaya geç')} aria-pressed={theme === 'light'} onClick={() => setTheme(nextTheme)}><ButtonIcon name="theme" /><span className="sidebar-control-label">{theme === 'dark' ? t('Light', 'Açık') : t('Dark', 'Koyu')}</span></button>
        <div className="identity-block"><p className="identity-name">{session?.user.display_name}</p><p className="identity-meta">{isAdmin ? t('Admin', 'Yönetici') : t('Employee', 'Çalışan')} / {session?.expiresAt ? formatDateTime(session.expiresAt) : t('Signed in', 'Oturum açık')}</p></div>
        <button type="button" className="text-button sidebar-control" aria-label={t('Sign out', 'Çıkış yap')} title={t('Sign out', 'Çıkış yap')} onClick={signOut}><ButtonIcon name="sign-out" /><span className="sidebar-control-label">{t('Sign out', 'Çıkış yap')}</span></button>
      </div>
    </header>
    <main id="main-content" ref={mainRef} tabIndex={-1} className="workspace-column"><section className="workspace-content"><Outlet /></section></main>
  </div>
}
