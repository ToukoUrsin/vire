#!/usr/bin/env node
// The teaching minute page (#/ears) when the wider search comes back: the search's model lands on the device by
// itself, the screen says which path made the model, and it is still there after the page is opened again.
// The search itself is played by this script (its answers to the page are scripted); `bun scripts/fake-ears.ts 8893`
// must be running. The real search is tested by sandbox/search.py and the worker against a server.
//   node web/tests/e2e/ears-modal.mjs <baseUrl> <outDir> [helper ws url]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5889/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/ears-modal'
const helper = process.argv[4] ?? 'ws://127.0.0.1:8893'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--use-file-for-fake-video-capture=/bulk2/runs/depression/sense-fixtures/smile.mjpeg', '--use-file-for-fake-audio-capture=/bulk2/runs/depression/sense-fixtures/talk.wav',
] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
const fail = (why) => { console.log(`FAIL ${why}`); errors.push(why) }
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|GL Driver|odml|404/.test(m.text())) errors.push(m.text()) })
await page.addInitScript((url) => { localStorage.setItem('vire.ears.url', url); localStorage.setItem('vire.ears.speed', '4') }, helper)

// what the search will say it found: one row that passed (nod) and one that did not (smile)
let at = ''
let minutes = 1
const det = (bias) => ({ family: 'logistic', window: 1, subset: 'attitude', mean: new Array(30).fill(0), scale: new Array(30).fill(1), w: new Array(30).fill(0), b: bias, threshold: 0.5, on: 0.6, off: 0.4, how: 'scripted' })
const score = (auc, ok) => ({ auc, chance: 0.58, windows: 600, times: 6, ok, held: 'round' })
const found = () => ({ v: 2, at, by: 'sandbox', shell: 'mac', hz: 25, gyro: false, tried: 366, minutes, held: 'round',
  events: { nod: { score: score(0.96, true), det: det(-3) }, smile: { score: score(0.62, false), det: det(-3) } },
  curve: [{ minutes: 1, auc: { nod: 0.9, smile: 0.6 } }, { minutes: 2, auc: { nod: 0.95, smile: 0.65 } }] })
const board = [{ name: 'boosted trees, 1 s, posture, 40 trees of depth 2', auc: 0.96, ms: 1400 }, { name: 'logistic, 1 s, attitude, pull 3', auc: 0.93, ms: 50 }]
let asked = 0
let landed = 0
let mine = null
await page.route('**/api/ear/recordings', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}')
  at = body.recording?.at ?? ''
  if (!/^[a-f0-9]{32,64}$/.test(body.key ?? '')) fail('the minute was sent without the device\'s key')
  await route.fulfill({ json: { id: 'test-minute', at, userId: null, shell: 'mac', seconds: 16, headRows: body.recording?.head?.length ?? 0, hz: 25, jobId: 'ej_test' } })
})
await page.route('**/api/ear/mine', (route) => route.fulfill({ json: { minutes: [] } }))
await page.route('**/api/ear/mine/job', (route) => (mine ? route.fulfill({ json: mine }) : route.fulfill({ status: 404, json: { error: 'no search yet' } })))
await page.route('**/api/ear/jobs/ej_test/landed', (route) => { landed++; return route.fulfill({ json: { id: 'ej_test', landedAt: Date.now() } }) })
await page.route('**/api/ear/jobs/ej_test', (route) => {
  asked++
  const job = asked <= 2 ? { state: 'queued', board: [], tried: 0, seconds: 0, model: null }
    : asked <= 5 ? { state: 'running', board, tried: 60 * (asked - 2), seconds: asked, model: null }
    : { state: 'done', board, tried: 366, seconds: 31, model: found() }
  return route.fulfill({ json: { id: 'ej_test', minutes, at: Date.now(), ...job } })
})

await page.goto(`${base}#/ears`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.el h1', { timeout: 60000 })
if (await page.locator('[data-model]').count()) fail('a new device should not say it has a model')
await page.click('text=Connect AirPods')
await page.waitForFunction(() => /samples a second/.test(document.querySelector('.el-live-line')?.textContent ?? ''), null, { timeout: 30000 })
await page.click('text=Start the minute')
await page.waitForSelector('[data-learned]', { timeout: 150000 })
// the device's own answer is on screen first, and the search is said to be on its way
await page.waitForSelector('[data-search]', { timeout: 10000 }).catch(() => fail('the screen never said the wider search is on its way'))
const waiting = (await page.locator('.el-main').innerText()).replace(/\n+/g, ' | ')
console.log(`WAITING ${waiting}`)
if (!/Modal/.test(await page.locator('[data-search]').innerText().catch(() => ''))) fail('the line about the search does not name Modal')
await page.screenshot({ path: `${out}/1-searching.png`, fullPage: true })
await page.waitForSelector('[data-search="running"]', { timeout: 10000 }).catch(() => fail('the running search was not shown'))
if (!/\d+ so far/.test(await page.locator('[data-search]').innerText().catch(() => ''))) fail('the running search does not count what it tried')
// the model lands by itself
await page.waitForSelector('[data-by="sandbox"]', { timeout: 20000 }).catch(() => fail('the search\'s model did not land'))
const after = (await page.locator('.el-main').innerText()).replace(/\n+/g, ' | ')
console.log(`LANDED ${after}`)
if (!/Modal tried 366 models on 1 minute, held-out score 0\.79\./.test(after)) fail('the screen does not say "Modal tried N models on M minutes, held-out score X"')
if (await page.locator('[data-search]').count()) fail('the line about the running search stayed after the model landed')
if ((await page.locator('.el-curve li').count()) !== 2) fail('the score for each number of minutes is not shown')
if (!/Nod \| right 10 times in 10/.test(after)) fail('the row the search passed is not shown as checked')
await page.screenshot({ path: `${out}/2-landed.png`, fullPage: true })
await page.waitForTimeout(500)
if (landed !== 1) fail(`the server was told the model landed ${landed} times, not once`)
const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('vire.ear.v3') ?? 'null'))
if (kept?.by !== 'sandbox' || kept?.tried !== 366) fail('the search\'s model was not kept on the device')

// the page opened again: the model is here, the screen still says which path made it, and it can be followed at once
mine = { id: 'ej_test', state: 'done', board, tried: 366, seconds: 31, minutes, at: Date.now(), landedAt: Date.now(), model: found() }
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-model="sandbox"]', { timeout: 30000 }).catch(() => fail('after opening the page again the model is not named'))
const again = (await page.locator('[data-model]').innerText().catch(() => '')).replace(/\n+/g, ' ')
console.log(`AGAIN ${again}`)
if (!/Modal tried 366 models on 1 minute, held-out score/.test(again)) fail('after opening the page again the path that made the model is not said')
await page.screenshot({ path: `${out}/3-again.png`, fullPage: true })
await page.waitForFunction(() => /samples a second/.test(document.querySelector('.el-live-line')?.textContent ?? ''), null, { timeout: 30000 })
await page.click('text=Camera off. Follow me')
await page.waitForSelector('.el-now', { timeout: 10000 })
await page.waitForTimeout(4000)
console.log(`FOLLOW ${(await page.locator('.el-now').innerText()).replace(/\n+/g, ' | ')}`)
await page.screenshot({ path: `${out}/4-follow.png`, fullPage: true })
await page.click('text=Back to the numbers')
await page.waitForSelector('text=Teach your AirPods.', { timeout: 10000 }).catch(() => fail('leaving the follow view did not go back to the start'))
if (landed !== 1) fail('the model was reported as landed again')
await browser.close()
console.log(`EARS_MODAL_ERRORS ${JSON.stringify(errors.slice(0, 6))}`)
if (errors.length) process.exit(1)
