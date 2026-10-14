export async function consumeSse(response: Response, onEvent: (event: { type: string; data: Record<string, unknown> }) => void | Promise<void>) {
  if (!response.body) throw new Error('Yanıt akışı açılamadı.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r/g, '')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const lines = buffer.slice(0, end).split('\n')
        buffer = buffer.slice(end + 2)
        const type = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        await onEvent({ type, data: JSON.parse(data) as Record<string, unknown> })
        if (type === 'result' || type === 'failed') completed = true
      }
      if (done) break
    }
    if (!completed) throw new Error('Yanıt akışı tamamlanmadan kesildi. Lütfen tekrar deneyin.')
  } finally { reader.releaseLock() }
}
