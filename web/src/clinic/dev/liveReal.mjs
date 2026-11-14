// The live mirror against the REAL relay: plays one synthetic ping through dev/fakeSensor.ts and
// screenshots three viewers while it runs (lobby that auto-opens the newest room, room "*", phone).
//   node web/src/clinic/dev/liveReal.mjs [baseUrl] [outDir] [apiUrl] [room]
// Needs bun, a global Playwright, the dev server (cd web && bunx vite --port 5874) and the API on 8871.
import { createRequire } from 'node:module'
import { execSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`)

const base = (process.argv[2] ?? 'http://127.0.0.1:5874').replace(/\/$/, '')
const out = process.argv[3] ?? '/bulk2/runs/depression/clinic'
const api = process.argv[4] ?? 'http://127.0.0.1:8871'
const room = (process.argv[5] ?? 'DEMO01').toUpperCase()
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const errors = []
const open = async (name, hash, viewport, scale = 1) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}/#${hash}`)
  return { name, page }
}
const desktop = { width: 1440, height: 900 }
const viewers = [
  await open('livereal-lobby', '/clinic/live', desktop),
  await open('livereal-star', '/clinic/live/*', desktop),
  await open('livereal-phone', `/clinic/live/${room}`, { width: 390, height: 844 }, 2),
]
const snap = async (tag) => {
  for (const v of viewers) {
    await v.page.screenshot({ path: `${out}/${v.name}-${tag}.png` })
    console.log(`${v.name}-${tag}.png  ${v.page.url().replace(base, '')}`)
  }
}

await viewers[0].page.waitForTimeout(2500)
await snap('waiting')

const sensor = spawn('bun', [join(dirname(fileURLToPath(import.meta.url)), 'fakeSensor.ts'), '--url', api, '--room', room, '--name', 'Aino'], { stdio: 'inherit' })
const t0 = Date.now()
const until = (s) => viewers[0].page.waitForTimeout(Math.max(0, t0 + s * 1000 - Date.now()))

await until(12)
await snap('nod')
await until(25)
await snap('laugh')
await until(35)
await snap('speak')
await until(57)
await snap('breathe')
await until(66)
await snap('echo')
// the sensor leaves: the mirror should fall back to waiting
await until(80)
sensor.kill()
await viewers[0].page.waitForTimeout(2500)
await snap('after')

await browser.close()
console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n${[...new Set(errors)].join('\n')}` : '\nno console errors')
