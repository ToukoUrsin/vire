#!/usr/bin/env node
// The teaching minute page (#/ears) against a stand-in for the Mac helper: `bun scripts/fake-ears.ts 8893` must be running.
//   node web/tests/e2e/ears-lab.mjs <baseUrl> <outDir> [helper ws url]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5889/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/lead-r5/ears-lab'
const helper = process.argv[4] ?? 'ws://127.0.0.1:8893'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--use-file-for-fake-video-capture=/bulk2/runs/depression/sense-fixtures/smile.mjpeg', '--use-file-for-fake-audio-capture=/bulk2/runs/depression/sense-fixtures/talk.wav',
] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|GL Driver|odml/.test(m.text())) errors.push(m.text()) })
await page.addInitScript((url) => { localStorage.setItem('vire.ears.url', url); localStorage.setItem('vire.ears.speed', '2') }, helper)
await page.goto(`${base}#/ears`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.el h1', { timeout: 60000 })
await page.screenshot({ path: `${out}/1-idle.png` })
await page.click('text=Connect AirPods')
await page.waitForFunction(() => /samples a second/.test(document.querySelector('.el-live-line')?.textContent ?? ''), null, { timeout: 30000 })
await page.screenshot({ path: `${out}/2-connected.png` })
await page.click('text=Start the minute')
await page.waitForSelector('.el-say', { timeout: 60000 })
await page.waitForTimeout(9000)
await page.screenshot({ path: `${out}/3-minute.png` })
try {
  await page.waitForSelector('.el-rows', { timeout: 150000 })
} catch (e) {
  await page.screenshot({ path: `${out}/4-stuck.png` })
  console.log(`STUCK ${(await page.locator('.el-main').innerText()).replace(/\n+/g, ' | ')}`)
  console.log(`EARS_ERRORS ${JSON.stringify(errors.slice(0, 8))}`)
  await browser.close()
  process.exit(1)
}
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/4-result.png` })
console.log((await page.locator('.el-main').innerText()).replace(/\n+/g, ' | '))
const fail = (why) => { console.log(`FAIL ${why}`); errors.push(why) }
if ((await page.getAttribute('[data-learned]', 'data-learned')) !== '1') fail('the first minute should say it learned from 1 minute')

// the minute again: the model learns from both, and is checked on a whole minute it never saw
await page.click('button:has-text("Do the minute again")')
await page.waitForSelector('.el-say', { timeout: 60000 })
await page.waitForSelector('[data-learned="2"]', { timeout: 150000 }).catch(() => fail('the second minute did not end in a model learned from 2 minutes'))
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/4b-second.png` })
const second = (await page.locator('.el-main').innerText()).replace(/\n+/g, ' | ')
console.log(`SECOND ${second}`)
// the stand-in's head and the test camera have nothing to do with each other, so often nothing can be taught;
// what is checked here is that both minutes were used, and how a row is worded when there is one
if (!/Learned from 2 minutes|2 minutes kept/.test(second)) fail('the screen does not say it used 2 minutes')
if (/never saw/.test(second) && !/on a whole minute it never saw/.test(second)) fail('with two minutes a row must be checked on a whole minute')
if (/Learned from/.test(second) && !/tried \d+ small models? itself/.test(second)) fail('the screen does not say which path made the model')

// a cleared page: the minutes on the device are gone, the device's key is not, and the server gives them back
await page.evaluate(() => new Promise((done) => { const r = indexedDB.deleteDatabase('vire-ear'); r.onsuccess = r.onerror = r.onblocked = () => done(null) }))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-kept="2"]', { timeout: 30000 }).catch(() => fail('the two minutes did not come back from the server'))
console.log(`KEPT ${(await page.locator('[data-kept]').innerText().catch(() => 'none')).replace(/\n+/g, ' ')}`)
await page.screenshot({ path: `${out}/1b-kept.png` })
// someone else at the table: nothing of the last person's is used
await page.click('text=Someone else? Start fresh')
await page.waitForFunction(() => !document.querySelector('[data-kept]'), null, { timeout: 10000 }).catch(() => fail('start fresh left minutes behind'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.el h1', { timeout: 60000 })
await page.waitForTimeout(2500)
if (await page.locator('[data-kept]').count()) fail('minutes came back after starting fresh')

// one more minute as the new person: a model from this one minute only
await page.waitForFunction(() => /samples a second/.test(document.querySelector('.el-live-line')?.textContent ?? ''), null, { timeout: 30000 })
await page.click('text=Start the minute')
await page.waitForSelector('.el-rows', { timeout: 200000 })
if ((await page.getAttribute('[data-learned]', 'data-learned')) !== '1') fail('after starting fresh the model should learn from 1 minute')
if (await page.locator('[data-again]').count()) fail('after starting fresh no earlier model should be asked')
await page.click('text=Camera off. Follow me')
await page.waitForSelector('.el-now', { timeout: 10000 })
await page.waitForTimeout(6000)
await page.screenshot({ path: `${out}/6-follow.png` })
console.log(`FOLLOW ${(await page.locator('.el-now').innerText()).replace(/\n+/g, ' | ')}`)
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: `${out}/7-follow-390.png`, fullPage: true })
await page.click('text=Back to the numbers')
await page.waitForSelector('.el-rows')
await page.screenshot({ path: `${out}/5-result-390.png`, fullPage: true })
await browser.close()
console.log(`EARS_ERRORS ${JSON.stringify(errors.slice(0, 5))}`)
if (errors.length) process.exit(1)
