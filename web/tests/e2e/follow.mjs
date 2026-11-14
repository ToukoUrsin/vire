#!/usr/bin/env node
// AirPods-only patient proof. The model is deliberately a demo model and is labelled as such by the app.
//   node web/tests/e2e/follow.mjs <baseUrl> <outDir>
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')

const base = (process.argv[2] ?? 'http://127.0.0.1:5883/').replace(/\/?$/, '/')
const out = (process.argv[3] ?? '/bulk2/runs/depression/ear/follow/').replace(/\/?$/, '/')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const errors = []
const model = {
  v: 2, at: new Date().toISOString(), by: 'device', shell: 'sim', hz: 25, gyro: true, tried: 1,
  events: Object.fromEntries(['smile', 'nod', 'shake', 'laugh', 'talk'].map((event) => [event, {
    score: { auc: 0.91, chance: 0.51, windows: 10, times: 5, ok: event !== 'shake' },
    det: { family: 'linear', window: 0.4, subset: 'all', mean: Array(117).fill(0), scale: Array(117).fill(1), w: Array(117).fill(0), b: 10, threshold: 0.5, on: 0.55, off: 0.45 },
  }])),
}

const make = async (width, height, tag) => {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 500 ? 2 : 1, hasTouch: width < 500, isMobile: width < 500 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e).slice(0, 220)}`))
  page.on('console', (m) => m.type() === 'error' && !/XNNPACK|GL Driver|odml|NETWORK_CHANGED/.test(m.text()) && errors.push(`${tag}: ${m.text().slice(0, 220)}`))
  await page.addInitScript(({ model }) => {
    localStorage.setItem('vire.user', JSON.stringify({ userId: 'follow-e2e', name: 'AirPods demo' }))
    localStorage.setItem('vire.ear.v2', JSON.stringify(model))
    const calls = []
    window.__mediaCalls = calls
    const md = navigator.mediaDevices
    if (md?.getUserMedia) {
      const old = md.getUserMedia.bind(md)
      md.getUserMedia = (constraints) => { calls.push(constraints); return old(constraints) }
    }
  }, { model })
  await page.goto(`${base}#/?mock=1&airpods=1`)
  await page.waitForSelector('.va-home', { timeout: 30000 })
  return { ctx, page, tag }
}

const screens = [await make(390, 844, '390'), await make(1440, 900, '1440')]
for (const { page } of screens) {
  await page.getByRole('button', { name: 'Follow' }).click()
  await page.waitForSelector('.va-follow', { timeout: 30000 })
  await page.waitForTimeout(1200)
}
let shot = 0
for (const { page, tag } of screens) await page.screenshot({ path: `${out}${String(++shot).padStart(2, '0')}-follow-${tag}.png`, fullPage: true })
for (const { page, tag } of screens) {
  const text = await page.locator('.va-follow').innerText()
  if (!/nods|head shakes|laughs|smiles|talking|head movement/.test(text)) errors.push(`${tag}: missing tally`)
  const calls = await page.evaluate(() => window.__mediaCalls ?? [])
  if (calls.some((x) => x && x.video && x.video !== false)) errors.push(`${tag}: camera requested`)
}
for (const { ctx } of screens) await ctx.close()
await browser.close()
console.log(`FOLLOW_ERRORS ${JSON.stringify([...new Set(errors)])}`)
