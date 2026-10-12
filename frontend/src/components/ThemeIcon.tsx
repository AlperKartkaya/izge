import { Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '../lib/theme'

export function ThemeIcon({ theme }: { theme: ThemePreference }) {
  const Icon = theme === 'dark' ? Sun : Moon
  return <Icon className="theme-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
}
