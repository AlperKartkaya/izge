import { Select } from '../components/Select'
import { ThemeIcon } from '../components/ThemeIcon'
import { IzgeLogo } from '../components/IzgeLogo'
import { useEffect, useState, type FormEventHandler } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../lib/api'
import { applyThemePreference, nextThemePreference, readInitialThemePreference, type ThemePreference } from '../lib/theme'
import { useLanguage } from '../lib/i18n'

export function SignInPage() {
  const { language, setLanguage, t } = useLanguage()
  const { isAuthenticated, isAuthReady, signIn } = useAuth()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from || '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialThemePreference())
  const nextTheme = nextThemePreference(theme)
  useEffect(() => { applyThemePreference(theme) }, [theme])
  if (isAuthReady && isAuthenticated) return <Navigate to={redirectTo} replace />

  const submit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault(); setIsSubmitting(true); setError(null)
    try { await signIn(email, password) }
    catch (caughtError) { setError(caughtError instanceof ApiError && caughtError.status === 401 ? t('Incorrect email or password.', 'E-posta veya parola hatalı.') : t('Could not sign in. Please try again.', 'Giriş yapılamadı. Lütfen tekrar deneyin.')) }
    finally { setIsSubmitting(false) }
  }

  return <main className="auth-layout">
    <header className="auth-shell-bar" aria-label={t('Sign-in controls', 'Giriş kontrolleri')}><div className="auth-brand"><span className="auth-brand-logo"><IzgeLogo /></span><span><span className="brand-kicker">{t('Company memory', 'Şirket hafızası')}</span><span className="brand-name">Izge</span></span></div><div className="auth-controls"><label className="language-select"><span className="sr-only">{t('Language', 'Dil')}</span><Select value={language} onValueChange={(value) => setLanguage(value === 'en' ? 'en' : 'tr')} aria-label={t('Language', 'Dil')} options={[{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }]} /></label><button type="button" className="theme-toggle auth-theme-toggle" aria-label={t(`Switch to ${nextTheme === 'dark' ? 'dark' : 'light'} theme`, `${nextTheme === 'dark' ? 'Koyu' : 'Açık'} temaya geç`)} onClick={() => setTheme(nextTheme)}><span aria-hidden="true"><ThemeIcon theme={theme} /></span></button></div></header>
    <section className="auth-panel panel"><div className="auth-copy"><h1 className="auth-title">{t('Welcome to Izge', 'İzge’ye hoş geldiniz')}</h1><p className="page-description">{t('Continue working with Izge where you left off.', 'İzge ile çalışmaya kaldığınız yerden devam edin.')}</p></div>{error ? <p id="sign-in-error" className="form-error" role="alert">{error}</p> : null}<form className="form-grid auth-form" onSubmit={submit}><label className="field"><span className="field-label">{t('Email', 'E-posta')}</span><input name="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby={error ? 'sign-in-error' : undefined} required /></label><label className="field"><span className="field-label">{t('Password', 'Parola')}</span><input name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" aria-describedby={error ? 'sign-in-error' : undefined} required /></label><button type="submit" className="primary-button" disabled={isSubmitting}>{isSubmitting ? t('Signing in…', 'Giriş yapılıyor…') : t('Sign in', 'Giriş yap')}</button></form></section>
  </main>
}
