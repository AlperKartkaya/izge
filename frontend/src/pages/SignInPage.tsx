import { useEffect, useState, type FormEventHandler } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../lib/api'
import {
  applyThemePreference,
  nextThemePreference,
  readInitialThemePreference,
  type ThemePreference,
} from '../lib/theme'

const ADMIN_EMAIL =
  import.meta.env.VITE_DEFAULT_ADMIN_EMAIL?.trim() ||
  import.meta.env.VITE_DEMO_ADMIN_EMAIL?.trim() ||
  'admin@example.com'
const ADMIN_PASSWORD =
  import.meta.env.VITE_DEFAULT_ADMIN_PASSWORD?.trim() ||
  import.meta.env.VITE_DEMO_ADMIN_PASSWORD?.trim() ||
  'change-me-admin'

interface FastLoginAccount {
  label: string
  description: string
  email: string
  password: string
  icon: string
}

const FAST_LOGIN_ACCOUNTS: FastLoginAccount[] = [
  {
    label: 'Sign in as Employee 1',
    description: 'Employee workspace access',
    email: 'employee1@example.com',
    password: 'change-me-employee1',
    icon: 'E1',
  },
  {
    label: 'Sign in as Employee 2',
    description: 'Employee workspace access',
    email: 'employee2@example.com',
    password: 'change-me-employee2',
    icon: 'E2',
  },
  {
    label: 'Sign in as Admin',
    description: 'Administration access',
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    icon: 'AD',
  },
]

export function SignInPage() {
  const { isAuthenticated, isAuthReady, signIn } = useAuth()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from || '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showManualSignIn, setShowManualSignIn] = useState(false)
  const [activeFastEmail, setActiveFastEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(() =>
    readInitialThemePreference(),
  )
  const nextTheme = nextThemePreference(theme)

  useEffect(() => {
    applyThemePreference(theme)
  }, [theme])

  if (isAuthReady && isAuthenticated) {
    return <Navigate to={redirectTo} replace />
  }

  async function submitCredentials(nextEmail: string, nextPassword: string) {
    setIsSubmitting(true)
    setError(null)

    try {
      await signIn(nextEmail, nextPassword)
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : 'Unable to sign in.',
      )
    } finally {
      setIsSubmitting(false)
      setActiveFastEmail(null)
    }
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    await submitCredentials(email, password)
  }

  const handleFastLogin = async (account: FastLoginAccount) => {
    setEmail(account.email)
    setPassword(account.password)
    setActiveFastEmail(account.email)
    await submitCredentials(account.email, account.password)
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
        <button
          type="button"
          className="theme-toggle auth-theme-toggle"
          aria-label={`Switch to ${nextTheme} theme`}
          aria-pressed={theme === 'light'}
          onClick={() => setTheme(nextTheme)}
        >
          <span aria-hidden="true" className="theme-toggle-icon">
            {theme === 'dark' ? '☀' : '☾'}
          </span>
          <span className="theme-toggle-label">
            {theme === 'dark' ? 'Light' : 'Dark'}
          </span>
        </button>
      </header>
      <section className="auth-panel panel">
        <div className="auth-copy">
          <p className="eyebrow">Izge workspace</p>
          <h1 className="auth-title">Sign in to Izge</h1>
          <p className="page-description">
            Choose a workspace identity to continue.
          </p>
        </div>

        <div className="quick-login-grid" aria-label="Fast sign-in options">
          {FAST_LOGIN_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="quick-login-button"
              disabled={isSubmitting}
              onClick={() => void handleFastLogin(account)}
            >
              <span className="quick-login-icon" aria-hidden="true">
                {account.icon}
              </span>
              <span className="quick-login-copy">
                <span>
                  {activeFastEmail === account.email
                    ? 'Signing in…'
                    : account.label}
                </span>
                <small>{account.description}</small>
              </span>
            </button>
          ))}
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="auth-divider" role="presentation" />

        <button
          type="button"
          className="secondary-button auth-manual-toggle"
          aria-expanded={showManualSignIn}
          onClick={() => setShowManualSignIn((current) => !current)}
        >
          {showManualSignIn
            ? 'Hide different-user sign in'
            : 'Sign in as a different user'}
        </button>

        {showManualSignIn ? (
          <form className="form-grid auth-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                required
              />
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

            <button
              type="submit"
              className="primary-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  )
}
