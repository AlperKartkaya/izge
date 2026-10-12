import type { CSSProperties } from 'react'
import logo from '../assets/branding/icon.svg'

export function IzgeLogo() {
  return <span className="izge-logo" aria-hidden="true" style={{ '--izge-logo': `url("${logo}")` } as CSSProperties} />
}
