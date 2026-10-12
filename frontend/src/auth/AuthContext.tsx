/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { COOKIE_SESSION_TOKEN, api } from '../lib/api'
import type { DemoPersonaId, SessionState } from '../lib/types'

interface AuthContextValue {
  session: SessionState | null
  isAuthenticated: boolean
  isAuthReady: boolean
  demoSignIn: (persona: DemoPersonaId) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function validateCookieSession() {
      try {
        const user = await api.getCurrentUser()
        if (!cancelled) {
          setSession({
            token: COOKIE_SESSION_TOKEN,
            expiresAt: '',
            user,
          })
        }
      } catch {
        if (!cancelled) {
          void api.signOut().catch(() => undefined)
          setSession(null)
        }
      } finally {
        if (!cancelled) {
          setIsAuthReady(true)
        }
      }
    }

    void validateCookieSession()

    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session) && isAuthReady,
      isAuthReady,
      async demoSignIn(persona: DemoPersonaId) {
        const response = await api.demoSignIn(persona)
        setSession({
          token: response.access_token,
          expiresAt: response.expires_at,
          user: response.user,
        })
      },
      async signIn(email: string, password: string) {
        const response = await api.signIn(email, password)
        setSession({
          token: response.access_token,
          expiresAt: response.expires_at,
          user: response.user,
        })
      },
      signOut() {
        const token = session?.token
        setSession(null)
        if (token) {
          void api.signOut(token).catch(() => undefined)
        }
      },
      async refreshUser() {
        if (!session) {
          return
        }

        const user = await api.getCurrentUser(session.token)
        setSession({
          ...session,
          user,
        })
      },
    }),
    [isAuthReady, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return value
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isAuthReady } = useAuth()
  const location = useLocation()

  if (!isAuthReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
