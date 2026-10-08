export type SourcePreviewKind = 'text' | 'pdf' | 'unsupported'

export function sourcePreviewKind(contentType: string | null): SourcePreviewKind {
  const mimeType = contentType?.split(';', 1)[0].trim().toLowerCase()

  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType?.startsWith('text/')) return 'text'
  return 'unsupported'
}

export function sourcePreviewError(status: number): string {
  if (status === 401 || status === 403) return 'Bu kaynağı görüntüleme yetkiniz yok.'
  if (status === 404) return 'Kaynak bulunamadı.'
  return 'Kaynak önizlemesi yüklenemedi.'
}
