export async function copyText(text: string) {
  try {
    if (navigator.clipboard) { await navigator.clipboard.writeText(text); return }
  } catch { /* Some self-hosted browsers block clipboard permissions even on localhost. */ }
  const previous = document.activeElement as HTMLElement | null
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('aria-hidden', 'true')
  input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0'
  // A modal makes the rest of the document inert, so copy from inside the open dialog.
  ;(document.querySelector('dialog[open]') ?? document.body).append(input)
  try {
    input.focus(); input.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally { input.remove(); previous?.focus() }
}
