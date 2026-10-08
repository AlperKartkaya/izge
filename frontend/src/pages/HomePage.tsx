import { useAuth } from '../auth/AuthContext'
import { DashboardPage } from './DashboardPage'
import { EmployeeHomePage } from './EmployeeHomePage'

export function HomePage() {
  const { session } = useAuth()
  return session?.user.role === 'Admin' ? <DashboardPage /> : <EmployeeHomePage />
}
