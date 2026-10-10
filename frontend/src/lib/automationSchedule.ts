import { normalizeApiTimestamp } from './format.ts'
import type { Language } from './language.ts'
import type { AutomationFrequency } from './types.ts'
import type { AgentRunStatus } from './types.ts'

const frequencyLabels: Record<AutomationFrequency, readonly [string, string]> = {
  hourly: ['Every hour', 'Her saat'],
  every_6_hours: ['Every 6 hours', '6 saatte bir'],
  daily: ['Every day', 'Her gün'],
  weekly: ['Every week', 'Her hafta'],
}

export function automationFrequencyLabel(frequency: AutomationFrequency, language: Language) {
  return frequencyLabels[frequency][language === 'en' ? 0 : 1]
}

export function automationRunStatusLabel(status: AgentRunStatus, language: Language) {
  const labels: Record<AgentRunStatus, readonly [string, string]> = {
    queued: ['Queued', 'Sırada'], running: ['In progress', 'Devam ediyor'],
    completed: ['Completed', 'Tamamlandı'], failed: ['Failed', 'Başarısız'],
  }
  return labels[status][language === 'en' ? 0 : 1]
}

export function nextRunRemaining(nextRunAt: string | null, now: Date, language: Language) {
  if (!nextRunAt) return null
  const milliseconds = new Date(normalizeApiTimestamp(nextRunAt)).getTime() - now.getTime()
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return language === 'en' ? 'Due now' : 'Çalışmak üzere'
  const minutes = Math.ceil(milliseconds / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const remainingMinutes = minutes % 60
  const parts = [days ? `${days} ${language === 'en' ? 'd' : 'g'}` : '', hours ? `${hours} ${language === 'en' ? 'h' : 'sa'}` : '', !days && remainingMinutes ? `${remainingMinutes} ${language === 'en' ? 'min' : 'dk'}` : ''].filter(Boolean)
  return language === 'en' ? `Next run in ${parts.join(' ')}` : `Sıradaki çalışmaya ${parts.join(' ')}`
}

export function istanbulDateInput(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function istanbulStartToIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+03:00`).toISOString()
}
