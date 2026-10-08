import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, COOKIE_SESSION_TOKEN } from '../lib/api'
import { sourcePreviewError, sourcePreviewKind } from '../lib/sourcePreview'

type Preview =
  | { kind: 'loading' }
  | { kind: 'text'; content: string }
  | { kind: 'pdf'; url: string; excerpt?: string }
  | { kind: 'error'; message: string }

interface SourcePreviewButtonProps {
  artifactId: string
  title: string
  children?: ReactNode
  className?: string
}

export function SourcePreviewButton({
  artifactId,
  title,
  children = 'Kaynağı aç',
  className,
}: SourcePreviewButtonProps) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useLayoutEffect(() => {
    if (!open) return

    const dialog = dialogRef.current
    const trigger = triggerRef.current
    if (dialog && !dialog.open) dialog.showModal()
    closeButtonRef.current?.focus()

    return () => {
      if (dialog?.open) dialog.close()
      trigger?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    let active = true
    let objectUrl: string | undefined

    async function loadPreview() {
      try {
        const response = await fetch(api.artifactPreviewUrl(artifactId), {
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok) {
          if (active) setPreview({ kind: 'error', message: sourcePreviewError(response.status) })
          return
        }

        const kind = sourcePreviewKind(response.headers.get('content-type'))
        if (kind === 'text') {
          const content = await response.text()
          if (active) setPreview({ kind: 'text', content })
          return
        }
        if (kind === 'pdf') {
          const blob = await response.blob()
          if (!active) return
          objectUrl = URL.createObjectURL(blob)
          const excerpt = navigator.pdfViewerEnabled ? undefined
            : (await api.getArtifact(COOKIE_SESSION_TOKEN, artifactId)).extracted_text_preview ?? ''
          if (active) setPreview({ kind: 'pdf', url: objectUrl, excerpt })
          return
        }

        setPreview({ kind: 'error', message: 'Bu dosya türü uygulama içinde önizlenemiyor.' })
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setPreview({ kind: 'error', message: 'Kaynak önizlemesi yüklenemedi.' })
        }
      }
    }

    void loadPreview()

    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [artifactId, open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={['source-preview-button', className].filter(Boolean).join(' ')}
        onClick={() => {
          setPreview({ kind: 'loading' })
          setOpen(true)
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialogRef}
            className="source-preview-dialog"
            aria-labelledby={titleId}
            onClose={() => setOpen(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) event.currentTarget.close()
            }}
          >
            <header className="source-preview-header">
              <h2 id={titleId}>{title}</h2>
              <button ref={closeButtonRef} type="button" aria-label="Önizlemeyi kapat" onClick={() => dialogRef.current?.close()}>
                ×
              </button>
            </header>
            <div className="source-preview-body">
              {preview.kind === 'loading' && <p role="status">Kaynak yükleniyor…</p>}
              {preview.kind === 'text' && <pre className="source-preview-text">{preview.content || 'Bu kaynak boş.'}</pre>}
              {preview.kind === 'pdf' && (preview.excerpt === undefined
                ? <iframe className="source-preview-frame" src={preview.url} title={`${title} PDF önizlemesi`} />
                : <><p className="source-preview-note">Tarayıcınız PDF görüntüleyemiyor. Metnin ilk 500 karakteri gösteriliyor.</p><pre className="source-preview-text">{preview.excerpt || 'Bu PDF için metin önizlemesi bulunmuyor.'}</pre><a className="source-preview-download" href={preview.url} download={`${title}.pdf`}>PDF’i indir</a></>)}
              {preview.kind === 'error' && <p className="source-preview-error" role="alert">{preview.message}</p>}
            </div>
          </dialog>,
          document.body,
        )}
    </>
  )
}
