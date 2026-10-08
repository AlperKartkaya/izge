import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatDateTime } from '../lib/format'
import { applyThemePreference, nextThemePreference, readInitialThemePreference, type ThemePreference } from '../lib/theme'

const employeeNavigation = [
  { to: '/', label: 'Ana sayfa', end: true },
  { to: '/query', label: 'İzge' },
  { to: '/team-chat', label: 'Team Chat' },
  { to: '/memory', label: 'Hafıza' },
  { to: '/tasks', label: 'İşlerim' },
]
const adminNavigation = [
  { to: '/', label: 'Kontrol paneli', end: true }, { to: '/operations', label: 'Operasyonlar' },
  { to: '/memory', label: 'Hafıza' }, { to: '/ingestion', label: 'İşleme' },
  { to: '/team-chat', label: 'Team Chat' }, { to: '/graph', label: 'Bilgi grafiği' },
  { to: '/tasks', label: 'İşler' }, { to: '/memory-filesystem', label: 'Dosya sistemi' },
  { to: '/orchestration', label: 'Çalışmalar' }, { to: '/readiness', label: 'Hazırlık' },
]

export function AppShell() {
  const { session, signOut } = useAuth()
  const { pathname } = useLocation()
  const isChatPage = pathname === '/query' || pathname === '/team-chat'
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialThemePreference())
  const isAdmin = session?.user.role === 'Admin'
  const navigationItems = isAdmin ? [...adminNavigation, { to: '/admin/data', label: 'Veri' }, { to: '/audit', label: 'Denetim' }, { to: '/admin/users', label: 'Kullanıcılar' }] : employeeNavigation
  const nextTheme = nextThemePreference(theme)
  useEffect(() => { applyThemePreference(theme) }, [theme])

  return <div className={isChatPage ? 'app-frame app-frame-chat' : 'app-frame'}>
    <div className="site-atmosphere" aria-hidden="true"><span className="atmosphere-plane atmosphere-plane-one" /><span className="atmosphere-plane atmosphere-plane-two" /><span className="atmosphere-scanline" /></div>
    <header className="top-nav">
      <NavLink to="/" end className="brand-mark" aria-label="Izge ana sayfa"><span className="brand-sigil">İZ</span><span><span className="brand-kicker">{isAdmin ? 'Hafıza operasyonları' : 'Şirket hafızası'}</span><span className="brand-name">Izge</span></span></NavLink>
      <nav className="nav-group" aria-label="Ana menü">{navigationItems.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'nav-link nav-link-active' : 'nav-link'}>{item.label}</NavLink>)}</nav>
      <div className="session-cluster">
        <label className="language-select"><span className="sr-only">Dil</span><select defaultValue="tr" aria-label="Dil"><option value="tr">Türkçe</option><option value="en" disabled>English — Yakında</option></select></label>
        <button type="button" className="theme-toggle" aria-label={`${nextTheme === 'dark' ? 'Koyu' : 'Açık'} temaya geç`} aria-pressed={theme === 'light'} onClick={() => setTheme(nextTheme)}><span aria-hidden="true" className="theme-toggle-icon">{theme === 'dark' ? '☀' : '☾'}</span><span className="theme-toggle-label">{theme === 'dark' ? 'Açık' : 'Koyu'}</span></button>
        <div className="identity-block"><p className="identity-name">{session?.user.display_name}</p><p className="identity-meta">{isAdmin ? 'Yönetici' : 'Çalışan'} / {session?.expiresAt ? formatDateTime(session.expiresAt) : 'Oturum açık'}</p></div>
        <button type="button" className="text-button" onClick={signOut}>Çıkış yap</button>
      </div>
    </header>
    <main className="workspace-column"><section className="workspace-content"><Outlet /></section></main>
  </div>
}
