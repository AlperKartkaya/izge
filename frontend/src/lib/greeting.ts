import type { Language } from './language.ts'

export function homeGreeting(name: string, language: Language, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Istanbul' }).format(now))
  const period = hour >= 5 && hour < 12 ? ['Good morning', 'Günaydın'] : hour >= 12 && hour < 18 ? ['Good afternoon', 'İyi günler'] : ['Good evening', 'İyi akşamlar']
  return `${period[language === 'en' ? 0 : 1]}${name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ''}`
}
