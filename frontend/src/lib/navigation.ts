import type { UserRead } from './types'

const demoManagementPages = ['/ingestion', '/graph', '/memory-filesystem', '/orchestration', '/readiness']

export function isDemoManager(user?: UserRead) {
  return user?.is_public_demo === true && user.public_demo_persona === 'selin'
}

export function canViewManagementPage(user: UserRead | undefined, pathname: string) {
  return user?.role === 'Admin' || (isDemoManager(user) && demoManagementPages.includes(pathname))
}

export function isNavigationActive(pathname: string, destination: string) {
  const path = pathname === '/artifacts' ? '/memory' : pathname
  return path === destination || (destination !== '/' && path.startsWith(`${destination}/`))
}
