#!/usr/bin/env node
// The day's minute, camera off (#/ears, "Today's minute, camera off"): after a teaching minute and its search,
// the same asks are done with the AirPods alone. The camera never comes on, the minute is sent as a daily one,
// no search starts, the model says what it heard, today is set against the usual, and the clinic's big screen
// comes back with that minute. Then one more teaching minute: its search learns from the two taught minutes only.
// The search is played by this script through the worker's endpoints; `bun scripts/fake-ears.ts 8893` must be
// running and the API must run with VIRE_WORKER_TOKEN=lead-test, as a test instance of its own.
//   node web/tests/e2e/daily.mjs <baseUrl> <outDir> [helper ws url] [api base]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5889/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/daily'
const helper = process.argv[4] ?? 'ws://127.0.0.1:8893'
const apiBase = (process.argv[5] ?? 'http://127.0.0.1:8879').replace(/\/$/, '')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--use-file-for-fake-video-capture=/bulk2/runs/depression/sense-fixtures/smile.mjpeg', '--use-file-for-fake-audio-capture=/bulk2/runs/depression/sense-fixtures/talk.wav',
] })
const errors = []
const fail = (why) => { console.log(`FAIL ${why}`); errors.push(why) }
const worker = { authorization: 'Bearer lead-test', 'content-type': 'application/json' }
const call = async (method, path, body) => {
  const res = await fetch(`${apiBase}/api/${path}`, { method, headers: worker, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 204) return null
  return res.json()
}
/** claim takes the oldest waiting job: fail any other one first, so the one that is finished here is ours */
const claimMine = async (id) => {
  for (let i = 0; i < 40; i++) {
    const job = await call('POST', 'ear/jobs/claim', {})
    if (!job) throw new Error(`job ${id} was never claimed`)
    if (job.id === id) return job
    await call('POST', `ear/jobs/${job.id}/done`, { error: 'cleared by the daily test' })
  }
  throw new Error('too many waiting jobs')
}
const det = (bias) => ({ family: 'logistic', window: 1, subset: 'attitude', mean: new Array(30).fill(0), scale: new Array(30).fill(1), w: new Array(30).fill(0), b: bias, threshold: 0.5, on: 0.6, off: 0.4, how: 'scripted' })
const score = (auc, ok, held) => ({ auc, chance: 0.58, windows: 600, times: 6, ok, held })
const found = (at, minutes) => ({ v: 2, at, by: 'sandbox', shell: 'mac', hz: 25, gyro: false, tried: 366, minutes, held: minutes > 1 ? 'minute' : 'round',
  events: { nod: { score: score(0.96, true, minutes > 1 ? 'minute' : 'round'), det: det(-3) }, smile: { score: score(0.62, false, 'round'), det: det(-3) } } })
const board = [{ name: 'boosted trees, 1 s, posture, 40 trees of depth 2', auc: 0.96, ms: 1400 }, { name: 'logistic, 1 s, attitude, pull 3', auc: 0.93, ms: 50 }]

const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|GL Driver|odml|404|ERR_NETWORK_CHANGED/.test(m.text())) errors.push(m.text()) })
await page.addInitScript((url) => { localStorage.setItem('vire.ears.url', url); localStorage.setItem('vire.ears.speed', '4') }, helper)
const sent = []
page.on('response', async (res) => {
  if (!/\/api\/ear\/recordings$/.test(res.url()) || res.request().method() !== 'POST') return
  try { sent.push({ body: JSON.parse(res.request().postData() ?? '{}'), answer: await res.json() }) } catch { /* the page went away */ }
})
const teach = async (again) => {
  const n = sent.length
  await page.click(again ? 'text=Do the minute again' : 'text=Start the minute')
  await page.waitForSelector("[data-learned]", { timeout: 150000 })
  for (let i = 0; i < 50 && sent.length === n; i++) await page.waitForTimeout(100)
  return sent[sent.length - 1]
}

await page.goto(`${base}#/ears`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.el h1', { timeout: 60000 })
if (await page.locator('[data-daily]').count()) fail('a device with no model must not offer the daily minute')
await page.click('text=Connect AirPods')
await page.waitForFunction(() => /samples a second/.test(document.querySelector('.el-live-line')?.textContent ?? ''), null, { timeout: 30000 })

// 1. a teaching minute, and its search comes back
const one = await teach(false)
if (!one?.answer?.jobId) fail('the teaching minute started no search')
if (one?.body?.recording?.kind) fail('a teaching minute was sent as a daily one')
await claimMine(one.answer.jobId)
await call('POST', `ear/jobs/${one.answer.jobId}/done`, { model: found(one.body.recording.at, 1), board })
await page.waitForSelector('[data-by="sandbox"]', { timeout: 20000 }).catch(() => fail('the search\'s model did not land'))

// 2. the day's minute: the camera stays off
await page.click('[data-daily]')
await page.waitForSelector('[data-camera="off"]', { timeout: 10000 }).catch(() => fail('the screen does not say the camera is off during the daily minute'))
await page.waitForTimeout(1500)
if (await page.locator('video.el-video[data-on="true"]').count()) fail('the camera picture is shown during the daily minute')
const tracks = await page.evaluate(() => (document.querySelector('video.el-video')?.srcObject?.getTracks?.() ?? []).filter((t) => t.readyState === 'live').length)
if (tracks) fail(`the camera or the microphone is running during the daily minute (${tracks} live tracks)`)
await page.screenshot({ path: `${out}/1-minute-camera-off.png` })
await page.waitForSelector('[data-today]', { timeout: 150000 })
for (let i = 0; i < 50 && sent.length < 2; i++) await page.waitForTimeout(100)
const day = sent[1]
if (day?.body?.recording?.kind !== 'daily') fail('the daily minute was not sent as a daily one')
if ((day?.body?.recording?.face?.length ?? 1) !== 0 || (day?.body?.recording?.voice?.length ?? 1) !== 0) fail('the daily minute carries camera frames or sound')
if ((day?.body?.recording?.head?.length ?? 0) < 100) fail('the daily minute has almost no AirPods samples')
if (!day?.answer?.daily || day?.answer?.jobId) fail('the server did not keep it as a daily minute, or started a search for it')
const todayText = (await page.locator('.el-main').innerText()).replace(/\n+/g, ' | ')
console.log(`TODAY ${todayText}`)
if (!/Today, from your AirPods alone/.test(todayText)) fail('the result does not say it is from the AirPods alone')
if (!/Today against your usual/.test(todayText)) fail('today against your usual is not shown after the daily minute')
if (!/Nod \| your model heard \d of the 3 asked for/.test(todayText)) fail('the screen does not say what the model heard')
if (/Smile \| your model heard/.test(todayText)) fail('a thing the model may not follow alone is listed as heard')
if (!/no camera frames/.test(todayText)) fail('the screen does not say there were no camera frames')
if ((await page.locator('[data-usual]').getAttribute('data-usual')) !== '2') fail('the usual does not count the teaching minute and the daily one')
await page.screenshot({ path: `${out}/2-today.png`, fullPage: true })

// 3. the newest search carries the daily minute, and the big screen comes back with it
const latest = await call('GET', 'ear/jobs/latest')
if (latest?.id !== one.answer.jobId || !latest?.dailyAt) fail('the newest search does not carry the daily minute')
if (latest?.days?.length !== 2) fail(`the search has ${latest?.days?.length} days, not the teaching minute and the daily one`)
if (latest?.minutes !== 1) fail('the search says it learned from the daily minute')
const big = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
big.on('pageerror', (e) => errors.push(String(e)))
await big.goto(`${base}#/clinic/live`, { waitUntil: 'domcontentloaded' })
await big.waitForSelector('.sg-search[data-daily="1"]', { timeout: 30000 }).catch(() => fail('the big screen did not come back for the daily minute'))
const bigText = (await big.locator('.sg-main').innerText().catch(() => '')).replace(/\n+/g, ' | ')
console.log(`BIG ${bigText.slice(0, 700)}`)
if (!/Today’s minute, from the AirPods alone/.test(bigText)) fail('the big screen does not say it is the day\'s minute')
if (!/Today against their usual/.test(bigText)) fail('the big screen does not show today against their usual')
if (!/Modal found on 1 minute/.test(bigText)) fail('the big screen does not say which model read it')
await big.screenshot({ path: `${out}/3-big-screen.png` })
await big.close()

// 4. one more teaching minute: its search learns from the two taught minutes, the usual has all three
await page.click('text=Back')
const two = await teach(false)
if (!two?.answer?.jobId) fail('the second teaching minute started no search')
const claimed = await claimMine(two.answer.jobId)
if (claimed.minutes.length !== 2 || claimed.minutes.some((m) => m.kind === 'daily')) fail(`the search was handed ${claimed.minutes.length} minutes, or a daily one among them`)
await call('POST', `ear/jobs/${two.answer.jobId}/done`, { model: found(two.body.recording.at, 2), board })
await page.waitForFunction(() => document.querySelector('[data-by="sandbox"]')?.getAttribute('data-learned') === '2', null, { timeout: 20000 }).catch(() => fail('the model from two minutes did not land'))
const after = (await page.locator('.el-main').innerText()).replace(/\n+/g, ' | ')
console.log(`AFTER ${after.slice(0, 500)}`)
if (!/Modal tried 366 models on 2 minutes/.test(after)) fail('the screen counts the daily minute as one the model learned from')
if ((await page.locator('[data-usual]').getAttribute('data-usual')) !== '3') fail('the usual after the next teaching minute does not hold all three minutes')
if ((await page.locator('[data-usual]').getAttribute('data-band')) !== '1') fail('the band is not shown with two earlier minutes')
const done = await call('GET', `ear/jobs/${two.answer.jobId}`)
if (done?.days?.length !== 3 || done?.minutes !== 2) fail(`the new search has ${done?.days?.length} days and ${done?.minutes} minutes learned from`)
await page.screenshot({ path: `${out}/4-next-teaching-minute.png`, fullPage: true })
await page.click('text=Back')
if (!/2 minutes of yours kept/.test(await page.locator('.el-main').innerText())) fail('the count of kept minutes includes the daily one')

await browser.close()
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'CLEAN')
process.exit(errors.length ? 1 : 0)
