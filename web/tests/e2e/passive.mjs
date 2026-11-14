#!/usr/bin/env node
// /#/day with the stand-in AirPods: the minutes add up on the card, they are sent under the device's key and
// kept apart as a stand-in's (never a person's usual), they come back after a reload, and after 50 minutes worn
// with no walk a walk is offered once. The minute is shortened to 3 s through localStorage['vire.passive.speed'].
// Needs, each on its own port:
//   bun scripts/fake-ears.ts 8897
//   cd server && PORT=8885 VIRE_DB=/tmp/vire-passive.sqlite VIRE_EAR_DIR=/tmp/vire-passive-ear/ VIRE_LLM=off VIRE_RATE=off VIRE_WORKER_TOKEN=passive-test bun index.ts
//   cd web && VIRE_API=http://127.0.0.1:8885 bunx vite --config vite.isolated.config.ts --port 5895 --strictPort
//   node web/tests/e2e/passive.mjs [baseUrl] [outDir] [helper ws url] [api base]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { webkit } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5895/').replace(/\/?$/, '/')
const out = (process.argv[3] ?? '/bulk3/runs/depression/passive/').replace(/\/?$/, '/')
const helper = process.argv[4] ?? 'ws://127.0.0.1:8897'
const apiBase = (process.argv[5] ?? 'http://127.0.0.1:8885').replace(/\/$/, '')
const SPEED = 20
const MINUTE_MS = 60_000 / SPEED
mkdirSync(out, { recursive: true })

const errors = []
const fail = (why) => { console.log(`FAIL ${why}`); errors.push(why) }
const ok = (what) => console.log(`ok   ${what}`)
const browser = await webkit.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)))
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_NETWORK_CHANGED|404/.test(m.text())) errors.push(m.text().slice(0, 240)) })
await page.addInitScript(({ url, speed }) => {
  localStorage.setItem('vire.ears.url', url)
  localStorage.setItem('vire.passive.speed', String(speed))
}, { url: helper, speed: SPEED })
const wornMin = async () => Number((await page.getAttribute('.pd', 'data-worn-min')) ?? 0)

await page.goto(`${base}#/day`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.pd', { timeout: 60000 })
if (await page.locator('[data-sim]').count()) ok('the card says the stand-in is not a person')
else fail('the card does not say these are stand-in AirPods')
if (/Only today so far/.test(await page.textContent('.pd-usual'))) ok('with only today the card says so')
else fail('the card does not say there is only today')
await page.click('text=Connect AirPods')
await page.waitForSelector('[data-live-worn="true"]', { timeout: 30000 }).then(() => ok('live: the AirPods are sending')).catch(() => fail('the AirPods never showed as sending'))

// the minutes add up
await page.waitForFunction(() => Number(document.querySelector('.pd')?.getAttribute('data-worn-min') ?? 0) >= 3, null, { timeout: 8 * MINUTE_MS })
const first = await wornMin()
await page.waitForTimeout(3 * MINUTE_MS)
const later = await wornMin()
if (later >= first + 2) ok(`minutes add up: ${first} then ${later}`)
else fail(`minutes did not add up: ${first} then ${later}`)
await page.screenshot({ path: `${out}day-390.png`, fullPage: true })
const wide = await page.evaluate(() => document.documentElement.scrollWidth)
if (wide <= 390) ok('no sideways scroll at 390 px')
else fail(`the page is ${wide} px wide at 390`)

// sent under the device's key, and kept as a stand-in's
const key = await page.evaluate(() => localStorage.getItem('vire.ear.key'))
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
await page.waitForTimeout(MINUTE_MS)
const mine = await (await fetch(`${apiBase}/api/ear/passive/mine?today=${today}`, { headers: { authorization: `Bearer ${key}` } })).json()
const simDay = mine.days?.find((d) => d.sim && d.day === today)
if (simDay && simDay.wornMin >= first) ok(`the server has ${simDay.wornMin} stand-in minutes for this device`)
else fail(`the server does not have the minutes: ${JSON.stringify(mine).slice(0, 300)}`)
if (!mine.days?.some((d) => !d.sim) && mine.usual?.days === 0) ok('nothing of the stand-in in a person\'s days or usual')
else fail('stand-in minutes leaked into a person\'s days or usual')
const list = await (await fetch(`${apiBase}/api/ear/passive`, { headers: { authorization: 'Bearer passive-test' } })).json()
if (Array.isArray(list) && list.some((r) => r.sim > 0) && !JSON.stringify(list).includes(key)) ok('the worker list has it, without the key')
else fail(`worker list: ${JSON.stringify(list).slice(0, 200)}`)
if ((await fetch(`${apiBase}/api/ear/passive`)).status === 401) ok('the list needs the worker token')
else fail('the list is open without the token')

// a reload keeps the day
const before = await wornMin()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.pd', { timeout: 30000 })
await page.waitForFunction((n) => Number(document.querySelector('.pd')?.getAttribute('data-worn-min') ?? 0) >= n, before, { timeout: 10000 })
  .then(() => ok('after a reload the day is still there'))
  .catch(async () => fail(`after a reload the card shows ${await wornMin()} minutes, before ${before}`))

// 50 minutes worn and no walk: a walk is offered, once
await page.waitForSelector('[data-offer]', { timeout: 60 * MINUTE_MS }).catch(() => {})
const kind = await page.getAttribute('[data-offer]', 'data-offer').catch(() => null)
if (kind === 'walk') {
  ok(`a walk is offered: "${await page.textContent('.pd-why')}"`)
  await page.screenshot({ path: `${out}day-offer-390.png`, fullPage: true })
  await page.click('text=Not now')
  await page.waitForTimeout(3 * MINUTE_MS)
  if (await page.locator('[data-offer]').count()) fail('the offer came back right after Not now')
  else ok('Not now puts it away, and it does not come back at once')
} else fail(`no walk offered after ${await wornMin()} minutes (got ${kind})`)

await browser.close()
if (errors.length) {
  console.log(`\n${errors.length} problem(s):\n${errors.join('\n')}`)
  process.exit(1)
}
console.log(`\nall good. Screens in ${out}`)
