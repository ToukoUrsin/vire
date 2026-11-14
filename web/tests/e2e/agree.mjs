#!/usr/bin/env node
// Phone and big-screen mirror agreement proof.
//   node web/tests/e2e/agree.mjs <baseUrl> <outDir> [video] [audio]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')

const base = (process.argv[2] ?? 'http://127.0.0.1:8881/').replace(/\/?$/, '/')
const out = (process.argv[3] ?? '/bulk2/runs/depression/mirror-r4/').replace(/\/?$/, '/')
const FIX = '/bulk2/runs/depression/sense-fixtures/'
const video = process.argv[4] ? FIX + process.argv[4] : null
const audio = process.argv[5] ? FIX + process.argv[5] : null
mkdirSync(out, { recursive: true })
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
if (video) args.push(`--use-file-for-fake-video-capture=${video}`)
if (audio) args.push(`--use-file-for-fake-audio-capture=${audio}`)
const browser = await chromium.launch({ args })
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const phone = await phoneCtx.newPage()
const mirror = await deskCtx.newPage()
const errors = []
for (const [page, tag] of [[phone, 'phone'], [mirror, 'mirror']]) {
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e).slice(0, 180)}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|GL Driver|odml|NETWORK_CHANGED/.test(m.text())) errors.push(`${tag}: ${m.text().slice(0, 180)}`) })
}
let shotNo = 0
const shot = async (name) => { await mirror.screenshot({ path: `${out}${String(++shotNo).padStart(2, '0')}-${name}.png` }) }
const checks = []
const check = (name, ok, detail = '') => { checks.push(`${ok ? 'OK' : 'ERR'} ${name}${detail ? ` ${detail}` : ''}`); if (!ok) errors.push(`${name}${detail ? ` ${detail}` : ''}`) }

await mirror.goto(base + '#/clinic/live')
await phone.goto(base + '#/')
await phone.waitForSelector('.va-field input', { timeout: 30000 })
await phone.fill('.va-field input', 'Agree test')
await phone.click('button[type=submit]')
await phone.waitForTimeout(1000)
const skip = phone.locator('.vt-skip, .va-tune-skip').first()
if (await skip.count()) {
  await skip.waitFor({ state: 'visible', timeout: 15000 })
  await skip.click({ force: true })
}

for (const step of ['settle', 'nod', 'laugh', 'speak', 'breathe']) {
  await phone.bringToFront()
  await phone.waitForSelector(`.va-stage[data-step="${step}"]`, { timeout: 60000 })
  await mirror.waitForSelector(`.sg[data-phase="${step}"]`, { timeout: 15000 }).catch(() => null)
  await phone.waitForTimeout(650)
  await shot(`step-${step}`)
  const state = await mirror.evaluate(() => ({ text: document.body.innerText, html: document.body.innerHTML }))
  check(`${step} has no placeholder`, !/[••··]/.test(state.text))
  check(`${step} has a waiting word or answer`, /reading|finding the pulse|listening|waiting|not read|resting pulse|degrees a second|semitones|beats a minute|after the laugh/i.test(state.text))
}

await phone.waitForSelector('.va-echo', { timeout: 90000 })
await mirror.waitForSelector('.sg[data-mode="echo"]', { timeout: 15000 }).catch(() => null)
await phone.waitForTimeout(1800)
await shot('echo')
const readValues = async (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-echo-value][data-ch]')].map((e) => [e.getAttribute('data-ch'), e.getAttribute('data-echo-value')])))
const phoneValues = await readValues(phone)
const mirrorValues = await readValues(mirror)
for (const [ch, value] of Object.entries(phoneValues)) check(`echo ${ch} agrees`, mirrorValues[ch] === value, `phone=${value} mirror=${mirrorValues[ch]}`)
check('no placeholder on echo', !/[••··]/.test(await mirror.locator('body').innerText()))
for (const [ch, value] of Object.entries(phoneValues)) {
  if (value === 'null') check(`${ch} not read has no number`, !(await mirror.locator(`[data-ch="${ch}"]`).allTextContents()).some((x) => /\d/.test(x)))
}
check('echo tiles exist on both screens', Object.keys(phoneValues).length > 0 && Object.keys(mirrorValues).length > 0)
console.log(checks.join('\n'))
console.log(`AGREE_ERRORS ${JSON.stringify(errors)}`)
await browser.close()
