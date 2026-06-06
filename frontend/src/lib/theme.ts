export type ThemePreference = 'dark' | 'light'

export const themeStorageKey = 'izge-theme-preference'

export function readInitialThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  return window.localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark'
}

export function applyThemePreference(theme: ThemePreference) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(themeStorageKey, theme)
  }
}

export function nextThemePreference(theme: ThemePreference): ThemePreference {
  return theme === 'dark' ? 'light' : 'dark'
}
