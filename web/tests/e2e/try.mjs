#!/usr/bin/env node
// /#/try in a phone-sized WebKit: the breathing with the phone's own motion sensor standing in for the AirPods.
// There is no phone here, so a made-up chest dispatches `devicemotion` events into the page, breathing at whatever
// pace the page asks for (read from data-pace). Nothing here is a measurement of a person: it shows that the page
// asks for motion, plays the sea, reads the rows, steps the pace, draws the line, says what it read and saves it.
// The API must be a test instance of its own (see vite.isolated.config.ts).
//   node web/tests/e2e/try.mjs <baseUrl> <outDir> [worker token]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { webkit } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5897/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/try'
const worker = process.argv[4] ?? 'try-test'
mkdirSync(out, { recursive: true })
const errors = []
const fail = (why) => { console.log(`FAIL ${why}`); errors.push(why) }
const ok = (what) => console.log(`ok   ${what}`)
const check = (cond, what) => (cond ? ok(what) : fail(what))
const browser = await webkit.launch({ headless: true })

/** a page of one size, with the network it makes written down */
async function open(width, height, { reducedMotion, permission } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: width < 600, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 vire-e2e' })
  const page = await ctx.newPage()
  const net = { posts: [], sound: [], sessions: 0 }
  page.on('pageerror', (e) => fail(`page error: ${e}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) fail(`console: ${m.text()}`) })
  page.on('request', (req) => {
    const u = new URL(req.url())
    if (u.pathname.startsWith('/api/sound/')) net.sound.push(`${req.method()} ${u.pathname}`)
    if (/\/api\/ear\/sessions/.test(u.pathname) && req.method() === 'POST') net.sessions++
  })
  page.on('response', async (res) => {
    if (res.request().method() !== 'POST' || !/\/api\/try$/.test(new URL(res.url()).pathname)) return
    try { net.posts.push({ status: res.status(), body: JSON.parse(res.request().postData() ?? '{}'), answer: await res.json() }) } catch { /* the page went away */ }
  })
  if (permission) await page.addInitScript((answer) => {
    window.__asked = 0
    window.DeviceMotionEvent = class { static requestPermission() { window.__asked++; return Promise.resolve(answer) } }
  }, permission)
  return { ctx, page, net }
}

/** the made-up chest: 60 events a second, tilting `swing` degrees with each breath at the page's pace (or its own) */
const chest = (page, { swing = 2, own = null } = {}) => page.evaluate(({ swing, own }) => {
  const speed = Math.max(1, Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('speed')) || 1)
  let phase = -0.3 * Math.PI
  let last = performance.now()
  let n = 0
  clearInterval(window.__chest)
  window.__chest = setInterval(() => {
    const main = document.querySelector('main.ty')
    const now = performance.now()
    const dt = (now - last) * speed
    last = now
    const pace = own ?? Number(main?.getAttribute('data-pace') || 10)
    if (main?.getAttribute('data-stage') === 'run') phase += (2 * Math.PI * pace * dt) / 60000
    const pitch = (14 + (swing / 2) * Math.sin(phase)) * Math.PI / 180
    const roll = (5 + (swing / 6) * Math.sin(phase + 0.5)) * Math.PI / 180
    const j = () => (Math.random() - 0.5) * 0.08
    const e = new Event('devicemotion')
    e.accelerationIncludingGravity = { x: 9.81 * Math.sin(roll) + j(), y: -9.81 * Math.cos(pitch) * Math.cos(roll) + j(), z: 9.81 * Math.sin(pitch) + j() }
    e.rotationRate = { alpha: j() * 10, beta: j() * 10, gamma: j() * 10 }
    e.interval = 16
    window.dispatchEvent(e)
    window.__chestN = ++n
  }, 16)
}, { swing, own })

const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` })
const fits = async (page, what) => {
  const m = await page.evaluate(() => {
    const wide = [...document.querySelectorAll('main.ty *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5) }).map((el) => el.className || el.tagName)
    return { scroll: document.documentElement.scrollWidth, inner: innerWidth, wide }
  })
  check(m.scroll <= m.inner && !m.wide.length, `${what}: nothing is wider than the ${m.inner}px screen${m.wide.length ? ` (${m.wide.slice(0, 4).join(', ')})` : ''}`)
}
const attr = (page, name) => page.locator('main.ty').getAttribute(name)
const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim()
const BANNED = /AirPods (read|say|hear|sense|felt|feel)|EEG|HRV|brain|diagnos(e|is of)|treat|—|!|coherence|band-pass|amplitude/i

// ---- 1. the whole minute at real speed, 390 x 844, an iPhone that asks and is allowed ----
{
  const { ctx, page, net } = await open(390, 844, { permission: 'granted' })
  const opened = Date.now()
  await page.goto(`${base}#/try`)
  await page.waitForSelector('[data-start]', { timeout: 20000 })
  const start = await text(page, 'main.ty')
  check(/Try the breathing with your phone/.test(start) && /flat against your chest/.test(start) && /motion sensor stands in for the AirPods/.test(start), 'start: says what to do and that the phone stands in for the AirPods')
  check(/Motion numbers from this minute are saved\. No sound, no video\./.test(start) && /A signal, not a diagnosis\./.test(start), 'start: says what is saved, and "A signal, not a diagnosis."')
  check(!BANNED.test(start.replace('A signal, not a diagnosis.', '')), 'start: no banned words')
  await fits(page, 'start 390')
  await shot(page, '390-1-start')
  await chest(page)
  await page.click('[data-start]')
  await page.waitForSelector('main.ty[data-stage="run"]', { timeout: 5000 })
  await page.waitForFunction(() => document.querySelector('main.ty')?.getAttribute('data-audio') === 'running', null, { timeout: 5000 }).then(() => ok('the tap started the sound: the audio is running'), () => fail('the audio did not start from the tap'))
  check((await page.evaluate(() => window.__asked)) === 1, 'the tap asked the phone for motion, once')
  await page.waitForFunction(() => /Breathe (in|out)/.test(document.querySelector('.ty-say')?.textContent ?? ''), null, { timeout: 3000 })
  console.log(`     breathing with the sea ${((Date.now() - opened) / 1000).toFixed(1)} s after the address was opened`)
  check(Number(await attr(page, 'data-pace')) === 10, 'the sea starts at 10 breaths a minute')
  await page.waitForTimeout(3500)
  check(net.sound.some((s) => s.endsWith('/api/sound/manifest')), `the sea was asked for (${[...new Set(net.sound)].join(', ')})`)
  console.log(`     sea pieces: ${await attr(page, 'data-sound')} (modal: a piece made on Modal is playing; tone: the phone's own)`)
  check(Number(await attr(page, 'data-hz')) >= 40, `the page says how many readings a second it gets (${await attr(page, 'data-hz')})`)
  await fits(page, 'run 390')
  await shot(page, '390-2-run-first-seconds')
  await page.waitForTimeout(9000)
  const early = await page.locator('.ty-trace').evaluate((el) => ({ swing: Number(el.dataset.swing), together: Number(el.dataset.together), points: Number(el.dataset.points), tilt: el.querySelector('.ty-tilt')?.getAttribute('points')?.split(' ').length ?? 0, sea: el.querySelector('.ty-sea')?.getAttribute('points')?.split(' ').length ?? 0 }))
  check(early.tilt > 40 && early.sea > 40, `the line is drawn: ${early.tilt} points of tilt beside ${early.sea} of the sea`)
  check(early.swing > 1.2 && early.swing < 2.8, `the drawn tilt swings ${early.swing} degrees (2 were put in)`)
  check(early.together > 0.5, `the drawn tilt moves with the sea (${early.together} of 1)`)
  await shot(page, '390-3-run-line')
  const said = []
  for (const [n, pace, line] of [[1, 8.5, 'Your breath followed. Slower now: 8.5 a minute.'], [2, 7, 'Your breath followed. Slower now: 7 a minute.'], [3, 6, 'Your breath followed. Slower now: 6 a minute.']]) {
    await page.waitForFunction((n) => Number(document.querySelector('main.ty')?.getAttribute('data-checks')) >= n, n, { timeout: 40000 }).catch(() => fail(`check ${n} never came`))
    const got = await text(page, '.ty-read')
    said.push(got)
    check(got === line, `check ${n} says: "${got}"`)
    await page.waitForTimeout(700)
    check(Number(await attr(page, 'data-pace')) === pace, `after check ${n} the sea plays ${pace} a minute`)
    await shot(page, `390-4-run-check-${n}`)
  }
  await page.waitForSelector('main.ty[data-stage="result"]', { timeout: 30000 })
  const head = await text(page, '.ty-main h1')
  const lines = await page.locator('.ty-lines').evaluate((el) => ({ ...el.dataset, text: el.innerText.replace(/\s+/g, ' ') }))
  check(head === 'The sea went from 10 to 6 breaths a minute.', `result: "${head}"`)
  check(lines.checks === '3' && lines.followed === '3' && lines.still === '0' && lines.not === '0' && lines.moving === '0', `result counts: ${lines.text}`)
  const all = await text(page, 'main.ty')
  check(/With AirPods the same is read from your head, with your heart rate/.test(all) && /A signal, not a diagnosis\./.test(all), 'result: the AirPods line and "A signal, not a diagnosis."')
  check(!BANNED.test(all.replace('A signal, not a diagnosis.', '')), 'result: no banned words')
  check((await page.locator('a[href="#/watch"]').count()) > 0 && (await page.locator('a[href="#/clinic"]').count()) > 0 && (await page.locator('[data-again]').count()) === 1, 'result: Watch a run, The clinic, Try again')
  await fits(page, 'result 390')
  await shot(page, '390-5-result')
  await page.waitForTimeout(800)
  const post = net.posts.find((p) => p.body.ended === 'time')
  check(!!post && post.status === 200, `the try was sent to /api/try (${post?.status})`)
  if (post) {
    const b = post.body
    check(b.result.from === 10 && b.result.to === 6 && b.result.checks === 3 && b.result.followed === 3, `what was sent matches the screen: ${JSON.stringify(b.result)}`)
    check(b.rows.length > 3500 && b.rows.every((r) => r.length === 10), `${b.rows.length} motion rows went with it, at ${b.rowHz} a second from a sensor giving ${b.sampleHz}`)
    check(b.gyro.length > 3000, `${b.gyro.length} gyroscope rows went with it`)
    check(b.ms > 70000 && b.ms < 95000, `it lasted ${(b.ms / 1000).toFixed(1)} s`)
    for (const c of b.checks) console.log(`     read at ${(c.t / 1000).toFixed(1)} s: ${c.from} -> ${c.to} by ${c.by}; blind read ${c.perMin} a minute, tilt ${c.amplitudeDeg} degrees, moving ${c.moveDegS} degrees a second`)
    check(JSON.stringify(b.checks.map((c) => c.by)) === '["breath","breath","breath"]' && !('line' in b.checks[0]), 'the three checks went as numbers')
    console.log(`     sound sent as: ${b.sound}, pieces ${JSON.stringify(b.pieces.map((p) => `${p.made}@${p.t}`))}`)
    const list = await (await fetch(`${base}api/try`, { headers: { authorization: `Bearer ${worker}` } })).json()
    check(list.last?.[0]?.id === b.id && typeof list.last[0].rows === 'number', `the worker's list has it, without rows (count ${list.count})`)
    check((await fetch(`${base}api/try`)).status === 401, 'the list is closed to anyone else')
  }
  check(net.sessions === 0, 'nothing went to /api/ear/sessions: a try is not a practice')
  await ctx.close()
}

// ---- 2. 320 x 700, four times faster, a breath that keeps its own 14 a minute, then Done ----
{
  const { ctx, page, net } = await open(320, 700)
  await page.goto(`${base}#/try?speed=4`)
  await page.waitForSelector('[data-start]', { timeout: 20000 })
  await fits(page, 'start 320')
  await shot(page, '320-1-start')
  await chest(page, { own: 14 })
  await page.click('[data-start]')
  await page.waitForFunction(() => Number(document.querySelector('main.ty')?.getAttribute('data-checks')) >= 2, null, { timeout: 30000 }).catch(() => fail('320: the checks never came'))
  const got = await text(page, '.ty-read')
  check(got === 'Your breath did not follow. Staying at 10.', `a breath at 14 while the sea is at 10: "${got}"`)
  check(Number(await attr(page, 'data-pace')) === 10, 'the sea stays at 10')
  await fits(page, 'run 320')
  await shot(page, '320-2-run-did-not-follow')
  await page.click('[data-done]')
  await page.waitForSelector('main.ty[data-stage="result"]', { timeout: 5000 })
  const head = await text(page, '.ty-main h1')
  const lines = await page.locator('.ty-lines').evaluate((el) => ({ ...el.dataset, text: el.innerText.replace(/\s+/g, ' ') }))
  check(head === 'The sea stayed at 10 breaths a minute.' && lines.followed === '0' && lines.still === '0' && Number(lines.not) >= 2, `Done: "${head}" ${lines.text}`)
  await fits(page, 'result 320')
  await shot(page, '320-3-result-did-not-follow')
  await page.waitForTimeout(600)
  check(net.posts.some((p) => p.body.ended === 'done' && p.status === 200 && p.body.speed === 4), 'the try ended by Done was sent, marked as run at speed 4')
  await ctx.close()
}

// ---- 3. a phone lying still (no breath), fast: goes by stillness and says so ----
{
  const { ctx, page } = await open(320, 700, { reducedMotion: true })
  await page.goto(`${base}#/try?speed=4`)
  await page.waitForSelector('[data-start]', { timeout: 20000 })
  await chest(page, { swing: 0 })
  await page.click('[data-start]')
  await page.waitForFunction(() => Number(document.querySelector('main.ty')?.getAttribute('data-checks')) >= 1, null, { timeout: 30000 }).catch(() => fail('still phone: the check never came'))
  const got = await text(page, '.ty-read')
  check(got === 'No breath read. The phone was still, so slower anyway: 8.5 a minute.', `a still phone: "${got}"`)
  check(/The line is flat/.test(await text(page, '.ty-trace')), 'a still phone: the line is flat and the page says so')
  check((await page.locator('.ty-orb').evaluate((el) => getComputedStyle(el).transitionDuration)) === '0.01s', 'reduced motion: the circle changes in steps')
  await shot(page, '320-4-run-still-phone')
  await page.waitForSelector('main.ty[data-stage="result"]', { timeout: 40000 })
  const lines = await page.locator('.ty-lines').evaluate((el) => ({ ...el.dataset, text: el.innerText.replace(/\s+/g, ' ') }))
  check(lines.followed === '0' && Number(lines.still) >= 1 && !/following/.test(lines.text), `still phone result: ${lines.text}`)
  await fits(page, 'still result 320')
  await shot(page, '320-5-result-still-phone')
  await ctx.close()
}

// ---- 4. no motion events at all: a laptop, and the same state at both phone sizes ----
for (const [w, h] of [[1280, 800], [390, 844], [320, 700]]) {
  const { ctx, page, net } = await open(w, h)
  await page.goto(`${base}#/try`)
  await page.waitForSelector('[data-start]', { timeout: 20000 })
  const t = Date.now()
  await page.click('[data-start]')
  await page.waitForSelector('main.ty[data-stage="nophone"]', { timeout: 6000 }).catch(() => fail(`${w}: no "this needs a phone" state`))
  const all = await text(page, 'main.ty')
  check(/This needs a phone\./.test(all) && all.includes(`${base}#/try`) && (await page.locator('a[href="#/watch"]').count()) > 0, `${w}px without motion: "This needs a phone." with the address and the replay, ${((Date.now() - t) / 1000).toFixed(1)} s after the tap`)
  await fits(page, `no phone ${w}`)
  await shot(page, `${w}-6-needs-a-phone`)
  await page.waitForTimeout(400)
  if (w === 1280) check(net.posts.some((p) => p.body.ended === 'no-motion' && p.body.rows.length === 0), 'that is kept too, as a try with no motion')
  await ctx.close()
}

// ---- 5. an iPhone that says no ----
for (const [w, h] of [[390, 844], [320, 700]]) {
  const { ctx, page } = await open(w, h, { permission: 'denied' })
  await page.goto(`${base}#/try`)
  await page.waitForSelector('[data-start]', { timeout: 20000 })
  await chest(page)
  await page.click('[data-start]')
  await page.waitForSelector('main.ty[data-stage="refused"]', { timeout: 5000 }).catch(() => fail(`${w}: no refused state`))
  const all = await text(page, 'main.ty')
  check(/Reload the page, tap the button again and choose Allow/.test(all) && (await page.locator('a[href="#/watch"]').count()) > 0, `${w}px refused: says how to allow it and offers the replay`)
  await fits(page, `refused ${w}`)
  await shot(page, `${w}-7-refused`)
  await ctx.close()
}

await browser.close()
console.log(errors.length ? `\n${errors.length} FAILED` : '\nall passed')
process.exit(errors.length ? 1 : 0)
