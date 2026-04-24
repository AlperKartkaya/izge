import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatDateTime } from '../lib/format'

const primaryNavigation = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/artifacts', label: 'Memory sources' },
  { to: '/ingestion', label: 'Build memory' },
  { to: '/query', label: 'Ask history' },
  { to: '/graph', label: 'Decision history' },
]

export function AppShell() {
  const { session, signOut } = useAuth()
  const isAdmin = session?.user.role === 'Admin'

  return (
    <div className="app-frame">
      <aside className="sidebar panel">
        <div className="brand-block">
          <p className="eyebrow">Izge</p>
          <h1 className="brand-title">Institutional memory</h1>
          <p className="muted-copy">
            A local-first workspace for reconstructing what the team decided, why it decided it, and what history suggests next.
          </p>
        </div>

        <nav className="nav-group" aria-label="Primary">
          {primaryNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? 'nav-link nav-link-active' : 'nav-link'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-section">
          <p className="section-label">Governance</p>
          <NavLink
            to="/audit"
            className={({ isActive }) =>
              isActive ? 'nav-link nav-link-active' : 'nav-link'
            }
          >
            Audit log
          </NavLink>
          {isAdmin ? (
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                isActive ? 'nav-link nav-link-active' : 'nav-link'
              }
            >
              Admin users & permissions
            </NavLink>
          ) : null}
        </div>

        <div className="sidebar-meta panel-subtle">
          <p className="section-label">Session</p>
          <dl className="meta-list compact-meta-list">
            <div>
              <dt>Role</dt>
              <dd>{session?.user.role ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{session?.user.workspace_id ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{formatDateTime(session?.expiresAt)}</dd>
            </div>
          </dl>
          <button type="button" className="secondary-button full-width" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="workspace-column">
        <header className="workspace-header panel">
          <div>
            <p className="eyebrow">Single workspace</p>
            <h2 className="page-title">Institutional memory workspace</h2>
          </div>
          <div className="identity-block">
            <p className="identity-name">{session?.user.display_name}</p>
            <p className="identity-meta">{session?.user.email}</p>
          </div>
        </header>

        <section className="workspace-content">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
