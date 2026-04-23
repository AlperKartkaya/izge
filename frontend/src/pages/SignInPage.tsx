import { useState, type FormEventHandler } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../lib/api'

export function SignInPage() {
  const { isAuthenticated, isAuthReady, signIn } = useAuth()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from || '/'
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('change-me-admin')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
      <section className="auth-panel panel">
        <div className="auth-copy">
          <p className="eyebrow">Izge MVP</p>
          <h1 className="auth-title">Access the institutional memory workspace</h1>
          <p className="page-description">
            Sign in to review artifacts, run ingestion, trace historical decisions, and inspect evidence-backed query results.
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
          <p className="muted-copy">Use the backend defaults shown here to validate the frontend against the current FastAPI foundation.</p>
        </div>
      </section>
    </main>
  )
}
