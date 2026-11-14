// Screenshots of every state of the stage mirror, from the simulated show (no server needed).
//   node web/src/clinic/dev/stageShots.mjs [baseUrl] [outDir] [sizes] [name-filter]
//   sizes: comma list of 1080,900,720,phone (default 1080). name-filter is a regular expression. Needs a global Playwright and the dev server:
//   cd web && bunx vite --port 5877 --strictPort
// Each state is reached with window.__stageSeek(seconds) once the page has loaded (by hand: `?mock=1&at=N`):
// the stretch before it is replayed on a virtual clock, so the picture is taken where it says it is. Prints console errors and the frame rate of every state.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`)

const base = (process.argv[2] ?? 'http://127.0.0.1:5877').replace(/\/$/, '')
const out = process.argv[3] ?? '/bulk2/runs/depression/stage/shots'
const sizes = (process.argv[4] ?? '1080').split(',')
const only = process.argv[5] ?? ''
mkdirSync(out, { recursive: true })

const VIEW = { 1080: { width: 1920, height: 1080 }, 900: { width: 1440, height: 900 }, 720: { width: 1280, height: 720 }, phone: { width: 390, height: 844 } }

// the show: tune 0-25 s, ping 26.6-84.6 s (settle, nod, laugh, speak, breathe), echo at 86.5 s,
// dose 95.1-111.1 s, measure again 114.4-132.4 s
const STATES = [
  ['01-attract', 'sim=idle', null],
  ['02-tune-smile', '', 4.6],
  ['03-tune-angry', '', 11.4],
  ['04-tune-training', '', 17.05, 600],
  ['05-tune-done', '', 20],
  ['06-settle', '', 32.4],
  ['07-nod', '', 37.6],
  ['08-laugh', '', 48],
  ['09-speak', '', 60],
  ['10-breathe', '', 78],
  ['11-reading', '', 84.7, 800],
  ['12-echo', '', 88.5],
  ['13-dose', '', 104],
  ['14-again-laugh', '', 119.5],
  ['15-again-breathe', '', 129],
  ['16-again', '', 134],
  ['17-after-echo', 'miniecho=1', 136],
  // what an older phone build gives: no mesh, no muscles, no AirPods (and no tune: the ping starts at 0)
  ['20-old-laugh', 'sim=old', 21.4],
  ['21-old-echo', 'sim=old', 62],
  // a phone without AirPods: head and heart from the camera, no second smile trace
  ['22-cam-laugh', 'sim=cam', 48],
  ['23-cam-nod', 'sim=cam', 37.6],
  // tune messages alone, no frames and no mesh
  ['24-baretune-sad', 'sim=baretune', 8.6],
  ['25-nomesh-laugh', 'sim=nomesh', 48],
]

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] })
const errors = []
for (const size of sizes) {
  for (const [name, q, at, settle] of STATES) {
    if (only && !new RegExp(only).test(name)) continue
    const ctx = await browser.newContext({ viewport: VIEW[size] ?? VIEW[1080], deviceScaleFactor: size === 'phone' ? 2 : 1 })
    const page = await ctx.newPage()
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
    await page.goto(`${base}/#/clinic/live/DEMO01?mock=1&${q}`, { waitUntil: 'load' })
    await page.waitForSelector('.sg', { timeout: 45000 })
    await page.evaluate(() => document.fonts.ready)
    // only now start the clock: the page is loaded, so the picture is taken where it says it is
    if (at !== null) await page.evaluate((sec) => window.__stageSeek(sec), at)
    await page.waitForTimeout(settle ?? 1500)
    await page.screenshot({ path: `${out}/${name}-${size}.png`, fullPage: size === 'phone' })
    // ms the stage's own painters spend per frame: the honest number on a busy headless box, where fps says little
    const fps = await page.evaluate(() => {
      const l = window.__stageLoop
      return l ? `${l.cost.toFixed(1)} ms paint, ${Math.round(l.fps)}` : '?'
    })
    // the phone page scrolls down by design: there only sideways counts
    const overflow = await page.evaluate((tall) => {
      const bad = []
      const vw = innerWidth
      const vh = innerHeight
      if (tall && document.documentElement.scrollWidth > vw + 1) bad.push(`the page scrolls sideways (${document.documentElement.scrollWidth} px)`)
      for (const el of document.querySelectorAll('.sg *')) {
        if ((el.closest('svg') && el.tagName !== 'svg') || el.closest('.sg-map')) continue
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) continue
        if (r.right > vw + 1 || r.left < -1 || (!tall && (r.bottom > vh + 1 || r.top < -1))) bad.push(`${el.tagName.toLowerCase()}.${el.className}`)
      }
      return bad.slice(0, 5)
    }, size === 'phone')
    console.log(`${name}-${size}.png  ${fps} fps${overflow.length ? `  OUTSIDE THE SCREEN: ${overflow.join(', ')}` : ''}`)
    await ctx.close()
  }
}
await browser.close()
if (errors.length) {
  console.log(`\n${errors.length} console errors:`)
  for (const e of [...new Set(errors)]) console.log(`  ${e}`)
  process.exitCode = 1
} else console.log('\nno console errors')
