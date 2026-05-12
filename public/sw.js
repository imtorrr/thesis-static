const CACHE = 'copc-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (url.hostname !== 'data.imtorrr.xyz') return  // only cache data requests

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request)
      if (cached) return cached

      const response = await fetch(e.request)
      if (response.status === 206 || response.status === 200) {
        cache.put(e.request, response.clone())
      }
      return response
    })
  )
})
