export function progressPercent(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)
}
