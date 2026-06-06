import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthGate, useAuth } from './auth/AuthContext'
import { AppShell } from './layout/AppShell'
import { AdminPage } from './pages/AdminPage'
import { ArtifactsPage } from './pages/ArtifactsPage'
import { AuditPage } from './pages/AuditPage'
import { DataAdminPage } from './pages/DataAdminPage'
import { DashboardPage } from './pages/DashboardPage'
import { GraphPage } from './pages/GraphPage'
import { IngestionPage } from './pages/IngestionPage'
import { MemoryFilesystemPage } from './pages/MemoryFilesystemPage'
import { MemoryDetailPage } from './pages/MemoryDetailPage'
import { OrchestrationPage } from './pages/OrchestrationPage'
import { QueryPage } from './pages/QueryPage'
import { QueryResultPage } from './pages/QueryResultPage'
import { SignalDetailPage } from './pages/SignalDetailPage'
import { SignInPage } from './pages/SignInPage'
import { TargetReadinessPage } from './pages/TargetReadinessPage'
import { TeamChatPage } from './pages/TeamChatPage'

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const { session } = useAuth()

  if (session?.user.role !== 'Admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route
          path="/"
          element={
            <AuthGate>
              <AppShell />
            </AuthGate>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="artifacts" element={<ArtifactsPage />} />
          <Route
            path="ingestion"
            element={
              <AdminOnlyRoute>
                <IngestionPage />
              </AdminOnlyRoute>
            }
          />
          <Route path="team-chat" element={<TeamChatPage />} />
          <Route path="query" element={<QueryPage />} />
          <Route path="query/:queryRunId" element={<QueryResultPage />} />
          <Route path="signals/:signalId" element={<SignalDetailPage />} />
          <Route path="memory/:memoryType/:memoryId" element={<MemoryDetailPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route
            path="memory-filesystem"
            element={
              <AdminOnlyRoute>
                <MemoryFilesystemPage />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="orchestration"
            element={
              <AdminOnlyRoute>
                <OrchestrationPage />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="readiness"
            element={
              <AdminOnlyRoute>
                <TargetReadinessPage />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="admin"
            element={
              <AdminOnlyRoute>
                <AdminPage />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="admin/users"
            element={
              <AdminOnlyRoute>
                <AdminPage />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="admin/data"
            element={
              <AdminOnlyRoute>
                <DataAdminPage />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="audit"
            element={
              <AdminOnlyRoute>
                <AuditPage />
              </AdminOnlyRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App
