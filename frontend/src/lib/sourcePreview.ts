import { translate } from './language.ts'

export type SourcePreviewKind = 'text' | 'pdf' | 'unsupported'

export function sourcePreviewKind(contentType: string | null): SourcePreviewKind {
  const mimeType = contentType?.split(';', 1)[0].trim().toLowerCase()

  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType?.startsWith('text/')) return 'text'
  return 'unsupported'
}

export function sourcePreviewError(status: number): string {
  if (status === 401 || status === 403) return translate('You do not have permission to view this source.', 'Bu kaynağı görüntüleme yetkiniz yok.')
  if (status === 404) return translate('Source not found.', 'Kaynak bulunamadı.')
  return translate('Could not load the source preview.', 'Kaynak önizlemesi yüklenemedi.')
}
