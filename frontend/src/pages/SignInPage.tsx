import { Select } from '../components/Select'
import { ThemeIcon } from '../components/ThemeIcon'
import { IzgeLogo } from '../components/IzgeLogo'
import { useEffect, useState, type FormEventHandler } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError, api } from '../lib/api'
import { applyThemePreference, nextThemePreference, readInitialThemePreference, type ThemePreference } from '../lib/theme'
import { useLanguage } from '../lib/i18n'
import type { DemoConfigRead, DemoPersonaId } from '../lib/types'

export function SignInPage() {
  const { language, setLanguage, t } = useLanguage()
  const { demoSignIn, isAuthenticated, isAuthReady, signIn } = useAuth()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from || '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [demoConfig, setDemoConfig] = useState<DemoConfigRead | null>()
  const [error, setError] = useState<string | null>(null)
  const [showAdminSignIn, setShowAdminSignIn] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittingPersona, setSubmittingPersona] = useState<DemoPersonaId | null>(null)
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialThemePreference())
  const nextTheme = nextThemePreference(theme)
  useEffect(() => { applyThemePreference(theme) }, [theme])
  useEffect(() => {
    let cancelled = false
    void api.getDemoConfig()
      .then((config) => { if (!cancelled) setDemoConfig(config) })
      .catch(() => { if (!cancelled) setDemoConfig(null) })
    return () => { cancelled = true }
  }, [])
  if (isAuthReady && isAuthenticated) return <Navigate to={redirectTo} replace />

  const activeDemoConfig = demoConfig?.enabled ? demoConfig : null

  const choosePersona = async (persona: DemoPersonaId) => {
    setSubmittingPersona(persona); setError(null)
    try { await demoSignIn(persona) }
    catch (caughtError) {
      setError(caughtError instanceof ApiError && caughtError.status === 429
        ? t('This IP address has reached the hourly demo sign-in limit. Please try again in an hour.', 'Bu IP adresi saatlik demo giriş sınırına ulaştı. Lütfen bir saat sonra tekrar deneyin.')
        : t('Could not open the demo. Please try again.', 'Demo açılamadı. Lütfen tekrar deneyin.'))
    }
    finally { setSubmittingPersona(null) }
  }

  const submit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault(); setIsSubmitting(true); setError(null)
    try { await signIn(email, password) }
    catch (caughtError) { setError(caughtError instanceof ApiError && caughtError.status === 401 ? t('Incorrect email or password.', 'E-posta veya parola hatalı.') : t('Could not sign in. Please try again.', 'Giriş yapılamadı. Lütfen tekrar deneyin.')) }
    finally { setIsSubmitting(false) }
  }

  return <main className="auth-layout">
    <header className="auth-shell-bar" aria-label={t('Sign-in controls', 'Giriş kontrolleri')}>
      <div className="auth-brand">
        <span className="auth-brand-logo"><IzgeLogo /></span>
        <span><span className="brand-kicker">{t('Company memory', 'Şirket hafızası')}</span><span className="brand-name">Izge</span></span>
      </div>
      <div className="auth-controls">
        <label className="language-select">
          <span className="sr-only">{t('Language', 'Dil')}</span>
          <Select value={language} onValueChange={(value) => setLanguage(value === 'en' ? 'en' : 'tr')} aria-label={t('Language', 'Dil')} options={[{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }]} />
        </label>
        <button type="button" className="theme-toggle auth-theme-toggle" aria-label={t(`Switch to ${nextTheme === 'dark' ? 'dark' : 'light'} theme`, `${nextTheme === 'dark' ? 'Koyu' : 'Açık'} temaya geç`)} onClick={() => setTheme(nextTheme)}>
          <span aria-hidden="true"><ThemeIcon theme={theme} /></span>
        </button>
      </div>
    </header>
    <section className="auth-panel panel">
      <div className="auth-copy">
        <h1 className="auth-title">{t('Welcome to Izge', 'İzge’ye hoş geldiniz')}</h1>
        <p className="page-description">{activeDemoConfig && !showAdminSignIn ? t('Choose a teammate and explore the company memory.', 'Bir ekip arkadaşı seçin ve şirket hafızasını keşfedin.') : t('Continue working with Izge where you left off.', 'İzge ile çalışmaya kaldığınız yerden devam edin.')}</p>
      </div>
      {demoConfig === undefined ? <p className="muted-copy" role="status">{t('Loading sign-in options…', 'Giriş seçenekleri yükleniyor…')}</p> : null}
      {error ? <p id="sign-in-error" className="form-error" role="alert">{error}</p> : null}
      {activeDemoConfig && !showAdminSignIn ? <>
        <div className="quick-login-grid" aria-label={t('Demo profiles', 'Demo profilleri')}>
          {activeDemoConfig.personas.map((persona) => <button
            key={persona.id}
            type="button"
            className="quick-login-button"
            disabled={submittingPersona !== null}
            aria-describedby="demo-limit-note"
            onClick={() => void choosePersona(persona.id)}
          >
            <span className="quick-login-icon" aria-hidden="true">{persona.name.slice(0, 1)}</span>
            <span className="quick-login-copy">
              <strong>{persona.name}</strong>
              <small>{persona.id === 'kerem' ? t('Software Engineer', 'Yazılım Mühendisi') : persona.id === 'selin' ? t('Team Lead', 'Ekip Lideri') : persona.title}</small>
              {submittingPersona === persona.id ? <small>{t('Opening demo…', 'Demo açılıyor…')}</small> : null}
            </span>
          </button>)}
        </div>
        <p id="demo-limit-note" className="auth-demo-limit muted-copy">{t(`For each IP address, up to ${activeDemoConfig.hourly_limit} demo sign-ins are allowed per hour.`, `Her IP adresi için saatte en fazla ${activeDemoConfig.hourly_limit} demo girişine izin verilir.`)}</p>
        <div className="auth-divider" aria-hidden="true" />
        <button type="button" className="secondary-button auth-manual-toggle" aria-expanded="false" aria-controls="admin-sign-in-form" onClick={() => { setError(null); setShowAdminSignIn(true) }}>{t('Administrator sign-in', 'Yönetici girişi')}</button>
      </> : demoConfig !== undefined ? <>
        <form id="admin-sign-in-form" className="form-grid auth-form" onSubmit={submit}>
          <label className="field"><span className="field-label">{t('Email', 'E-posta')}</span><input name="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby={error ? 'sign-in-error' : undefined} required /></label>
          <label className="field"><span className="field-label">{t('Password', 'Parola')}</span><input name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" aria-describedby={error ? 'sign-in-error' : undefined} required /></label>
          <button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? t('Signing in…', 'Giriş yapılıyor…') : t('Sign in', 'Giriş yap')}</button>
        </form>
        {activeDemoConfig ? <button type="button" className="text-button auth-manual-toggle" aria-expanded="true" aria-controls="admin-sign-in-form" onClick={() => { setError(null); setShowAdminSignIn(false) }}>{t('Back to demo profiles', 'Demo profillerine dön')}</button> : null}
      </> : null}
    </section>
  </main>
}
