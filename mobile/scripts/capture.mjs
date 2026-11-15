// Film capture: plays one scripted pass through the phone app and saves it as a 30 fps clip at 3x (1206 x 2622).
//   node scripts/capture.mjs <name> [base]
// Scenes are in scripts/scenes.mjs. Frames go to /bulk2/runs/depression/film/launch/cap/<name>/, the clip to .../clips/<name>.mp4.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { SCENES } from './scenes.mjs'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')

const name = process.argv[2]
const base = process.argv[3] ?? process.env.VIRE_BASE ?? 'http://127.0.0.1:5883/app/'
const scene = SCENES[name]
if (!scene) {
  console.log('scenes:', Object.keys(SCENES).join(' '))
  process.exit(1)
}
const ROOT = '/bulk2/runs/depression/film/launch'
const dir = `${ROOT}/cap/${name}`
if (existsSync(dir)) rmSync(dir, { recursive: true })
mkdirSync(dir, { recursive: true })
mkdirSync(`${ROOT}/clips`, { recursive: true })

const W = 402
const H = 874
const DPR = 3
// Drawing a phone screen at 3x takes this machine about a tenth of a second, so the app's own clock is slowed K times
// while it is recorded (timers, animation frames, CSS animations alike) and the clip is sped back up: every frame
// of app time is then really drawn. Waits and durations in a scene are in app time.
const K = +(process.env.VIRE_SLOW ?? 4)
// the scale is forced on the whole browser, not emulated: an emulated scale gives screencast frames at 1x
const b = await chromium.launch({ headless: true, args: [`--force-device-scale-factor=${DPR}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const ctx = await b.newContext({ viewport: null, hasTouch: true, reducedMotion: 'no-preference' })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)))
const cdp = await ctx.newCDPSession(page)

// the film day is fixed, so the greeting does not follow the night this was captured in
await page.addInitScript((K) => {
  const RealDate = Date
  const at = new RealDate(2026, 10, 14, 17, 30, 0).getTime()
  const t0 = RealDate.now()
  class FilmDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a)
      else super(at + (RealDate.now() - t0) / K)
    }
    static now() {
      return at + (RealDate.now() - t0) / K
    }
  }
  // eslint-disable-next-line no-global-assign
  Date = FilmDate
  const now = performance.now.bind(performance)
  performance.now = () => now() / K
  const raf = window.requestAnimationFrame.bind(window)
  // the frame time Chrome hands over is already slowed by the animation rate set below, from another zero: use ours
  window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()))
  const st = window.setTimeout.bind(window)
  window.setTimeout = (fn, ms = 0, ...a) => st(fn, ms * K, ...a)
  const si = window.setInterval.bind(window)
  window.setInterval = (fn, ms = 0, ...a) => si(fn, ms * K, ...a)
}, K)
if (scene.init) await page.addInitScript(scene.init)
// the film shows the product as it is with AirPods in: the notes that say they are out (true of this browser) are left off
await page.addInitScript(() => {
  // and the app is told it runs in the Vire iPhone app, as it does on a patient's phone: the teaching wording is then the app's own
  window.webkit = { messageHandlers: { vire: { postMessage() {} } } }
  const OFF = [/^\s*AirPods out\s*$/, /^\s*AirPods not connected\s*$/, /^The practice runs without AirPods\./, /^\s*Sample result, not measured\s*$/]
  const sweep = () => {
    document.querySelectorAll('.chip, .pill, p.small').forEach((e) => {
      if (e.style.display !== 'none' && OFF.some((r) => r.test(e.textContent))) e.style.display = 'none'
    })
  }
  new MutationObserver(sweep).observe(document, { childList: true, subtree: true, characterData: true })
})

const frames = []
let rec = false
let n = 0
cdp.on('Page.screencastFrame', (f) => {
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  if (!rec) return
  const file = `f${String(n++).padStart(5, '0')}.jpg`
  writeFileSync(`${dir}/${file}`, Buffer.from(f.data, 'base64'))
  frames.push({ file, t: f.metadata.timestamp })
})

/** what a scene can do */
const api = {
  page,
  wait: (ms) => page.waitForTimeout(ms * K),
  /** go to a screen without recording the load */
  async open(path) {
    await page.goto(`${base}#${path}`)
    await cdp.send('Animation.enable')
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / K })
    await page.waitForTimeout(600 * K)
  },
  async go(path) {
    await page.evaluate((p) => {
      location.hash = p
    }, path)
  },
  /** eased scroll of the top screen to y, over ms */
  async scroll(y, ms = 1200) {
    await page.evaluate(
      ([y, ms]) =>
        new Promise((done) => {
          const s = [...document.querySelectorAll('.screen')].pop()
          const from = s.scrollTop
          const t0 = performance.now()
          const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
          const step = (now) => {
            const k = Math.min(1, (now - t0) / ms)
            s.scrollTop = from + (y - from) * ease(k)
            if (k < 1) requestAnimationFrame(step)
            else done()
          }
          requestAnimationFrame(step)
        }),
      [y, ms],
    )
  },
  /** tap the first element that matches a Playwright selector */
  async tap(sel, opts = {}) {
    const el = page.locator(sel).first()
    await el.tap({ timeout: 5000, ...opts })
  },
  async tapText(text) {
    await page.getByText(text, { exact: false }).first().tap({ timeout: 5000 })
  },
  /** a finger dragged along points [[x,y],...] in css px, over ms */
  async drag(pts, ms = 1200) {
    const steps = Math.max(8, Math.round(ms / 16))
    const at = (k) => {
      const f = k * (pts.length - 1)
      const i = Math.min(pts.length - 2, Math.floor(f))
      const u = f - i
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]
    }
    const [x0, y0] = at(0)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    for (let s = 1; s <= steps; s++) {
      const [x, y] = at(s / steps)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      await page.waitForTimeout((ms * K) / steps)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  },
  eval: (fn, arg) => page.evaluate(fn, arg),
  start() {
    rec = true
    // frames only come when the screen changes: a dot that cannot be seen makes one now, so a still opening is kept
    page
      .evaluate(() => {
        const d = document.createElement('div')
        d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;background:#000;opacity:0.02;z-index:99999;pointer-events:none'
        document.body.appendChild(d)
        requestAnimationFrame(() => requestAnimationFrame(() => d.remove()))
      })
      .catch(() => {})
  },
  stop() {
    rec = false
  },
}

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 96, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 })
await scene.run(api)
rec = false
await cdp.send('Page.stopScreencast')
await b.close()

if (frames.length < 2) {
  console.log('no frames')
  process.exit(1)
}
// each frame holds until the next one arrived; ffmpeg then lays them on an even 30 a second
const t0 = frames[0].t
const list = frames.map((f, i) => `file '${dir}/${f.file}'\nduration ${Math.max(0.0005, ((frames[i + 1]?.t ?? f.t + K / 30) - f.t) / K).toFixed(5)}`).join('\n')
writeFileSync(`${dir}/list.txt`, `${list}\nfile '${dir}/${frames.at(-1).file}'\n`)
const out = `${ROOT}/clips/${name}.mp4`
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', 'fps=30,scale=1206:2622:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-g', '15', '-movflags', '+faststart', out])
const span = (frames.at(-1).t - t0) / K
console.log(`${out}  ${span.toFixed(2)} s  ${frames.length} frames (${(frames.length / span).toFixed(0)} a second captured)`)
