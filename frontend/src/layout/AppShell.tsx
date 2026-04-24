import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatDateTime } from '../lib/format'

const primaryNavigation = [
  { to: '/', label: 'Command board', end: true },
  { to: '/artifacts', label: 'Evidence' },
  { to: '/ingestion', label: 'Build' },
  { to: '/query', label: 'Interrogate' },
  { to: '/graph', label: 'Graph' },
]

export function AppShell() {
  const { session, signOut } = useAuth()
  const isAdmin = session?.user.role === 'Admin'
  const navigationItems = isAdmin
    ? [...primaryNavigation, { to: '/audit', label: 'Audit' }, { to: '/admin/users', label: 'Admin' }]
    : [...primaryNavigation, { to: '/audit', label: 'Audit' }]

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
            <span className="brand-kicker">Decision memory</span>
            <span className="brand-name">Izge</span>
          </span>
        </NavLink>

        <nav className="nav-group" aria-label="Primary">
          {navigationItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="session-cluster">
          <div className="identity-block">
            <p className="identity-name">{session?.user.display_name}</p>
            <p className="identity-meta">{session?.user.role} / {formatDateTime(session?.expiresAt)}</p>
          </div>
          <button type="button" className="text-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="workspace-column">
        <section className="workspace-header panel">
          <div className="brand-block">
            <p className="eyebrow">Izge / disputed institutional memory</p>
            <h1 className="brand-title">Memory that argues back</h1>
            <p className="page-description">
              A local-first command surface for reconstructing decisions, finding contradictions, watching assumptions decay, and making the next move feel earned.
            </p>
          </div>
          <div className="brand-proof-strip" aria-label="Izge reasoning modes">
            <span>Lineage</span>
            <span>Contradiction</span>
            <span>Drift</span>
            <span>Evidence</span>
          </div>
          <div className="hero-session panel-subtle">
            <p className="section-label">Current workspace</p>
            <dl className="meta-list compact-meta-list">
              <div>
                <dt>User</dt>
                <dd>{session?.user.display_name ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{session?.user.workspace_id ?? 'Unavailable'}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="workspace-content">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
