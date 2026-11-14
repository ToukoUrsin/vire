#!/usr/bin/env node
// The day's loop in the AirPods (#/today): check-in, practice, re-check, what was learned. Camera off the whole
// time. A stand-in streams the head (`bun scripts/fake-ears.ts 8893`) and this script plays the iPhone's heart
// samples through the same bridge the app uses, so nothing here is a result: it only shows the loop runs, what it
// sends, and what the screen says. The API must be a test instance of its own.
//   node web/tests/e2e/today.mjs <baseUrl> <outDir> [helper ws url] [api base]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5889/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/today'
const helper = process.argv[4] ?? 'ws://127.0.0.1:8893'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const errors = []
const fail = (why) => { console.log(`FAIL ${why}`); errors.push(why) }
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|GL Driver|odml|404|ERR_NETWORK_CHANGED/.test(m.text())) errors.push(m.text()) })
await page.addInitScript((url) => { localStorage.setItem('vire.ears.url', url); localStorage.setItem('vire.ears.speed', '8') }, helper)
const sent = { sessions: [], minutes: [] }
page.on('response', async (res) => {
  if (res.request().method() !== 'POST') return
  const which = /\/api\/ear\/sessions$/.test(res.url()) ? 'sessions' : /\/api\/ear\/recordings$/.test(res.url()) ? 'minutes' : null
  if (!which) return
  try { sent[which].push({ body: JSON.parse(res.request().postData() ?? '{}'), answer: await res.json() }) } catch { /* the page went away */ }
})
let media = 0
await page.exposeFunction('__media', () => { media++ })
await page.addInitScript(() => { const g = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices); if (g) navigator.mediaDevices.getUserMedia = (c) => { window.__media(); return g(c) } })

/** the iPhone's heart session, played: one sample every `everyMs`, going from `from` to `to` over the run */
const heart = (everyMs, from, to, forMs) => page.evaluate(({ everyMs, from, to, forMs }) => {
  const t0 = Date.now()
  window.__vireNative?.({ k: 'status', airpods: 'connected', hr: 'on', route: 'AirPods Pro (BluetoothA2DPOutput)' })
  clearInterval(window.__hr)
  window.__hr = setInterval(() => {
    const f = Math.min(1, (Date.now() - t0) / forMs)
    const bpm = Math.round((from + (to - from) * f) * 10) / 10
    window.__vireNative?.({ k: 'hr', t: Date.now(), bpm })
    window.__vireNative?.({ k: 'hrs', t: Date.now(), bpm, src: 'Anna’s AirPods Pro', model: 'AirPods Pro', n: 1 })
  }, everyMs)
}, { everyMs, from, to, forMs })

const one = async (kind, n) => {
  await page.waitForSelector('[data-start]:not([disabled])', { timeout: 30000 })
  if (kind) {
    const next = await page.locator('[data-next]').getAttribute('data-next')
    if (next !== kind) await page.click(`[data-pick="${kind}"]`)
    if ((await page.locator('[data-next]').getAttribute('data-next')) !== kind) fail(`could not pick ${kind}`)
  }
  const doing = await page.locator('[data-next]').getAttribute('data-next')
  await page.click('[data-start]')
  await heart(250, 74, 66, 34000)
  await page.waitForSelector('[data-camera="off"]', { timeout: 10000 }).catch(() => fail('the screen does not say the camera is off'))
  await page.waitForSelector('.td[data-stage="practice"]', { timeout: 60000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}/${n}-${doing}-practice.png` })
  const liveText = (await page.locator('.td-live').innerText()).replace(/\n+/g, ' | ')
  console.log(`LIVE ${doing}: ${liveText}`)
  if (!/Heart \| \d+ a minute, from your AirPods/.test(liveText)) fail('the heart rate is not shown live during the practice')
  await page.waitForSelector('.td[data-stage="done"]', { timeout: 120000 })
  for (let i = 0; i < 50 && sent.sessions.length < n; i++) await page.waitForTimeout(100)
  const text = (await page.locator('.td-main').innerText()).replace(/\n+/g, ' | ')
  console.log(`DONE ${doing}: ${text}`)
  await page.screenshot({ path: `${out}/${n}-${doing}-done.png`, fullPage: true })
  return { doing, text, got: sent.sessions[n - 1] }
}

await page.goto(`${base}#/today`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.td h1', { timeout: 60000 })
if ((await page.locator('[data-day]').getAttribute('data-day')) !== '1') fail('a new device does not start on day 1')
await page.click('text=Connect AirPods')
await page.waitForFunction(() => Number(document.querySelector('[data-air]')?.getAttribute('data-air')) >= 10, null, { timeout: 30000 })
await page.screenshot({ path: `${out}/0-idle.png`, fullPage: true })

// 1. the first day: slow breathing
const a = await one(null, 1)
if (a.doing !== 'breathe') fail(`the first practice is ${a.doing}, not slow breathing`)
const s = a.got?.body?.session
if (!s) fail('no session was sent')
else {
  const names = s.phases.map((p) => p.name).join(',')
  if (names !== 'checkin,before,session,after') fail(`the phases are ${names}`)
  if (s.head.length < 300) fail(`the session has ${s.head.length} AirPods samples`)
  if (s.pulse.length) fail('the session carries camera pulse rows')
  if (s.airHr.length < 20) fail(`the session has ${s.airHr.length} AirPods heart samples`)
  if (!s.heartSamples?.length) fail('the session has no heart samples with their source')
  if (s.breaths.length < 2) fail(`the sound asked for ${s.breaths.length} breaths`)
  if (!s.adapt?.length) fail('the pace was never checked')
  if (s.day !== 1) fail(`the session says day ${s.day}`)
  if (!s.sound?.length) fail('the session does not say which sound played')
  if (!s.sound.some((x) => x.made === 'set')) fail('no piece from the set made on Modal played')
  if (s.sound.some((x) => x.made === 'live')) fail('a piece is said to be made live, though this server has no Modal endpoint')
  if (s.device.route !== 'AirPods Pro (BluetoothA2DPOutput)') fail('the session does not carry where the sound went')
  console.log(`SESSION head ${s.head.length} hr ${s.airHr.length} breaths ${s.breaths.length} checks ${JSON.stringify(s.adapt)} own ${JSON.stringify(s.own)}`)
}
const r = a.got?.answer
if (!r?.id || r?.sessions?.length !== 1) fail('the server did not keep the session')
if (JSON.stringify(r ?? {}).includes('Anna')) fail('the server read the device name back')
if (!/Day 1 done/i.test(a.text)) fail('the result does not say day 1 is done')
if (!/Heart rate \| \d+(\.\d)? before, \d+(\.\d)? after/.test(a.text)) fail('the result does not give the heart rate before and after')
if (!/readings from your AirPods/.test(a.text)) fail('the result does not say the heart rate is from the AirPods')
if (!/Stillness \| your head moved/.test(a.text)) fail('the result does not give stillness before and after')
if (!/the sound led from \d+(\.\d)? to \d+(\.\d)? breaths a minute/.test(a.text)) fail('the result does not say where the sound led the pace')
if (!/Too early to say what helps you most/.test(a.text)) fail('after one practice the screen claims to have learned something')
if (!/Tomorrow: (the body scan|the walk) \(not tried yet\)/.test(a.text)) fail('tomorrow is not a practice that was not tried yet')
if (!/Today against your usual/.test(a.text)) fail('today against your usual is not shown')
if (!/How long: today the sound (was at 6 breaths a minute after|got down to)/.test(a.text)) fail('the result does not say how long it took to slow down')
if (!/Your next slow breathing runs \d+ (min|s)/.test(a.text)) fail('the result does not say how long the next breathing runs')
if (!/When: (morning|afternoon|evening|night)s .*\(1 practice\)\. Too few to say which time of day suits you/.test(a.text)) fail('after one practice the screen says, or does not count, the time of day')
if (typeof s?.tzMin !== 'number') fail('the session does not say what time of day it was for the person')
if (typeof r?.sessions?.[0]?.slowestAtS !== 'number' && r?.sessions?.[0]?.paceSlowest <= 6) fail('the kept practice does not say when the sound reached its slowest pace')
if (!/no camera frames/.test(a.text)) fail('the screen does not say there were no camera frames')
if (!/\d+ pieces? made on a Modal GPU, placed around you/.test(a.text)) fail('the screen does not say where the sound was made')
if (sent.minutes.length !== 1 || sent.minutes[0].body?.recording?.kind !== 'daily') fail('the check-in was not kept as the day\'s minute')
if (sent.minutes[0]?.answer?.jobId) fail('the check-in started a search')
if (media) fail(`the camera or the microphone was asked for ${media} times`)

// 2. the learner's pick comes next: the same day, so still day 1
await page.click('[data-done]')
if ((await page.locator('[data-day]').getAttribute('data-day')) !== '1') fail('a second practice on the same day moved the plan a day on')
const b = await one(null, 2)
if (b.doing === 'breathe') fail('the second practice is breathing again, though two were not tried yet')
// 3. and the walk: the stand-in does not walk, so the screen must say no steps were felt
await page.click('[data-done]')
const c = await one('walk', 3)
if (!/your AirPods felt no walking in this run/.test(c.text)) fail('a walk that did not happen is not said to be missing')
if (/it happened/.test(c.text)) fail('the screen says a walk happened')
const last = sent.sessions[sent.sessions.length - 1]?.answer
if (!/How long: your next slow breathing runs \d+ (min|s).*from your 1 breathing practice so far/.test(c.text)) fail('after a walk the screen does not say how long the next breathing runs')
const latest = await (await fetch(`${process.env.VIRE_API ?? 'http://127.0.0.1:8879'}/api/ear/sessions/latest`)).json()
if (latest?.id !== last?.id) fail('the clinic screen is not given the newest practice')
if (JSON.stringify(latest).includes('Anna') || 'head' in (latest?.read ?? {})) fail('the clinic screen is given a name or the rows')
if (!/not counted towards what helps you/.test(c.text)) fail('a walk that was not felt is counted towards what helps')
if (last?.learned?.kinds?.find((k) => k.kind === 'walk')?.n !== 0) fail('the learner scored a walk that was not felt')
if (last?.sessions?.length !== 3 || last?.learned?.total > 2) fail(`the server holds ${last?.sessions?.length} sessions`)
if (last?.learned?.said === 'learned') fail('three practices, one of each, and the learner says it has learned')
console.log(`LEARNED ${JSON.stringify(last?.learned)}`)
if (media) fail(`the camera or the microphone was asked for ${media} times`)

await browser.close()
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'CLEAN')
process.exit(errors.length ? 1 : 0)
