#!/usr/bin/env node
// Every screen and state of Vire as screenshots, in walk order, in one run of about four minutes.
//   node judging/shots.mjs <baseUrl> <outDir> [filter]
//   baseUrl  where the web app is served, e.g. http://127.0.0.1:5881/ (a path prefix such as /vire/ works too)
//   outDir   where the PNGs go; cleared of old PNGs first. Keep it outside the repo (/bulk2/runs/depression/judging/round-N/shots)
//   filter   optional regular expression on "<track>.<size>" (e.g. 'stage', 'app-loop.phone', 'wall|science')
//
// Files are <nnn>-<area>-<screen>.<size>.png with size = phone (390x844 @2x), laptop (1440x900) or wide (1920x1080,
// the stage and the wall only). A screen taller than the window gets .s2, .s3 ... one window further down each.
//   1xx patient app (first run, tune, ping, echo, dose, mini ping, learned, home, settings)   2xx hall guest (#/visit)
//   3xx error states (camera refused, no camera, offline, interrupted, dark, face lost)       4xx tune on a real face
//   5xx the stage (#/clinic/live)   6xx the hall wall   7xx the science page   8xx the clinic   9xx sensor lab
//
// It exits 1 and lists what is wrong when a screen is missing, when a state did not show what it should, or when a
// picture came out blank (a blank is never saved). `manifest.json` in outDir lists every file with its track.
//
// This run registers people and sends pings (names start with "test-design-"). Against the live server they would
// show up in the real clinic list, so run it against a throwaway server that serves its own build of the source:
//   cd web && bunx vite build --outDir /tmp/designer-dist          (never `bun run build`: that replaces the live site)
//   cd server && PORT=8873 VIRE_DB=/tmp/vire-shots.sqlite VIRE_RATE=off VIRE_DIST=/tmp/designer-dist \
//     ANTHROPIC_BASE_URL=http://127.0.0.1:8317 hsec exec --only CLIPROXY_API_KEY -- bun run index.ts
//   node judging/shots.mjs http://127.0.0.1:8873/ /bulk2/runs/depression/judging/round-N/shots
// A dev server works too (web/vite.isolated.config.ts sends /api to 8873), but on a busy box it drops modules and
// the run takes three times as long.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const pw = require('/home/ubuntu/.local/lib/node_modules/playwright')

const [baseArg, outArg, filterArg] = process.argv.slice(2)
if (!baseArg || !outArg) {
  console.error('usage: node judging/shots.mjs <baseUrl> <outDir> [filter]')
  process.exit(2)
}
const base = baseArg.replace(/\/?$/, '/')
const out = outArg.replace(/\/?$/, '/')
const filter = filterArg ? new RegExp(filterArg) : null
mkdirSync(out, { recursive: true })
if (!filter) for (const f of readdirSync(out)) if (f.endsWith('.png') || f === 'manifest.json') unlinkSync(out + f)

const FIX = '/bulk2/runs/depression/sense-fixtures/'
const CLIPS = '/bulk2/runs/depression/tune/clips/webm/commons/'
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  wide: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
}
const IPHONE_UA = pw.devices['iPhone 13'].userAgent
const MAX_AT_ONCE = Number(process.env.SHOTS_AT_ONCE ?? 8)
const t00 = Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** `hash` is the route ("/visit"), `query` goes before the hash ("mock=1"), `hq` after it ("demo=300&h=30") */
const url = (hash = '/', query = '', hq = '') => `${base}${query ? `?${query}` : ''}#${hash}${hq ? `?${hq}` : ''}`

// ---------------------------------------------------------------- is this picture blank?

/** Decodes an 8-bit RGB/RGBA PNG far enough to judge it: share of the commonest colour and how many strong edges it has. */
function look(buf) {
  let p = 8
  let w = 0
  let h = 0
  let type = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const name = buf.toString('latin1', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (name === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      type = data[9]
      if (data[8] !== 8 || data[12] !== 0 || (type !== 2 && type !== 6)) return null
    } else if (name === 'IDAT') idat.push(data)
    else if (name === 'IEND') break
    p += 12 + len
  }
  const bpp = type === 6 ? 4 : 3
  const stride = w * bpp
  const raw = inflateSync(Buffer.concat(idat))
  let prev = Buffer.alloc(stride)
  let cur = Buffer.alloc(stride)
  const bins = new Map()
  let n = 0
  let edges = 0
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1)
    const f = raw[o]
    for (let x = 0; x < stride; x++) {
      const v = raw[o + 1 + x]
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let r = v
      if (f === 1) r = v + a
      else if (f === 2) r = v + b
      else if (f === 3) r = v + ((a + b) >> 1)
      else if (f === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      cur[x] = r & 255
    }
    if (y % 3 === 0) {
      let last = -1
      for (let x = 0; x < w; x += 3) {
        const i = x * bpp
        const lum = (cur[i] * 3 + cur[i + 1] * 6 + cur[i + 2]) / 10
        const key = ((cur[i] >> 4) << 8) | ((cur[i + 1] >> 4) << 4) | (cur[i + 2] >> 4)
        bins.set(key, (bins.get(key) ?? 0) + 1)
        if (last >= 0 && Math.abs(lum - last) > 28) edges++
        last = lum
        n++
      }
    }
    const t = prev
    prev = cur
    cur = t
  }
  let top = 0
  for (const v of bins.values()) if (v > top) top = v
  return { w, h, share: top / n, edges }
}
function blank(buf) {
  const s = look(buf)
  if (!s) return null
  if (s.share > 0.9985) return `${(s.share * 100).toFixed(2)}% of it is one colour`
  if (s.edges < 40) return `only ${s.edges} edges in it`
  return null
}

// ---------------------------------------------------------------- bookkeeping

const problems = []
const noise = []
const saved = []
const want = [] // every file a track promises
const NOISE = /Failed to fetch dynamically imported module|error boundar|XNNPACK|GL Driver|Failed to load resource|vo-tune|WebSocket connection|ERR_FAILED|ERR_ABORTED|net::ERR|Automatic fallback to software WebGL/

class Missing extends Error {}

function makeT(track, size, page, ctx) {
  const tag = `${track.id}.${size}`
  const t = {
    track,
    size,
    page,
    ctx,
    tag,
    clock: !!track.clock,
    phone: size === 'phone',
    sleep: (ms) => page.waitForTimeout(ms),
    /** a tap on the phone, a click elsewhere */
    press: (sel) => page.locator(sel).first().click(),
    see: (sel, timeout = 30000) => page.locator(sel).first().waitFor({ state: 'visible', timeout }),
    /** Load a route from scratch and wait for its root. A dev server under load sometimes drops a module: try again. */
    async open(target, root, tries = 3) {
      for (let k = 1; ; k++) {
        try {
          await page.goto('about:blank')
          await page.goto(target)
          await page.locator(root).first().waitFor({ state: 'visible', timeout: 20000 })
          return
        } catch (e) {
          if (k >= tries) throw new Missing(`${target}: "${root}" never showed in ${tries} loads (${String(e).split('\n')[0].slice(0, 120)})`)
          await sleep(600)
        }
      }
    },
    text: async (sel) => ((await page.locator(sel).first().innerText({ timeout: 1500 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim(),
    /** Stop the page's clock `extra` ms from now: timers and frames stand still until page.clock.resume(). */
    async stop(name, extra = 0) {
      // the clock keeps running while we ask what time it is: aim a little ahead, further if that was already past
      for (const ahead of [150, 500, 1200, 0]) {
        if (!ahead) throw new Missing(`${name}: the page's clock could not be stopped`)
        const ok = await page.clock.pauseAt((await page.evaluate(() => Date.now())) + extra + ahead).then(() => true, () => false)
        if (ok) return
      }
    },
    /**
     * One screen. `must` has to be visible before and after the picture is taken (a state that slipped away is a miss).
     * `scroll: false` takes the window only; otherwise a taller page is followed down, one window at a time.
     * `hold: true` is for a state that lasts a second or two: the page's clock (timers, frames) is stopped while the
     * picture is taken, so a slow machine cannot let it slip. The track must be made with `clock: true`.
     * With `live: ms` the state first runs for that long in real time (a flower has to grow), then the clock stops.
     */
    async shot(name, must, o = {}) {
      if (!track.shots.includes(name)) throw new Error(`"${name}" is not in the shot list of ${track.id}`)
      const musts = Array.isArray(must) ? must : [must]
      try {
        for (const m of musts) await page.locator(m).first().waitFor({ state: 'visible', timeout: o.timeout ?? 15000 })
      } catch {
        throw new Missing(`${name}: "${musts.join('" + "')}" never showed`)
      }
      if (o.hold) {
        if (!t.clock) throw new Error(`${name}: hold needs a page with the clock installed (track option clock: true)`)
        if (o.live) await page.waitForTimeout(o.live)
        await t.stop(name, o.wait ?? 0)
        await page.waitForTimeout(450) // styles still move on real time
      } else {
        await page.evaluate(() => document.fonts.ready).catch(() => {})
        if (o.wait) await page.waitForTimeout(o.wait)
      }
      const file = `${name}.${size}.png`
      const buf = await page.screenshot({ animations: 'allow' })
      const gone = []
      for (const m of musts) if (!(await page.locator(m).first().isVisible())) gone.push(m)
      if (o.hold) await page.clock.resume()
      if (gone.length) throw new Missing(`${name}: "${gone.join('" + "')}" was gone when the picture was taken`)
      const why = blank(buf)
      if (why) throw new Missing(`${name}: blank picture (${why}), not saved`)
      writeFileSync(out + file, buf)
      saved.push({ file, track: track.id, size, at: Math.round((Date.now() - t00) / 100) / 10 })
      if (o.scroll === false) return
      // a taller page: follow it down. `scroller` is the element that scrolls when it is not the window.
      const dims = await page.evaluate((sel) => {
        const el = sel ? document.querySelector(sel) : document.scrollingElement
        return el ? { h: el.scrollHeight, v: sel ? el.clientHeight : innerHeight } : null
      }, o.scroller ?? null)
      if (!dims || dims.h <= dims.v + 32) return
      const step = Math.round(dims.v * 0.86)
      const pages = Math.min(o.maxPages ?? 14, Math.ceil((dims.h - dims.v) / step) + 1)
      for (let k = 2; k <= pages; k++) {
        await page.evaluate(([sel, y]) => (sel ? document.querySelector(sel) : document.scrollingElement).scrollTo(0, y), [o.scroller ?? null, Math.min((k - 1) * step, dims.h - dims.v)])
        await page.waitForTimeout(350)
        const b = await page.screenshot({ animations: 'allow' })
        const f = `${name}.${size}.s${k}.png`
        if (blank(b)) continue
        writeFileSync(out + f, b)
        saved.push({ file: f, track: track.id, size, at: Math.round((Date.now() - t00) / 100) / 10 })
      }
      await page.evaluate(([sel]) => (sel ? document.querySelector(sel) : document.scrollingElement).scrollTo(0, 0), [o.scroller ?? null])
    },
  }
  return t
}

function watch(page, tag) {
  page.on('pageerror', (e) => NOISE.test(String(e)) && noise.push(`${tag}: uncaught error in the page: ${String(e).slice(0, 240)}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) noise.push(`${tag}: ${m.text().slice(0, 200)}`)
  })
}

// ---------------------------------------------------------------- patient app helpers (demo signals: ?mock=1)

/** first run: name in, Start. Leaves the app on the tune step. */
async function firstRun(t, name, { query = 'mock=1', route = '/' } = {}) {
  await t.open(url(route, query), '.va-first')
  await t.page.fill('.va-field input', name)
  await t.press('button[type=submit]')
}
const skipTune = async (t) => {
  await t.see('.va-tune-mock, .vt-flow', 60000)
  await t.press('.va-tune-skip, .vt-skip')
}
const PHASES = [
  ['settle', 3000],
  ['nod', 1500],
  ['laugh', 5000],
  ['speak', 6000],
  ['breathe', 7000],
]
const stageAt = (t, step, timeout = 70000) => t.see(`.va-stage[data-step="${step}"]`, timeout)
const mock = (t, o) => t.page.evaluate((o) => Object.assign(window.__vireMock, o), o)

// ---------------------------------------------------------------- tracks

const TRACKS = []
const track = (id, sizes, shots, run, opts = {}) => TRACKS.push({ id, sizes, shots, run, ...opts })

// 1xx: the whole loop on demo signals, the way a judge walks it
track(
  'app-loop',
  ['phone', 'laptop'],
  [
    '101-app-first', '102-app-first-code', '103-app-tune-smile', '104-app-tune-brows', '105-app-tune-done',
    '110-app-ping-check', '111-app-ping-settle', '112-app-ping-nod', '113-app-ping-laugh', '114-app-ping-speak', '115-app-ping-breathe', '116-app-ping-reading',
    '120-app-echo', '121-app-dose-intro', '122-app-dose', '123-app-mini-laugh', '124-app-mini-breathe', '125-app-feel', '126-app-learned',
    '130-app-home', '131-app-settings', '132-app-settings-start-over', '133-app-echo-again', '134-app-start-over',
  ],
  async (t) => {
    const { page } = t
    await t.open(url('/', 'mock=1'), '.va-first')
    await t.shot('101-app-first', '.va-first', { wait: 1200 })
    await page.fill('.va-field input', `test-design-${t.size}`)
    await t.press('.va-first .va-link')
    await page.fill('.va-code', 'AALTO7')
    await t.shot('102-app-first-code', '.va-code', { wait: 300, scroll: false })
    await page.fill('.va-code', '')
    await t.press('button[type=submit]')
    await t.shot('103-app-tune-smile', '.va-tune-mock[data-step="smile"]', { hold: true, wait: 700, scroll: false, timeout: 30000 })
    await t.shot('104-app-tune-brows', '.va-tune-mock[data-step="angry"]', { hold: true, wait: 700, scroll: false })
    await t.shot('105-app-tune-done', '.va-tune-mock[data-step="done"]', { hold: true, wait: 500, scroll: false, timeout: 20000 })
    await t.shot('110-app-ping-check', '.va-stage[data-step="check"]', { hold: true, live: 1250, scroll: false, timeout: 30000 })
    for (const [i, [step, live]] of PHASES.entries()) {
      await t.shot(`11${i + 1}-app-ping-${step}`, `.va-stage[data-step="${step}"]`, { hold: true, live, scroll: false, timeout: 70000 })
    }
    await t.shot('116-app-ping-reading', '.va-stage[data-step="done"]', { hold: true, wait: 400, scroll: false, timeout: 70000 })
    await t.shot('120-app-echo', ['.va-echo', '.va-notes li'], { wait: 2800, timeout: 30000 })
    await t.press('.va-offer .va-btn-primary')
    await t.shot('121-app-dose-intro', '.va-intro', { wait: 600 })
    await t.press('.va-intro-go .va-btn')
    await t.shot('122-app-dose', '.va-dose', { wait: 7000, scroll: false, timeout: 30000 })
    await t.press('.va-dose-foot .va-btn')
    await t.shot('123-app-mini-laugh', '.va-stage[data-step="laugh"]', { hold: true, live: 3000, scroll: false, timeout: 60000 })
    await t.shot('124-app-mini-breathe', '.va-stage[data-step="breathe"]', { hold: true, live: 4000, scroll: false, timeout: 60000 })
    await t.shot('125-app-feel', '.va-feel', { wait: 500, timeout: 60000 })
    await page.click('text=A bit better')
    await t.shot('126-app-learned', ['.va-learned', '.va-beliefs li'], { wait: 1800, timeout: 30000 })
    await t.press('.va-learned > .va-btn')
    await t.shot('130-app-home', ['.va-home', '.va-today'], { wait: 2200 })
    await t.press('[aria-label=Settings]')
    await t.shot('131-app-settings', '.va-sheet', { wait: 700, scroll: false })
    await page.click('.va-sheet .va-row >> text=Start over')
    await t.shot('132-app-settings-start-over', '.va-row-confirm', { wait: 300, scroll: false })
    await page.click('.va-row-confirm >> text=Keep')
    await t.press('[aria-label="Close settings"]')
    await t.sleep(400)
    await t.press('.va-today')
    await t.shot('133-app-echo-again', '.va-echo', { wait: 900, scroll: false })
    await t.press('[aria-label="Back to home"]')
    await t.see('.va-home')
    // the booth's reset: hold the wordmark for two seconds
    const box = await page.locator('.va-home .va-wordmark').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await t.sleep(2300)
    await page.mouse.up()
    await t.shot('134-app-start-over', '.va-confirm', { wait: 400, scroll: false })
  },
  { cost: 9, clock: true },
)

// 14x-16x: the home screen before a ping, every dose, and home for someone who has been here for weeks
track(
  'app-doses',
  ['phone', 'laptop'],
  [
    '140-app-home-first-day',
    '141-app-breathe-intro', '142-app-breathe', '143-app-forest-intro', '144-app-forest', '145-app-walk-intro', '146-app-walk',
    '147-app-reach-intro', '148-app-reach', '149-app-reach-recording',
    '150-app-home-weeks-in', '151-app-home-clinic-note', '152-app-echo-weeks-in',
  ],
  async (t) => {
    const { page } = t
    await firstRun(t, `test-design-doses-${t.size}`)
    await skipTune(t)
    await stageAt(t, 'check')
    await t.press('[aria-label="Stop and go back"]')
    await t.shot('140-app-home-first-day', ['.va-home', '.va-portal'], { wait: 1500 })
    const doses = ['breathe', 'forest', 'walk', 'reach']
    for (const [i, d] of doses.entries()) {
      await page.locator('.va-dose-row .va-chip').nth(i).click()
      await t.shot(`14${1 + i * 2}-app-${d}-intro`, '.va-intro', { wait: 500, scroll: false })
      await t.press('.va-intro-go .va-btn')
      await t.shot(`14${2 + i * 2}-app-${d}`, '.va-dose', { wait: d === 'reach' ? 900 : 8000, scroll: false, timeout: 30000 })
      if (d === 'reach') {
        await t.press('.va-reach-btn')
        await t.shot('149-app-reach-recording', '.va-reach-dial[data-step="recording"]', { wait: 2500, scroll: false })
      }
      await t.press('[aria-label="Stop and go back"]')
      await t.see('.va-home')
      await t.sleep(500)
    }
    // someone weeks into home use: one of the server's simulated patients, read-only. The clock is set to the day of
    // their latest ping, so "today" has an echo.
    const rows = await (await fetch(`${base}api/clinic/patients`)).json()
    const pick = rows.find((r) => r.synthetic && r.status === 'dipping' && r.adherence7 >= 4) ?? rows.find((r) => r.synthetic)
    if (!pick) throw new Missing('150-app-home-weeks-in: the server has no simulated patient to borrow')
    const echoes = await (await fetch(`${base}api/users/${pick.id}/echoes`)).json()
    const last = echoes[echoes.length - 1]
    await page.evaluate(([id, name]) => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('vire')) localStorage.removeItem(k)
      localStorage.setItem('vire.user', JSON.stringify({ userId: id, name }))
    }, [pick.id, pick.name.split(' ')[0]])
    await page.clock.setFixedTime(new Date(Date.parse(last.at) + 2 * 3600_000))
    await t.open(url('/', 'mock=1'), '.va-home')
    await t.shot('150-app-home-weeks-in', ['.va-home', '.va-history', '.va-today'], { wait: 2500 })
    await t.press('.va-today')
    await t.shot('152-app-echo-weeks-in', ['.va-echo', '.va-notes li'], { wait: 1200 })
    await page.route('**/api/users/*/notice', (r) => r.fulfill({ json: { booster: true, message: null } }))
    await t.open(url('/', 'mock=1'), '.va-home')
    await t.shot('151-app-home-clinic-note', ['.va-home', '.va-notice'], { wait: 2500, scroll: false })
  },
  { cost: 7 },
)

// 2xx: a hall guest, from the QR to their dot on the wall
track(
  'visit',
  ['phone', 'laptop'],
  ['201-visit-intro', '202-visit-echo', '203-visit-end', '204-visit-my-dot', '205-visit-welcome-back'],
  async (t) => {
    const { page } = t
    await t.open(url('/visit', 'mock=1'), '.va-visit')
    await t.shot('201-visit-intro', '.va-visit', { wait: 1200 })
    await page.fill('.va-field input', `tdesign${t.size}`.slice(0, 16))
    await t.press('button[type=submit]')
    await stageAt(t, 'check')
    await t.shot('202-visit-echo', ['.va-echo', '.va-notes li'], { wait: 2800, timeout: 120000 })
    await t.press('.va-echo-next')
    await t.shot('203-visit-end', '.va-visit-end', { wait: 900 })
    const href = await page.locator('.va-visit-end-body a').getAttribute('href')
    await t.open(base + href, '.wl-me')
    await t.shot('204-visit-my-dot', '.wl-me', { wait: 3500 })
    await t.open(url('/visit', 'mock=1'), '.va-visit')
    await t.shot('205-visit-welcome-back', '.va-visit', { wait: 900, scroll: false })
  },
  { cost: 6 },
)

// 3xx: what goes wrong
track(
  'err-camera',
  ['phone', 'laptop'],
  ['301-err-camera-refused', '302-err-visit-camera-refused', '303-err-no-camera', '304-err-camera-busy'],
  async (t) => {
    const { page } = t
    // the browser refuses, as Safari does after "Don't Allow" (headless Chromium cannot refuse by itself)
    await page.addInitScript(() => {
      if (!navigator.mediaDevices || location.protocol === 'about:') return
      const kind = sessionStorage.getItem('gum') ?? 'NotAllowedError'
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refused', kind))
    })
    // the account is made alongside the camera request: keep these four off the server
    await page.route('**/api/users', (r) => (r.request().method() === 'POST' ? r.fulfill({ json: { userId: 'testdesign0001', name: 'test-design' } }) : r.continue()))
    await t.open(url('/'), '.va-first')
    await page.fill('.va-field input', 'test-design')
    await t.press('button[type=submit]')
    await t.shot('301-err-camera-refused', '.va-first .va-note', { wait: 500 })
    await t.open(url('/visit'), '.va-visit')
    await t.press('button[type=submit]')
    await t.shot('302-err-visit-camera-refused', '.va-visit .va-note', { wait: 500 })
    for (const [name, kind] of [['303-err-no-camera', 'NotFoundError'], ['304-err-camera-busy', 'NotReadableError']]) {
      await page.evaluate((k) => {
        sessionStorage.setItem('gum', k)
        for (const key of Object.keys(localStorage)) if (key.startsWith('vire')) localStorage.removeItem(key)
      }, kind)
      await t.open(url('/'), '.va-first')
      await t.press('button[type=submit]')
      await t.shot(name, '.va-first .va-note', { wait: 500, scroll: false })
    }
  },
  { ua: IPHONE_UA },
)

track(
  'err-offline',
  ['phone', 'laptop'],
  ['310-err-offline-echo', '311-err-offline-home', '312-err-offline-sent'],
  async (t) => {
    const { page } = t
    let down = true
    await page.route('**/api/**', (r) => (down ? r.abort() : r.continue()))
    await firstRun(t, `test-design-offline-${t.size}`)
    await skipTune(t)
    await stageAt(t, 'check')
    await t.shot('310-err-offline-echo', ['.va-echo', '.va-notes li'], { wait: 2800, timeout: 120000 })
    await page.click('.va-echo >> text=Not now').catch(() => t.press('.va-echo-next'))
    await t.shot('311-err-offline-home', ['.va-home', '.va-room'], { wait: 1800 })
    down = false
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await t.shot('312-err-offline-sent', ['.va-home', '.va-room'], { wait: 9000, scroll: false })
  },
  { cost: 6 },
)

track(
  'err-visit-offline',
  ['phone', 'laptop'],
  ['315-err-visit-end-offline'],
  async (t) => {
    const { page } = t
    await page.route('**/api/**', (r) => r.abort())
    await t.open(url('/visit', 'mock=1'), '.va-visit')
    await page.fill('.va-field input', 'tdesignoff')
    await t.press('button[type=submit]')
    await stageAt(t, 'check')
    await t.see('.va-echo', 120000)
    await t.sleep(1500)
    await t.press('.va-echo-next')
    await t.shot('315-err-visit-end-offline', ['.va-visit-end', '.va-visit-end-body .va-note'], { wait: 900 })
  },
  { cost: 5 },
)

track(
  'err-interrupted',
  ['phone', 'laptop'],
  ['320-err-paused-away', '321-err-paused-sound'],
  async (t) => {
    const { page } = t
    // keep a handle on every audio context the app makes, to take the sound away later
    await page.addInitScript(() => {
      if (window.top !== window || !window.AudioContext) return
      const Real = window.AudioContext
      window.__audioContexts = []
      window.AudioContext = class extends Real {
        constructor(...a) {
          super(...a)
          window.__audioContexts.push(this)
        }
      }
    })
    await firstRun(t, `test-design-paused-${t.size}`)
    await skipTune(t)
    await stageAt(t, 'laugh')
    await t.sleep(2000)
    const visible = (state) => page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)
    await visible('hidden')
    await t.shot('320-err-paused-away', '.va-stage[data-step="paused"]', { wait: 700, scroll: false })
    await visible('visible')
    await t.press('.va-paused-go .va-btn-primary')
    await stageAt(t, 'nod')
    // a phone call takes the sound away: the audio context is suspended behind the app's back
    await page.evaluate(async () => {
      AudioContext.prototype.resume = () => Promise.reject(new Error('interrupted'))
      for (const c of window.__audioContexts) if (c.state === 'running') await c.suspend()
    })
    await t.shot('321-err-paused-sound', '.va-stage[data-step="paused"]', { wait: 600, scroll: false })
  },
  { cost: 5 },
)

track(
  'err-hard',
  ['phone', 'laptop'],
  ['330-err-check-dark', '331-err-face-lost', '332-err-echo-unread', '333-err-check-noisy'],
  async (t) => {
    const { page } = t
    await firstRun(t, `test-design-dark-${t.size}`)
    await skipTune(t)
    await stageAt(t, 'check')
    await mock(t, { dark: true })
    await t.shot('330-err-check-dark', '.va-stage[data-step="check"] .va-check li[data-mark="warn"]', { wait: 1200, scroll: false })
    await stageAt(t, 'nod')
    await mock(t, { faceLost: true })
    await t.shot('331-err-face-lost', '.va-stage-hint', { wait: 2500, scroll: false })
    await stageAt(t, 'speak')
    await mock(t, { faceLost: false })
    await t.shot('332-err-echo-unread', ['.va-echo', '.va-echo-unread'], { wait: 2800, timeout: 120000 })
    await mock(t, { dark: false, noisy: true })
    await t.press('[aria-label="Back to home"]')
    await t.see('.va-home')
    await t.press('.va-foot .va-link')
    await t.shot('333-err-check-noisy', '.va-stage[data-step="check"] .va-check li[data-mark="warn"]', { wait: 1500, scroll: false, timeout: 30000 })
  },
  { cost: 8 },
)

// 4xx: the tune step on a real face (clips of one man posing; the camera is a canvas that plays them)
const TAKES = {
  rest: ['blinking.webm', 0.3, 5.7, 0.3],
  smile: ['smiling.webm', 1.35, 2.8, 0.75],
  sad: ['blinking.webm', 0.3, 5.7, 0.3], // there is no corners-down clip: this step shows what waiting looks like
  angry: ['frowning.webm', 0.5, 1.8, 0.25],
  surprised: ['surprised.webm', 1.2, 2.45, 0.85],
}
track(
  'tune',
  ['phone', 'laptop'],
  ['401-tune-intro', '402-tune-rest', '403-tune-smile', '404-tune-waiting', '405-tune-brows-down', '406-tune-brows-up', '407-tune-learning', '408-tune-result', '409-tune-result-smiling'],
  async (t) => {
    const { page } = t
    const show = (face) => page.evaluate(([f, from, to, start]) => window.__cam.play(f, from, to, start), TAKES[face])
    await t.open(url('/'), '.va-first')
    await page.evaluate(() => window.__cam.load())
    await show('rest')
    await page.fill('.va-field input', `test-design-tune-${t.size}`)
    await t.press('button[type=submit]')
    await t.shot('401-tune-intro', '.vt-flow[data-screen="intro"]', { wait: 2500, scroll: false, timeout: 120000 })
    await t.press('[data-testid="tune-start"]')
    const NAME = { rest: '402-tune-rest', smile: '403-tune-smile', angry: '405-tune-brows-down', surprised: '406-tune-brows-up' }
    const done = new Set()
    let last = -1
    let asked = 0
    const t0 = Date.now()
    for (;;) {
      if (Date.now() - t0 > 180000) throw new Missing('408-tune-result: the tune step did not finish in 3 minutes')
      const s = await page.evaluate(() => {
        const el = document.querySelector('.vt-flow')
        const ring = document.querySelector('.vt-ring-fill')
        return el ? { screen: el.dataset.screen, step: el.dataset.step, state: el.dataset.state, index: Number(el.dataset.index), progress: 1 - Number(ring?.style.strokeDashoffset || 1) } : null
      })
      if (!s) throw new Missing('408-tune-result: the tune step went away')
      if (s.screen === 'run' && s.index >= 0 && s.index !== last) {
        last = s.index
        asked = Date.now()
        const face = s.step
        setTimeout(() => void show(face).catch(() => {}), 700)
      }
      if (s.screen === 'run' && s.index === last) {
        if (s.step === 'sad' && s.state === 'wait' && Date.now() - asked > 1800 && !done.has('wait')) {
          done.add('wait')
          await t.shot('404-tune-waiting', '.vt-flow[data-screen="run"]', { scroll: false })
        }
        if (NAME[s.step] && !done.has(s.step) && s.state === 'hold' && s.progress > 0.4) {
          done.add(s.step)
          await t.shot(NAME[s.step], '.vt-flow[data-screen="run"]', { scroll: false })
        }
      }
      if (s.screen === 'training' && !done.has('training')) {
        done.add('training')
        await t.shot('407-tune-learning', '.vt-flow', { scroll: false }).catch(() => {})
      }
      if (s.screen === 'result') break
      await sleep(40)
    }
    await show('rest')
    await t.shot('408-tune-result', '.vt-flow[data-screen="result"]', { wait: 1800, scroller: '.vt-body' })
    await show('smile')
    await t.shot('409-tune-result-smiling', '.vt-flow[data-screen="result"]', { wait: 2200, scroll: false })
  },
  { camera: 'clips', cost: 5 },
)

// 5xx: the stage (the big-screen mirror), every state of the simulated show
const STAGE = [
  ['501-stage-attract', 'sim=idle', null, 'attract'],
  ['502-stage-tune-smile', '', 4.6, 'tune'],
  ['503-stage-tune-brows', '', 11.4, 'tune'],
  ['504-stage-tune-training', '', 17.05, 'tune', 600],
  ['505-stage-tune-done', '', 20, 'tune'],
  ['506-stage-settle', '', 32.4, 'ping'],
  ['507-stage-nod', '', 37.6, 'ping'],
  ['508-stage-laugh', '', 48, 'ping'],
  ['509-stage-speak', '', 60, 'ping'],
  ['510-stage-breathe', '', 78, 'ping'],
  ['511-stage-reading', '', 84.7, 'reading', 'hold'],
  ['512-stage-echo', '', 88.5, 'echo'],
  ['513-stage-dose', '', 104, 'dose'],
  ['514-stage-again-laugh', '', 119.5, 'ping'],
  ['515-stage-again-breathe', '', 127, 'ping'],
  ['516-stage-again', '', 134, 'again'],
  ['517-stage-after-echo', 'miniecho=1', 136, null],
  // an older phone build: no mesh, no muscles, no AirPods
  ['520-stage-old-laugh', 'sim=old', 21.4, 'ping'],
  ['521-stage-old-echo', 'sim=old', 62, 'echo'],
  // a phone without AirPods: head and heart from the camera
  ['522-stage-cam-laugh', 'sim=cam', 48, 'ping'],
  ['523-stage-cam-nod', 'sim=cam', 37.6, 'ping'],
  ['524-stage-baretune', 'sim=baretune', 8.6, 'tune'],
  ['525-stage-nomesh-laugh', 'sim=nomesh', 48, 'ping'],
]
track(
  'stage',
  ['wide', 'laptop', 'phone'],
  [...STAGE.map((s) => s[0]), '530-stage-lobby', '531-stage-waiting'],
  async (t) => {
    const todo = [...STAGE]
    const one = async () => {
      // a context each: a page's clock belongs to its context, and three shows stopped and played on one clock
      // would stop and play each other
      const ctx = await t.ctx.browser().newContext(SIZES[t.size])
      const page = await ctx.newPage()
      await page.clock.install()
      watch(page, t.tag)
      const tt = makeT(t.track, t.size, page, ctx)
      tt.clock = true
      for (;;) {
        const s = todo.shift()
        if (!s) break
        const [name, q, at, mode, settle] = s
        try {
          // The show runs on the page's clock, and a busy machine must not let it run on past the moment we came
          // for: stop the clock, place the show, play `settle` ms of its own time, and picture a show standing still.
          await tt.open(url('/clinic/live/DEMO01', '', `mock=1${q ? `&${q}` : ''}`), '.sg')
          await page.evaluate(() => document.fonts.ready)
          await tt.stop(name)
          if (at !== null) await page.evaluate((sec) => window.__stageSeek(sec), at)
          await page.clock.runFor(settle === 'hold' ? 250 : (settle ?? 1500))
          // styles still move on real time: let the longest of them (700 ms) land
          await tt.shot(name, mode ? `.sg[data-mode="${mode}"]` : '.sg', { wait: 1000, scroll: t.phone && settle !== 'hold' })
        } catch (e) {
          problems.push(`${t.tag}: ${e instanceof Missing ? e.message : `${name}: ${String(e).slice(0, 200)}`}`)
        } finally {
          await page.clock.resume().catch(() => {})
        }
      }
      await ctx.close()
    }
    await Promise.all([one(), one(), one()])
    // no phone yet: the lobby (it opens the newest room, so the other runs' phones are kept out of its sight) and a room nobody is in
    await t.page.route('**/api/live/rooms', (r) => r.fulfill({ json: [] }))
    await t.open(url('/clinic/live'), '.sg')
    await t.shot('530-stage-lobby', '.sg[data-mode="attract"]', { wait: 2500, scroll: t.phone })
    await t.open(url('/clinic/live/NOBODY'), '.sg')
    await t.shot('531-stage-waiting', '.sg', { wait: 2500, scroll: t.phone })
  },
  { cost: 4 },
)

// 6xx: the hall wall
track(
  'wall',
  ['wide', 'laptop', 'phone'],
  ['601-wall-nobody-yet', '602-wall-3', '603-wall-30', '604-wall-300', '605-wall-now', '606-wall-loading', '607-wall-reconnecting'],
  async (t) => {
    const { page } = t
    const root = t.size === 'phone' ? '.wl-phone' : '.wl-big'
    // the hall before anyone has pinged: the server's own empty answer, without the "simulated" flag
    const empty = { ...(await (await fetch(`${base}api/wall?demo=0`)).json()), simulated: false }
    await page.route('**/api/wall', (r) => r.fulfill({ json: empty }))
    await t.open(url('/wall'), root)
    await t.shot('601-wall-nobody-yet', [root, '.wl-counts'], { wait: 1800 })
    await page.unroute('**/api/wall')
    for (const [name, q] of [['602-wall-3', 'demo=3'], ['603-wall-30', 'demo=30'], ['604-wall-300', 'demo=300&h=30']]) {
      await t.open(url('/wall', '', q), root)
      await t.shot(name, [root, '.wl-sim'], { wait: 2200 })
    }
    await t.open(url('/wall'), root)
    await t.shot('605-wall-now', [root, '.wl-counts'], { wait: 2200, scroll: false })
    // the first answer has not come yet
    let hold = true
    await page.route('**/api/wall*', async (r) => {
      while (hold) await sleep(100)
      await r.abort().catch(() => {})
    })
    await t.open(url('/wall'), root)
    await t.shot('606-wall-loading', root, { wait: 1200, scroll: false })
    hold = false
    await page.unroute('**/api/wall*')
    // the server goes away while the wall is up: the last picture stays, with a small "Reconnecting"
    await t.open(url('/wall', '', 'demo=300&h=30'), '.wl-sim')
    await page.route('**/api/wall*', (r) => r.abort())
    await t.shot('607-wall-reconnecting', [root, '.wl-stale'], { timeout: 40000, scroll: false })
  },
  { cost: 3 },
)
track(
  'wall-me',
  ['phone', 'laptop'],
  ['611-wall-me-came-back', '612-wall-me-first-ping', '613-wall-me-not-found', '614-wall-me-finding', '620-wall-poster'],
  async (t) => {
    const { page } = t
    await t.open(url('/wall', '', 'u=x&demo=300&h=30'), '.wl-me')
    await t.shot('611-wall-me-came-back', ['.wl-me', '.wl-me-ch'], { wait: 2200 })
    // a first ping with nobody else around: the simulated visitor with one ping, in a hall of three
    const three = await (await fetch(`${base}api/wall?demo=3&u=x`)).json()
    await page.route('**/api/wall*', (r) => r.fulfill({ json: three }))
    await t.open(url('/wall', '', 'u=x&demo=3'), '.wl-me')
    await t.shot('612-wall-me-first-ping', '.wl-me', { wait: 2200 })
    await page.unroute('**/api/wall*')
    await t.open(url('/wall', '', 'u=nobody000000'), '.wl-me')
    await t.shot('613-wall-me-not-found', ['.wl-me', '.wl-me-lede'], { wait: 2200, scroll: false })
    let hold = true
    await page.route('**/api/wall*', async (r) => {
      while (hold) await sleep(100)
      await r.abort().catch(() => {})
    })
    await t.open(url('/wall', '', 'u=nobody000000'), '.wl-me')
    await t.shot('614-wall-me-finding', '.wl-me-wait', { wait: 800, scroll: false })
    hold = false
    await page.unroute('**/api/wall*')
    await t.open(url('/wall/poster'), '.wl-sheet')
    await t.shot('620-wall-poster', '.wl-sheet', { wait: 1800 })
  },
)

// 7xx: the science page, with its two live sources present, missing and half there
const SCI_FULL = {
  generatedAt: '2026-11-14T02:10:00Z',
  pulse: { dataset: 'UBFC-rPPG (DATASET_2)', url: 'https://sites.google.com/view/ybenezeth/ubfcrppg', subjects: 42, minutes: 47.3, maeBpm: 2.84, rmseBpm: 5.9, within5Pct: 88.4, coveragePct: 81.2, reference: 'finger pulse oximeter', note: 'Scored every 5 s on a 10 s window, after 12 s of video.' },
  smile: { clips: 60, people: 41, sensitivityPct: 92.5, falsePositivePct: 4.1, faceFoundPct: 98.7, source: 'Mixkit stock clips', note: 'Threshold 0.15, the same step the app uses for smile onset.' },
  robustness: [
    { condition: 'original', faceFoundPct: 99.1, pulseCoveragePct: 83, smileSensitivityPct: 93 },
    { condition: 'light50', faceFoundPct: 98.8, pulseCoveragePct: 78.5, smileSensitivityPct: 92 },
    { condition: 'light12', faceFoundPct: 91, pulseCoveragePct: 22.4, smileSensitivityPct: 80 },
    { condition: 'backlight', faceFoundPct: 95.2, pulseCoveragePct: 41, smileSensitivityPct: 85.5 },
    { condition: 'fps15', faceFoundPct: 99, pulseCoveragePct: 70, smileSensitivityPct: null },
    { condition: 'halfres', faceFoundPct: 97, pulseCoveragePct: null, smileSensitivityPct: 90 },
  ],
  limits: ['Pulse recordings are of people sitting still under office light.', 'Smile clips are stock footage: posed more than natural.'],
}
const SCI_PARTIAL = {
  generatedAt: 'not a date',
  pulse: { dataset: 'UBFC-rPPG (DATASET_2)', subjects: 12, maeBpm: 3.1, rmseBpm: 'NaN', within5Pct: null },
  smile: { clips: 'many', sensitivityPct: 250 },
  robustness: [{ condition: 'original', faceFoundPct: 99.1 }, { faceFoundPct: 3 }, 'junk'],
  limits: 'none',
}
const HALL_FULL = {
  generatedAt: '2026-11-14T09:30:00Z', simulated: false, started: 61, visitors: 48, pings: 73, returning: 11, minGapH: 3,
  readRates: { smile: 0.93, voice: 0.58, heart: 0.41, move: 0.97 },
  devices: [
    { family: 'ios', label: 'iPhone', visitors: 30, pings: 47, readRates: { smile: 0.96, voice: 0.6, heart: 0.47, move: 0.98 } },
    { family: 'android', label: 'Android', visitors: 15, pings: 22, readRates: { smile: 0.9, voice: 0.55, heart: 0.31, move: 0.95 } },
    { family: 'native', label: 'iPhone + AirPods', visitors: 3, pings: 4, readRates: { smile: 1, voice: 0.5, heart: 1, move: 1 } },
  ],
}
const HALL_PARTIAL = { visitors: 2, pings: 3, channels: [{ channel: 'smile', readRate: 1 }, { channel: 'voice', readRate: null }], devices: 'x', readRates: { heart: 'high' } }
const HALL_EMPTY = { generatedAt: '2026-11-13T22:00:00Z', visitors: 0, pings: 0, returning: 0, minGapH: 3, readRates: { smile: null, voice: null, heart: null, move: null }, devices: [] }
const SCI_CASES = [
  ['701-science', 'LIVE', 'LIVE'],
  ['710-science-all-data', SCI_FULL, HALL_FULL],
  ['720-science-no-data', null, null],
  ['730-science-half-data', SCI_PARTIAL, HALL_PARTIAL],
  ['740-science-empty-hall', {}, HALL_EMPTY],
]
track(
  'science',
  ['laptop', 'phone'],
  ['701-science', '710-science-all-data-sensors', '711-science-all-data-hall', '720-science-no-data-sensors', '721-science-no-data-hall', '730-science-half-data-sensors', '731-science-half-data-hall', '740-science-empty-hall-sensors', '741-science-empty-hall-hall'],
  async (t) => {
    const { page } = t
    for (const [name, validation, hall] of SCI_CASES) {
      await page.unroute('**/validation.json').catch(() => {})
      await page.unroute('**/api/wall').catch(() => {})
      if (validation !== 'LIVE') await page.route('**/validation.json', (r) => (validation === null ? r.fulfill({ status: 404, body: 'not found' }) : r.fulfill({ json: validation })))
      if (hall !== 'LIVE') await page.route('**/api/wall', (r) => (hall === null ? r.fulfill({ status: 404, json: { error: 'not found' } }) : r.fulfill({ json: hall })))
      await t.open(url('/science'), '.sci h1')
      await page.waitForLoadState('networkidle').catch(() => {})
      const text = await page.evaluate(() => document.querySelector('.sci')?.innerText ?? '')
      for (const bad of ['NaN', 'undefined', 'null', 'Infinity', '[object']) if (text.includes(bad)) problems.push(`${t.tag}: ${name}: the page prints "${bad}"`)
      if (validation === 'LIVE') {
        await t.shot(name, '.sci h1', { wait: 600, maxPages: 30 })
        continue
      }
      const stem = name.replace(/^\d+-/, '')
      const n = Number(name.slice(0, 3))
      for (const [k, id] of ['sensors', 'hall'].entries()) {
        await page.evaluate((id) => document.getElementById(`sci-${id}`)?.scrollIntoView({ block: 'start' }), id)
        await t.shot(`${n + k}-${stem}-${id}`, `#sci-${id}`, { wait: 500, scroll: false })
      }
    }
  },
  { cost: 2 },
)

// 8xx: the clinic
track(
  'clinic',
  ['laptop', 'phone'],
  [
    '801-clinic-today', '802-clinic-today-loading', '803-clinic-today-filtered', '804-clinic-today-called', '805-clinic-today-nobody', '806-clinic-today-server-down',
    '810-clinic-patient', '811-clinic-patient-hover', '812-clinic-patient-steady', '813-clinic-patient-booster', '814-clinic-patient-not-found', '815-clinic-patient-loading',
  ],
  async (t) => {
    const { page } = t
    const fresh = (hash, hq = '') => t.open(url(hash, '', hq), '.cl')
    await fresh('/clinic')
    await t.shot('801-clinic-today', ['.cl-table', '.cl-name'], { wait: 1500 })
    const hrefs = await page.$$eval('.cl-name', (as) => as.map((a) => a.getAttribute('href').replace(/^#/, '').replace(/\?.*$/, '')))
    await page.locator('.cl-count:not([disabled])').nth(1).click()
    await t.shot('803-clinic-today-filtered', '.cl-count[aria-pressed="true"]', { wait: 500, scroll: false })

    let hold = true
    const stall = async (r) => {
      while (hold) await sleep(100)
      await r.continue().catch(() => {})
    }
    await page.route('**/api/clinic/**', stall)
    await fresh('/clinic')
    await t.shot('802-clinic-today-loading', '.cl-skel', { wait: 600, scroll: false })
    await fresh(hrefs[0])
    await t.shot('815-clinic-patient-loading', '.cl-skel', { wait: 600, scroll: false })
    hold = false
    await page.unroute('**/api/clinic/**', stall)

    await page.route('**/api/clinic/patients', (r) => r.fulfill({ json: [] }))
    await fresh('/clinic')
    await t.shot('805-clinic-today-nobody', '.cl-empty', { wait: 600, scroll: false })
    await page.unroute('**/api/clinic/patients')

    // the server cannot be reached: the built-in cohort takes over and the bar says so
    await page.route('**/api/clinic/**', (r) => r.abort())
    await fresh('/clinic')
    await t.shot('806-clinic-today-server-down', ['.cl-table', '.cl-foot'], { wait: 1200, scroll: false })
    await page.unroute('**/api/clinic/**')

    await fresh(hrefs[0])
    await t.shot('810-clinic-patient', ['.cl-phead', '.cl-echo'], { wait: 2500 })
    const box = await page.locator('.cl-echo').boundingBox()
    if (t.phone) await page.touchscreen.tap(box.x + box.width * 0.78, box.y + box.height * 0.5)
    else await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.5)
    await t.shot('811-clinic-patient-hover', '.cl-echo', { wait: 400, scroll: false })
    await fresh(hrefs[Math.min(14, hrefs.length - 1)])
    await t.shot('812-clinic-patient-steady', ['.cl-phead', '.cl-echo'], { wait: 2500, scroll: false })
    await fresh('/clinic/p/nobody0000')
    await t.shot('814-clinic-patient-not-found', '.cl-empty', { wait: 800, scroll: false })

    // actions on the built-in cohort only (?mock=1 keeps them in the page): nothing is asked of the server
    await fresh('/clinic', 'mock=1')
    await t.see('.cl-table')
    await page.locator('.cl-btn--small:not(.is-done)').first().click()
    await t.shot('804-clinic-today-called', '.cl-btn--small.is-done', { wait: 400, scroll: false })
    await page.locator('.cl-name').first().click()
    await t.see('.cl-phead')
    await page.click('text=Request booster session')
    await t.shot('813-clinic-patient-booster', '.cl-done', { wait: 500, scroll: false })
  },
  { cost: 3 },
)

// 9xx: the sensor lab, reached from Settings (a camera that plays a file)
track(
  'lab',
  ['phone', 'laptop'],
  ['901-lab', '902-tune-lab'],
  async (t) => {
    const { page } = t
    await t.open(url('/lab'), 'h1, h2, button')
    await t.shot('901-lab', 'h1, h2, button', { wait: 2500 })
    await t.open(url('/tune'), '.vt-lab')
    await t.shot('902-tune-lab', '.vt-lab', { wait: 2500, scroll: false })
  },
)

// ---------------------------------------------------------------- run

const fakeArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
if (existsSync(FIX + 'swing66.y4m')) fakeArgs.push(`--use-file-for-fake-video-capture=${FIX}swing66.y4m`)
if (existsSync(FIX + 'talk.wav')) fakeArgs.push(`--use-file-for-fake-audio-capture=${FIX}talk.wav`)
const clipArgs = ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']

/** a camera made of clips of one posing face (the same idea as web/tests/tune/fake-camera.mjs) */
async function clipCamera(ctx) {
  const names = [...new Set(Object.values(TAKES).map((x) => x[0]))]
  for (const n of names) if (!existsSync(CLIPS + n)) throw new Missing(`401-tune-intro: the face clip ${CLIPS + n} is not there`)
  await ctx.route('**/__clips/*', (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    return names.includes(name) ? route.fulfill({ path: CLIPS + name, contentType: 'video/webm' }) : route.fulfill({ status: 404, body: '' })
  })
  await ctx.addInitScript((names) => {
    if (window.top !== window || !navigator.mediaDevices) return
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const g = canvas.getContext('2d')
    g.fillStyle = '#2a2622'
    g.fillRect(0, 0, 640, 480)
    const vids = {}
    let cur = null
    window.__cam = {
      async load() {
        for (const n of names) {
          const blob = await (await fetch(new URL('__clips/' + encodeURIComponent(n), document.baseURI))).blob()
          const v = document.createElement('video')
          v.muted = true
          v.playsInline = true
          v.preload = 'auto'
          v.src = URL.createObjectURL(blob)
          await new Promise((res) => {
            v.oncanplaythrough = res
            v.onerror = res
            setTimeout(res, 8000)
          })
          vids[n] = v
        }
      },
      play(n, from = 0, to = 1e9, start = from) {
        const v = vids[n]
        if (!v) throw new Error('no clip ' + n)
        if (cur && cur.v !== v) cur.v.pause()
        cur = { v, from, to: Math.min(to, (v.duration || 1e9) - 0.06) }
        v.currentTime = Math.min(start, from)
        v.play().catch(() => {})
      },
    }
    const draw = () => {
      if (cur) {
        const v = cur.v
        if (v.ended || v.currentTime >= cur.to) {
          v.currentTime = cur.from
          v.play().catch(() => {})
        }
        if (v.readyState >= 2) g.drawImage(v, 0, 0, 640, 480)
      }
      requestAnimationFrame(draw)
    }
    requestAnimationFrame(draw)
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(30)
  }, names)
}

const jobs = []
for (const tr of TRACKS) {
  for (const size of tr.sizes) {
    if (filter && !filter.test(`${tr.id}.${size}`)) continue
    for (const s of tr.shots) want.push({ file: `${s}.${size}.png`, tag: `${tr.id}.${size}` })
    jobs.push(Object.assign(async () => {
      const tag = `${tr.id}.${size}`
      const started = Date.now()
      // A run that stops is tried once more from the top (the box is shared and a busy minute can drop a page load);
      // the first stop is kept in the manifest. A second stop is a failure.
      for (let attempt = 1; attempt <= 2; attempt++) {
        // a browser each: screenshots of many animated pages queue up behind one compositor, and short-lived states slip away
        const browser = await pw.chromium.launch({ args: tr.camera === 'clips' ? clipArgs : fakeArgs })
        const ctx = await browser.newContext({ ...SIZES[size], ...(tr.ua && size === 'phone' ? { userAgent: tr.ua } : {}) })
        let stop = null
        const mine = []
        try {
          if (tr.camera === 'clips') await clipCamera(ctx)
          const page = await ctx.newPage()
          if (tr.clock) await page.clock.install()
          page.on('pageerror', (e) => !NOISE.test(String(e)) && mine.push(`${tag}: uncaught error in the page: ${String(e).slice(0, 240)}`))
          watch(page, tag)
          await tr.run(makeT(tr, size, page, ctx))
        } catch (e) {
          stop = `${tag}: ${e instanceof Missing ? e.message : `stopped: ${String(e).split('\n').slice(0, 3).join(' ').slice(0, 320)}`}`
        }
        await browser.close().catch(() => {})
        if (!stop) {
          problems.push(...mine)
          break
        }
        if (attempt === 2) problems.push(stop, ...mine)
        else noise.push(`first try, then run again: ${stop}`)
      }
      console.log(`  ${tag.padEnd(26)} ${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s`)
    }, { cost: tr.cost ?? 1 }))
  }
}
if (!jobs.length) {
  console.error(`nothing matches ${filter}`)
  process.exit(2)
}
console.log(`${jobs.length} runs against ${base} -> ${out}`)
// the long ones (a 60-second ping inside) go first; a cap keeps the dev server and the screenshots quick
jobs.sort((a, b) => b.cost - a.cost)
let next = 0
const worker = async () => {
  while (next < jobs.length) await jobs[next++]()
}
await Promise.all(Array.from({ length: Math.min(MAX_AT_ONCE, jobs.length) }, worker))

const have = new Set(saved.map((s) => s.file))
for (const w of want) if (!have.has(w.file)) problems.push(`${w.tag}: MISSING ${w.file}`)
saved.sort((a, b) => a.file.localeCompare(b.file))
writeFileSync(out + 'manifest.json', JSON.stringify({ base, at: new Date().toISOString(), tookS: Math.round((Date.now() - t00) / 1000), files: saved, problems, consoleErrors: [...new Set(noise)] }, null, 1))
console.log(`\n${saved.length} pictures (${want.length} screens asked for) in ${Math.round((Date.now() - t00) / 1000)} s`)
if (noise.length) console.log(`\n${new Set(noise).size} console errors (not failures):\n  ${[...new Set(noise)].slice(0, 12).join('\n  ')}`)
if (problems.length) {
  console.log(`\nFAILED, ${problems.length} problem(s):\n  ${[...new Set(problems)].sort().join('\n  ')}`)
  process.exit(1)
}
console.log('\nevery screen is there, none blank')
