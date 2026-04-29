import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthGate } from './auth/AuthContext'
import { AppShell } from './layout/AppShell'
import { AdminPage } from './pages/AdminPage'
import { ArtifactsPage } from './pages/ArtifactsPage'
import { AuditPage } from './pages/AuditPage'
import { DashboardPage } from './pages/DashboardPage'
import { GraphPage } from './pages/GraphPage'
import { IngestionPage } from './pages/IngestionPage'
import { MemoryDetailPage } from './pages/MemoryDetailPage'
import { QueryPage } from './pages/QueryPage'
import { QueryResultPage } from './pages/QueryResultPage'
import { SignalDetailPage } from './pages/SignalDetailPage'
import { SignInPage } from './pages/SignInPage'

function App() {
  return (
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
        <Route path="ingestion" element={<IngestionPage />} />
        <Route path="query" element={<QueryPage />} />
        <Route path="query/:queryRunId" element={<QueryResultPage />} />
        <Route path="signals/:signalId" element={<SignalDetailPage />} />
        <Route path="memory/:memoryType/:memoryId" element={<MemoryDetailPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="admin/users" element={<AdminPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
