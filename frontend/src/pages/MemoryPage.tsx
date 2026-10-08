import { useAuth } from '../auth/AuthContext'
import { ArtifactsPage } from './ArtifactsPage'
import { EmployeeMemoryPage } from './EmployeeMemoryPage'

export function MemoryPage() {
  const { session } = useAuth()
  return session?.user.role === 'Admin' ? <ArtifactsPage /> : <EmployeeMemoryPage />
}
