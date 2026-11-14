// Vire's offline shell. After one visit the app opens without a connection (a ping taken offline is queued by the app
// and sent later). Pages come from the network first, so a new build always wins; the cache answers only when the
// network does not. Nothing under /api/ is touched, and nothing is stored here but the app's own files.
// Bump this name with each shipped shell. A new worker waits for the current tab to
// close, so a running ping or dose is never interrupted by a reload.
const CACHE = 'vire-shell-v3'
const SCOPE = new URL(self.registration.scope).pathname

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(SCOPE, { cache: 'reload' })))
      .catch(() => {})
      // Do not skipWaiting: the next open takes the new worker, while an active
      // ping or dose keeps the old code alive until it is finished.
      .then(() => {}),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

const keep = async (req, res) => {
  if (res && res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone()).catch(() => {})
  return res
}

async function pageFirst(req) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 4000)
  try {
    const res = await fetch(req, { signal: ctl.signal })
    clearTimeout(timer)
    // one page, many addresses (the routes live after the #): keep it under the app's own address
    if (res.ok) (await caches.open(CACHE)).put(SCOPE, res.clone()).catch(() => {})
    return res
  } catch {
    clearTimeout(timer)
    return (await caches.match(SCOPE)) ?? Response.error()
  }
}

async function cacheFirst(req) {
  return (await caches.match(req)) ?? keep(req, await fetch(req))
}

async function freshLater(req) {
  const hit = await caches.match(req)
  const net = fetch(req)
    .then((res) => keep(req, res))
    .catch(() => null)
  return hit ?? (await net) ?? Response.error()
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)
  if (url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return
  if (url.pathname === SCOPE + 'api/daily' || url.pathname === SCOPE + 'api/daily/') {
    e.respondWith(freshLater(req))
    return
  }
  if (url.pathname === SCOPE + 'api/daily/laugh.mp3' || url.pathname === SCOPE + 'api/daily/question.mp3') {
    e.respondWith(cacheFirst(req))
    return
  }
  if (url.pathname.startsWith(SCOPE + 'api/')) return
  if (req.mode === 'navigate') e.respondWith(pageFirst(req))
  else if (url.pathname.startsWith(SCOPE + 'assets/')) e.respondWith(cacheFirst(req)) // build files carry a hash in the name
  else e.respondWith(freshLater(req)) // sounds, the face model, fonts: same name, may change with a build
})
