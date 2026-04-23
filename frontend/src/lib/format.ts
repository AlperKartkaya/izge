export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Unavailable'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatLabel(value: string): string {
  return value.replace(/_/g, ' ')
}
