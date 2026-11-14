// Screenshot every clinic route in headless Chromium, desktop and phone, and report console errors.
//   node web/src/clinic/dev/shots.mjs [baseUrl] [outDir] [mock|real|both] [name-filter]
// Needs a global Playwright (npm -g) and the dev server: cd web && bunx vite --port 5874
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`)

const base = (process.argv[2] ?? 'http://127.0.0.1:5874').replace(/\/$/, '')
const out = process.argv[3] ?? '/bulk2/runs/depression/clinic'
const which = process.argv[4] ?? 'both'
const only = process.argv[5] ?? ''
mkdirSync(out, { recursive: true })

const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }
const browser = await chromium.launch()
const errors = []

async function shot(name, hash, size, opts = {}) {
  if (only && !name.includes(only)) return
  const ctx = await browser.newContext({ viewport: sizes[size], deviceScaleFactor: size === 'phone' ? 2 : 1 })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}/#${hash}`, { waitUntil: 'networkidle' }).catch(() => page.goto(`${base}/#${hash}`))
  await page.waitForTimeout(opts.wait ?? 900)
  if (opts.before) await opts.before(page)
  await page.screenshot({ path: `${out}/${name}-${size}.png`, fullPage: opts.full ?? true })
  console.log(`${name}-${size}.png`)
  await ctx.close()
}

for (const mode of which === 'both' ? ['mock', 'real'] : [which]) {
  const q = mode === 'mock' ? '?mock=1' : ''
  // the id of the top-priority person in this mode
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${base}/#/clinic${q}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForSelector('.cl-name', { timeout: 8000 }).catch(() => {})
  const hrefs = await page.$$eval('.cl-name', (as) => as.map((a) => a.getAttribute('href')))
  await ctx.close()
  const first = (hrefs[0] ?? '').replace(/^#/, '').replace(/\?.*$/, '')
  const quiet = (hrefs[1] ?? '').replace(/^#/, '').replace(/\?.*$/, '')
  const calm = (hrefs[12] ?? '').replace(/^#/, '').replace(/\?.*$/, '')

  for (const size of ['desktop', 'phone']) {
    await shot(`${mode}-today`, `/clinic${q}`, size)
    if (first) {
      await shot(`${mode}-patient`, `${first}${q}`, size)
      await shot(`${mode}-patient-hover`, `${first}${q}`, size, {
        full: false,
        before: async (p) => {
          const box = await p.locator('.cl-echo').boundingBox()
          if (box) await p.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.5)
          await p.waitForTimeout(250)
        },
      })
    }
    if (quiet) await shot(`${mode}-patient-2`, `${quiet}${q}`, size)
    if (calm) await shot(`${mode}-patient-calm`, `${calm}${q}`, size)
  }
}

// the live mirror on the simulated signal: one frame per phase, then the echo
for (const size of ['desktop', 'phone']) {
  if (only && !'live'.includes(only) && !only.startsWith('live')) continue
  const ctx = await browser.newContext({ viewport: sizes[size], deviceScaleFactor: size === 'phone' ? 2 : 1 })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`live-${size}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`live-${size}: ${e.message}`))
  await page.goto(`${base}/#/clinic/live?mock=1`)
  const marks = [
    ['settle', 7500],
    ['nod', 6200],
    ['laugh', 10500],
    ['speak', 11500],
    ['breathe', 19000],
    ['echo', 9500],
  ]
  for (const [name, ms] of marks) {
    await page.waitForTimeout(ms)
    await page.screenshot({ path: `${out}/live-${name}-${size}.png` })
    console.log(`live-${name}-${size}.png`)
  }
  await ctx.close()
}

await browser.close()
console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n${[...new Set(errors)].join('\n')}` : '\nno console errors')
