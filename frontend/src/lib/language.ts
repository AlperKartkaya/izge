export type Language = 'tr' | 'en'
export const languageStorageKey = 'izge-language'

export function readInitialLanguage(): Language {
  try { return globalThis.localStorage?.getItem(languageStorageKey) === 'en' ? 'en' : 'tr' } catch { return 'tr' }
}

let currentLanguage = readInitialLanguage()
export function getLanguage(): Language { return currentLanguage }
export function setCurrentLanguage(language: Language) {
  currentLanguage = language
  try { globalThis.localStorage?.setItem(languageStorageKey, language) } catch { /* Private browsing can disable storage. */ }
}
export function translate(english: string, turkish: string, language = getLanguage()): string {
  return language === 'en' ? english : turkish
}
export function currentLocale(): string { return getLanguage() === 'en' ? 'en-GB' : 'tr-TR' }
