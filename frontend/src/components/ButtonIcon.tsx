import type { CSSProperties } from 'react'

const files = import.meta.glob<string>('../assets/button-icons/*.png', { eager: true, query: '?url', import: 'default' })

export function ButtonIcon({ name, className = '' }: { name: string; className?: string }) {
  const url = files[`../assets/button-icons/${name}.png`]
  if (!url) return null
  return <span className={`button-icon ${className}`} aria-hidden="true" style={{ '--button-icon': `url("${url}")` } as CSSProperties} />
}
