#!/usr/bin/env node
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5892/').replace(/\/$/, '/')
const out = process.argv[3] ?? '/bulk2/runs/depression/hall-r4/e2e'
const video = process.argv[4] ?? '/bulk2/runs/depression/sense-fixtures/smile.mjpeg'
const audio = process.argv[5] ?? '/bulk2/runs/depression/sense-fixtures/talk.wav'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  `--use-file-for-fake-video-capture=${video}`, `--use-file-for-fake-audio-capture=${audio}`,
] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|GL Driver|odml/.test(m.text())) errors.push(m.text()) })
await page.goto(`${base}#/visit?${process.env.HALL_MOCK === '1' ? 'mock=1&' : ''}test=1`, { waitUntil: 'domcontentloaded' })
await page.screenshot({ path: `${out}/visit-intro-390.png`, fullPage: true })
await page.waitForSelector('.va-field input', { timeout: 30000 })
await page.fill('.va-field input', 'Hall test')
const started = Date.now()
await page.click('button[type=submit]')
const captureWhen = async (selector, name, timeout = 15000) => {
  const until = Date.now() + timeout
  while (Date.now() < until && Date.now() - started < 59000) {
    if (await page.locator(selector).count()) { await page.screenshot({ path: `${out}/${name}-390.png`, fullPage: true }); return true }
    await page.waitForTimeout(250)
  }
  return false
}
await captureWhen('.va-tune, .vt-flow', 'tune')
for (const [selector, name] of [['.va-stage[data-step="nod"]', 'nod'], ['.va-stage[data-step="laugh"]', 'laugh'], ['.va-stage[data-step="speak"]', 'speak'], ['.va-stage[data-step="breathe"]', 'breathe']]) await captureWhen(selector, name)
await page.waitForSelector('.va-echo', { timeout: 60000 })
const seconds = (Date.now() - started) / 1000
await page.screenshot({ path: `${out}/visit-result-390.png`, fullPage: true })
if (seconds >= 60) throw new Error(`hall visit took ${seconds.toFixed(1)} seconds`)
if (errors.length) throw new Error(`ERRORS ${JSON.stringify(errors.slice(0, 5))}`)
console.log(`HALL_SECONDS ${seconds.toFixed(1)}`)
await browser.close()
