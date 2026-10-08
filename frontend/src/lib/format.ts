const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const explicitZonePattern = /(Z|[+-]\d{2}:?\d{2})$/i

export function normalizeApiTimestamp(value: string): string {
  if (dateOnlyPattern.test(value) || explicitZonePattern.test(value)) {
    return value
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? `${value}Z` : value
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Mevcut değil'
  }

  const parsed = new Date(normalizeApiTimestamp(value))
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(parsed)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'Mevcut değil'
  }

  const parsed = new Date(normalizeApiTimestamp(value))
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeZone: 'Europe/Istanbul',
  }).format(parsed)
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

const statusLabels: Record<string, string> = {
  active: 'Geçerli',
  stale: 'Yeniden incelenmeli',
  reversed: 'Tersine döndü',
  weakening: 'Zayıflıyor',
  assumption_drift: 'Varsayım değişikliği',
  next_action: 'Önerilen iş',
  continuity_overlap: 'İlgili önceki çalışma',
  contradiction: 'Çelişki',
  supersession: 'Güncellenen karar',
  open_commitment: 'Açık taahhüt',
  pending: 'Bekliyor',
  queued: 'Sırada',
  running: 'Çalışıyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  open: 'Açık',
  in_progress: 'Devam ediyor',
  done: 'Tamamlandı',
  submitted: 'İncelemede',
  needs_review: 'İnceleme gerekli',
  reviewed: 'İncelendi',
  rejected: 'Reddedildi',
}

export function formatStatus(value: string): string {
  return statusLabels[value] ?? formatLabel(value)
}
