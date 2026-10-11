import type { CSSProperties } from 'react'
import logo from '../assets/branding/izge.png'

export function IzgeLogo() {
  return <span className="izge-logo" aria-hidden="true" style={{ '--izge-logo': `url("${logo}")` } as CSSProperties} />
}
