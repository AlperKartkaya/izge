import { ButtonIcon } from './ButtonIcon'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../lib/i18n'
import { api } from '../lib/api'
import { AgentText } from './AgentPrimitives'
import { sourcePreviewError, sourcePreviewKind } from '../lib/sourcePreview'
import { copyText } from '../lib/clipboard'

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
  children,
  className,
}: SourcePreviewButtonProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' })
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const [copying, setCopying] = useState(false)
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
          let excerpt: string | undefined
          if (!navigator.pdfViewerEnabled) {
            const textResponse = await fetch(api.artifactPreviewUrl(artifactId, true), { credentials: 'include', signal: controller.signal })
            if (!textResponse.ok) throw new Error('Text preview failed')
            excerpt = await textResponse.text()
          }
          if (active) setPreview({ kind: 'pdf', url: objectUrl, excerpt })
          return
        }

        setPreview({ kind: 'error', message: t('This file type cannot be previewed in the app.', 'Bu dosya türü uygulama içinde önizlenemiyor.') })
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setPreview({ kind: 'error', message: t('Could not load the source preview.', 'Kaynak önizlemesi yüklenemedi.') })
        }
      }
    }

    void loadPreview()

    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [artifactId, open, t])

  async function copyContent() {
    setCopying(true)
    try {
      let content = preview.kind === 'text' ? preview.content : preview.kind === 'pdf' ? preview.excerpt : undefined
      if (content === undefined && preview.kind === 'pdf') {
        const response = await fetch(api.artifactPreviewUrl(artifactId, true), { credentials: 'include' })
        if (!response.ok) throw new Error('Copy source failed')
        content = await response.text()
      }
      if (content === undefined) throw new Error('Clipboard unavailable')
      await copyText(content)
      setCopyStatus('copied')
    } catch { setCopyStatus('error') }
    finally { setCopying(false) }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={['source-preview-button', children ? '' : 'source-preview-icon icon-button', className].filter(Boolean).join(' ')}
        aria-label={children ? undefined : t(`Open ${title}`, `${title} kaynağını aç`)}
        title={t(`Open ${title}`, `${title} kaynağını aç`)}
        onClick={() => {
          setPreview({ kind: 'loading' })
          setCopyStatus('idle')
          setOpen(true)
        }}
      >
        {children ?? <ButtonIcon name="open-source" />}
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
              <span className="source-preview-copy-status" role="status">{copyStatus === 'copied' ? t('Copied', 'Kopyalandı') : copyStatus === 'error' ? t('Copy failed', 'Kopyalanamadı') : ''}</span>
              <button type="button" className="icon-button" title={t('Copy content', 'İçeriği kopyala')} aria-label={t('Copy content', 'İçeriği kopyala')} disabled={copying || (preview.kind !== 'text' && preview.kind !== 'pdf')} onClick={() => void copyContent()}><ButtonIcon name="copy" /></button>
              <button ref={closeButtonRef} className="icon-button" title={t('Close preview', 'Önizlemeyi kapat')} type="button" aria-label={t('Close preview', 'Önizlemeyi kapat')} onClick={() => dialogRef.current?.close()}>
                <ButtonIcon name="close" />
              </button>
            </header>
            <div className="source-preview-body">
              {preview.kind === 'loading' && <p role="status">{t('Loading source…', 'Kaynak yükleniyor…')}</p>}
              {preview.kind === 'text' && <div className="source-preview-text markdown-content"><AgentText text={preview.content || t('This source is empty.', 'Bu kaynak boş.')} /></div>}
              {preview.kind === 'pdf' && (preview.excerpt === undefined
                ? <iframe className="source-preview-frame" src={preview.url} title={t(`${title} PDF preview`, `${title} PDF önizlemesi`)} />
                : <><p className="source-preview-note">{t('Your browser cannot display PDFs. Showing the extracted text.', 'Tarayıcınız PDF görüntüleyemiyor. Çıkarılan metin gösteriliyor.')}</p><div className="source-preview-text markdown-content"><AgentText text={preview.excerpt || t('No text preview is available for this PDF.', 'Bu PDF için metin önizlemesi bulunmuyor.')} /></div><a className="source-preview-download" href={preview.url} download={`${title}.pdf`}><ButtonIcon name="download" />{t('Download PDF', 'PDF’i indir')}</a></>)}
              {preview.kind === 'error' && <p className="source-preview-error" role="alert">{preview.message}</p>}
            </div>
          </dialog>,
          document.body,
        )}
    </>
  )
}
