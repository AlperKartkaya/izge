import { normalizeApiTimestamp } from './format.ts'

export function filterSourceList<T extends { title: string; updated_at: string }>(
  sources: T[], query: string, sort: 'title' | 'recent', locale: string,
): T[] {
  const search = query.trim().toLocaleLowerCase(locale)
  return sources
    .filter((source) => source.title.toLocaleLowerCase(locale).includes(search))
    .sort((left, right) => sort === 'title'
      ? left.title.localeCompare(right.title, locale)
      : (Date.parse(normalizeApiTimestamp(right.updated_at)) || 0) - (Date.parse(normalizeApiTimestamp(left.updated_at)) || 0))
}
