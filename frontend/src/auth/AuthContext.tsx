/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import type { SessionState } from '../lib/types'

interface AuthContextValue {
  session: SessionState | null
  isAuthenticated: boolean
  isAuthReady: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  refreshUser: () => Promise<void>
}

const STORAGE_KEY = 'izge.session'
const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function readStoredSession(): SessionState | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as SessionState
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(() => readStoredSession())
  const [isAuthReady, setIsAuthReady] = useState<boolean>(() => !readStoredSession()?.token)

  useEffect(() => {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      return
    }

    window.localStorage.removeItem(STORAGE_KEY)
  }, [session])

  useEffect(() => {
    let cancelled = false

    async function validateStoredSession() {
      if (!session?.token) {
        setIsAuthReady(true)
        return
      }

      setIsAuthReady(false)

      try {
        const user = await api.getCurrentUser(session.token)
        if (!cancelled) {
          setSession((current) => (current ? { ...current, user } : current))
          setIsAuthReady(true)
        }
      } catch {
        if (!cancelled) {
          setSession(null)
          setIsAuthReady(true)
        }
      }
    }

    void validateStoredSession()

    return () => {
      cancelled = true
    }
  }, [session?.token])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session?.token) && isAuthReady,
      isAuthReady,
      async signIn(email: string, password: string) {
        const response = await api.signIn(email, password)
        setSession({
          token: response.access_token,
          expiresAt: response.expires_at,
          user: response.user,
        })
      },
      signOut() {
        setSession(null)
      },
      async refreshUser() {
        if (!session?.token) {
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
