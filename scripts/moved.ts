// The old address (the dev box behind /vire) hands everyone to the public host and clears the old offline shell.
const TO = 'https://vire.fly.dev/'
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vire</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f1ea;color:#1a1714;font:17px/1.5 system-ui,sans-serif}a{color:inherit}</style></head>
<body><p>Vire has moved to <a id="a" href="${TO}">vire.fly.dev</a>.</p>
<script>
var to = ${JSON.stringify(TO)} + location.hash
document.getElementById('a').href = to
var go = function () { location.replace(to) }
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister() })) }).then(go, go)
else go()
setTimeout(go, 1500)
</script></body></html>`
const SW = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k)
  await self.registration.unregister()
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url)
})()))`
Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 8871),
  fetch(req) {
    const u = new URL(req.url)
    const p = u.pathname.replace(/^\/vire(?=\/|$)/, '') || '/'
    if (p === '/api/health') return Response.json({ ok: true, moved: TO })
    if (p.startsWith('/api/')) return Response.json({ error: 'moved', to: TO }, { status: 410, headers: { 'access-control-allow-origin': '*' } })
    if (p === '/sw.js') return new Response(SW, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } })
    return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  },
})
console.log('[vire-moved] 8871 ->', TO)
