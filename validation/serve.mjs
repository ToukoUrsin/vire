#!/usr/bin/env bun
// Static file server for frozen builds of the web app, so a validation run cannot be disturbed by other
// people's edits reloading a dev server.
//
//   cd web && bunx vite build --outDir /tmp/validate-builds/v0 --emptyOutDir
//   bun validation/serve.mjs /tmp/validate-builds 5872        ->  http://127.0.0.1:5872/v0/#/lab
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '/tmp/validate-builds')
const port = Number(process.argv[3] ?? 5872)
Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname)
    if (p.endsWith('/')) p += 'index.html'
    const file = path.resolve(root, '.' + p)
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('no', { status: 403 })
    const f = Bun.file(file)
    if (!(await f.exists())) return new Response('not found', { status: 404 })
    return new Response(f, { headers: { 'Cache-Control': 'no-store' } })
  },
})
console.log(`serving ${root} on http://127.0.0.1:${port}/`)
