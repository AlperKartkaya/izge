import { useEffect, useState, type FormEventHandler } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../lib/api'
import { applyThemePreference, nextThemePreference, readInitialThemePreference, type ThemePreference } from '../lib/theme'

const DEMO_ADMIN_EMAIL = import.meta.env.VITE_DEMO_ADMIN_EMAIL?.trim() || 'admin@example.com'
const DEMO_ADMIN_PASSWORD = import.meta.env.VITE_DEMO_ADMIN_PASSWORD?.trim() || 'change-me-admin'

export function SignInPage() {
  const { isAuthenticated, isAuthReady, signIn } = useAuth()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from || '/'
  const [email, setEmail] = useState(DEMO_ADMIN_EMAIL)
  const [password, setPassword] = useState(DEMO_ADMIN_PASSWORD)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialThemePreference())
  const nextTheme = nextThemePreference(theme)

  useEffect(() => {
    applyThemePreference(theme)
  }, [theme])

  if (isAuthReady && isAuthenticated) {
    return <Navigate to={redirectTo} replace />
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      await signIn(email, password)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to sign in.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-layout">
      <header className="auth-shell-bar" aria-label="Sign-in controls">
        <div className="auth-brand">
          <span className="brand-sigil">IZ</span>
          <span>
            <span className="brand-kicker">Company memory</span>
            <span className="brand-name">Izge</span>
          </span>
        </div>
        <button type="button" className="theme-toggle auth-theme-toggle" aria-label={`Switch to ${nextTheme} theme`} aria-pressed={theme === 'light'} onClick={() => setTheme(nextTheme)}>
          <span aria-hidden="true" className="theme-toggle-icon">{theme === 'dark' ? '☀' : '☾'}</span>
          <span className="theme-toggle-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </header>
      <section className="auth-panel panel">
        <div className="auth-copy">
          <p className="eyebrow">Izge workspace</p>
          <h1 className="auth-title">Sign in to company memory</h1>
          <p className="page-description">
            Use your company account to access artifacts, evidence-backed answers, ingestion status, and role-specific administration tools.
          </p>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="panel-subtle auth-footnote">
          <p className="section-label">Seeded local admin</p>
          <p className="muted-copy">Local credentials are pre-filled for development and Docker runs. Change them before any shared or production deployment.</p>
        </div>
      </section>
    </main>
  )
}
