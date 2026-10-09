/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getLanguage, setCurrentLanguage, translate, type Language } from './language'

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (english: string, turkish: string) => string }
const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getLanguage)
  useEffect(() => { document.documentElement.lang = language }, [language])
  const setLanguage = useCallback((next: Language) => { setCurrentLanguage(next); setLanguageState(next) }, [])
  const t = useCallback((en: string, tr: string) => translate(en, tr, language), [language])
  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used within LanguageProvider')
  return context
}
