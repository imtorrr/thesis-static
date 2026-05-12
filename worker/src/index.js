const ALLOWED_ORIGINS = [
  'https://thesis.imtorrr.xyz',
  'https://thesis-static.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

const MAX_CHUNK = 4 * 1024 * 1024   // 4 MB per request — COPC nodes are ~50–500 KB each

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return addCors(request, new Response(null, { status: 204 }))
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    // Block requests not coming from the viewer
    const referer = request.headers.get('Referer') ?? ''
    if (!ALLOWED_ORIGINS.some(o => referer.startsWith(o))) {
      return new Response('Forbidden', { status: 403 })
    }

    // Block requests without Range header — browser URL bar / wget send none
    const rangeHeader = request.headers.get('Range')
    if (!rangeHeader) {
      return new Response('Forbidden', { status: 403 })
    }

    // Parse and clamp the range
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (!match) return new Response('Bad Request', { status: 400 })

    const start = parseInt(match[1])
    const reqEnd = match[2] ? parseInt(match[2]) : start + MAX_CHUNK - 1
    const end   = Math.min(reqEnd, start + MAX_CHUNK - 1)

    // Fetch from private R2 bucket
    const key = new URL(request.url).pathname.slice(1)  // strip leading /
    const object = await env.BUCKET.get(key, {
      range: { offset: start, length: end - start + 1 },
    })

    if (!object) return new Response('Not Found', { status: 404 })

    const headers = new Headers({
      'Content-Type':   'application/octet-stream',
      'Content-Range':  `bytes ${start}-${end}/${object.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges':  'bytes',
      'Cache-Control':  'public, max-age=31536000, immutable',
    })

    return addCors(request, new Response(object.body, { status: 206, headers }))
  },
}

function addCors(request, response) {
  const origin = request.headers.get('Origin') ?? ''
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
    response.headers.set('Access-Control-Allow-Origin',   origin)
    response.headers.set('Access-Control-Allow-Methods',  'GET, HEAD')
    response.headers.set('Access-Control-Allow-Headers',  'Range')
    response.headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
  }
  return response
}
