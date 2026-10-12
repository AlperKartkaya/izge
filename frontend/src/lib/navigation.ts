export function isNavigationActive(pathname: string, destination: string) {
  const path = pathname === '/artifacts' ? '/memory' : pathname
  return path === destination || (destination !== '/' && path.startsWith(`${destination}/`))
}
