import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatDateTime } from '../lib/format'
import { applyThemePreference, nextThemePreference, readInitialThemePreference, type ThemePreference } from '../lib/theme'

const primaryNavigation = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/artifacts', label: 'Artifacts' },
  { to: '/ingestion', label: 'Ingestion' },
  { to: '/team-chat', label: 'Team chat' },
  { to: '/graph', label: 'Graph' },
  { to: '/memory-filesystem', label: 'Memory FS' },
  { to: '/orchestration', label: 'Jobs' },
  { to: '/readiness', label: 'Readiness' },
]

export function AppShell() {
  const { session, signOut } = useAuth()
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialThemePreference())
  const isAdmin = session?.user.role === 'Admin'
  const navigationItems = isAdmin
    ? [...primaryNavigation, { to: '/admin/data', label: 'Data' }, { to: '/audit', label: 'Audit' }, { to: '/admin/users', label: 'Users' }]
    : primaryNavigation
  const nextTheme = nextThemePreference(theme)

  useEffect(() => {
    applyThemePreference(theme)
  }, [theme])

  return (
    <div className="app-frame">
      <div className="site-atmosphere" aria-hidden="true">
        <span className="atmosphere-plane atmosphere-plane-one" />
        <span className="atmosphere-plane atmosphere-plane-two" />
        <span className="atmosphere-scanline" />
      </div>

      <header className="top-nav">
        <NavLink to="/" end className="brand-mark" aria-label="Izge home">
          <span className="brand-sigil">IZ</span>
          <span>
            <span className="brand-kicker">Memory operations</span>
            <span className="brand-name">Izge</span>
          </span>
        </NavLink>

        <nav className="nav-group" aria-label="Primary">
          {navigationItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}>
              {item.label}
            </NavLink>
          ))}
          <a className="nav-link" href="/docs/IZGE_OFFICIAL_DOCUMENTATION.html">
            Docs
          </a>
        </nav>

        <div className="session-cluster">
          <NavLink
            to="/query"
            className={({ isActive }) => (isActive ? 'chat-launcher chat-launcher-active' : 'chat-launcher')}
            aria-label="Open company memory chat"
          >
            <span aria-hidden="true" className="chat-launcher-icon">💬</span>
            <span className="chat-launcher-label">Chat</span>
          </NavLink>
          <button type="button" className="theme-toggle" aria-label={`Switch to ${nextTheme} theme`} aria-pressed={theme === 'light'} onClick={() => setTheme(nextTheme)}>
            <span aria-hidden="true" className="theme-toggle-icon">{theme === 'dark' ? '☀' : '☾'}</span>
            <span className="theme-toggle-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <div className="identity-block">
            <p className="identity-name">{session?.user.display_name}</p>
            <p className="identity-meta">{session?.user.role} / {session?.expiresAt ? formatDateTime(session.expiresAt) : 'Active session'}</p>
          </div>
          <button type="button" className="text-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="workspace-column">
        <section className="workspace-content">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
