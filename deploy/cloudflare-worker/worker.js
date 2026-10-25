const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://alperkartkaya.github.io',
  'https://izge.dev',
  'https://app.izge.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false
  if (DEFAULT_ALLOWED_ORIGINS.has(origin)) return true
  const extra = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return extra.includes(origin)
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    if (!isAllowedOrigin(origin, env)) {
      return new Response('Forbidden origin', { status: 403 })
    }

    const headers = corsHeaders(origin)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }

    const url = new URL(request.url)
    if (request.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      return new Response('Not Found', { status: 404, headers })
    }

    if (!env.DEEPSEEK_API_KEY) {
      return new Response(JSON.stringify({ error: 'DEEPSEEK_API_KEY not configured' }), {
        status: 503,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const rawBody = await request.text()
    if (rawBody.length > 48_000) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    let parsed
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const messages = Array.isArray(parsed.messages) ? parsed.messages.slice(0, 6) : []
    const upstreamUrl = `${(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`

    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: true,
        temperature: 0.2,
        max_tokens: 700,
        messages,
      }),
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...headers,
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  },
}
