#!/usr/bin/env node
// Whole product in one run: a phone does a real-sensing ping (fake camera + mic files) while a clinic screen
// mirrors it live; then the dose, the mini ping, and the clinic list and patient page for that person.
//   node tests/e2e/full-loop.mjs [baseUrl] [outDir] [video] [audio]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:8871/').replace(/\/?$/, '/')
const out = (process.argv[3] ?? '/bulk2/runs/depression/lead-shots/e2e').replace(/\/?$/, '/')
const FIX = '/bulk2/runs/depression/sense-fixtures/'
const video = FIX + (process.argv[4] ?? 'swing66.y4m')
const audio = FIX + (process.argv[5] ?? 'talk.wav')
mkdirSync(out, { recursive: true })
const b = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    `--use-file-for-fake-video-capture=${video}`, `--use-file-for-fake-audio-capture=${audio}`],
})
const errors = []
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|GL Driver|odml\.pa\.googleapis\.com|NETWORK_CHANGED/.test(m.text())) errors.push(`${tag}: ${m.text().slice(0, 240)}`) })
  page.on('pageerror', (e) => errors.push(`${tag} PAGEERROR: ${String(e).slice(0, 240)}`))
  page.on('requestfailed', (r) => { if (!r.url().includes('odml.pa.googleapis.com') && !/NETWORK_CHANGED/.test(r.failure()?.errorText ?? '')) errors.push(`${tag} FAILED ${r.url().slice(-80)} ${r.failure()?.errorText}`) })
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('odml.pa.googleapis.com')) errors.push(`${tag} HTTP ${r.status()} ${r.url().slice(-80)}`) })
}
const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const deskCtx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const phone = await phoneCtx.newPage(); watch(phone, 'phone')
const mirror = await deskCtx.newPage(); watch(mirror, 'mirror')
let n = 0
const shot = async (page, name) => { n++; await page.screenshot({ path: `${out}${String(n).padStart(2, '0')}-${name}.png` }) }

await mirror.goto(base + '#/clinic/live')
await phone.goto(base + (process.env.TUNE === '1' ? '#/?mock=1' : '#/'))
await phone.waitForSelector('.va-field input', { timeout: 30000 })
const typedAt = Date.now()
await phone.fill('.va-field input', 'Touko')
await phone.click('button[type=submit]')
// the Tune step (five faces) sits between the name and the first ping; web/tests/tune covers it with posed clips.
// This run uses a clip of one resting face, so it skips Tune unless TUNE=1.
if (process.env.TUNE !== '1') {
  const skip = await phone.waitForSelector('.vt-skip', { timeout: 60000 }).catch(() => null)
  if (skip) await skip.click()
}
for (const [step, wait] of [['settle', 4000], ['nod', 2500], ['laugh', 6000], ['speak', 7000], ['breathe', 9000]]) {
  await phone.waitForSelector(`.va-stage[data-step="${step}"]`, { timeout: 60000 })
  await phone.waitForTimeout(wait)
  await shot(phone, `phone-${step}`); await shot(mirror, `mirror-${step}`)
}
await phone.waitForSelector('.va-echo', { timeout: 60000 })
console.log(`time-to-first-echo ${process.env.TUNE === '1' ? 'Tune' : 'Later'}: ${((Date.now() - typedAt) / 1000).toFixed(1)}s`)
await phone.waitForTimeout(2500)
await shot(phone, 'phone-echo'); await shot(mirror, 'mirror-echo')
if (await phone.locator('.va-check-offer').count()) {
  await phone.click('.va-check-offer .va-btn-primary')
  await phone.waitForSelector('.va-check-screen')
  await phone.getByRole('button', { name: 'Not at all' }).click()
  await phone.getByRole('button', { name: 'Several days' }).click()
  await phone.waitForSelector('.va-echo')
  const checkUser = JSON.parse(await phone.evaluate(() => localStorage.getItem('vire.user')))
  const checks = await (await fetch(`${base}api/users/${checkUser.userId}/checks`)).json()
  if (!checks.length || checks.at(-1).items.join(',') !== '0,1') throw new Error(`PHQ-2 was not stored: ${JSON.stringify(checks)}`)
  console.log('PHQ2_ASSERTION', JSON.stringify(checks.at(-1)))
}
const user = JSON.parse(await phone.evaluate(() => localStorage.getItem('vire.user')))
console.log('user', user.userId)
const echoes = await (await fetch(`${base}api/users/${user.userId}/echoes`)).json()
console.log('echo', JSON.stringify(echoes.at(-1)).slice(0, 900))
// One source-of-truth assertion: the phone, mirror and clinic API expose the same channel values for this ping.
const phoneEcho = await phone.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-echo-value]')].map((e) => [e.getAttribute('data-ch'), e.getAttribute('data-echo-value')])))
const mirrorEcho = await mirror.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-echo-value][data-ch]')].map((e) => [e.getAttribute('data-ch'), e.getAttribute('data-echo-value')])))
const detailNow = await (await fetch(`${base}api/clinic/patients/${user.userId}`)).json()
const clinicEcho = Object.fromEntries((detailNow.timeline.at(-1)?.components ?? []).map((c) => [c.channel, c.value == null ? 'null' : String(c.value)]))
for (const ch of Object.keys(phoneEcho)) {
  if (!(ch in mirrorEcho) || phoneEcho[ch] !== clinicEcho[ch] || mirrorEcho[ch] !== clinicEcho[ch]) throw new Error(`echo disagreement for ${ch}: phone=${phoneEcho[ch]} mirror=${mirrorEcho[ch]} clinic=${clinicEcho[ch]}`)
}
console.log('ECHO_ASSERTION', JSON.stringify({ phone: phoneEcho, mirror: mirrorEcho, clinic: clinicEcho }))

// Round-2 proof probes: the real browser loop above plus the same public API a
// phone uses for calibration, clinic codes, guests and the no-dose arm.
const postJson = async (path, body) => (await fetch(`${base}api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
const probeFeatures = { smile: { latencyMs: 500, peak: 0.4, auc: 1.8, duchenne: 0.2, durationMs: 1000, baseline: 0.1 }, voice: { speechFraction: 0.5, pauseCount: 1, meanPauseMs: 300, f0MedianHz: 180, f0SdSemitones: 2, loudnessSdDb: 2, syllableRateHz: 3 }, heart: { restBpm: 65, swingBpm: 8, quality: 0.8, source: 'camera' }, move: { nodAmplitudeDeg: 8, nodPeakVelDegS: 55, nodCount: 1, restlessness: 0, source: 'camera' } }
// The skip path is a second phone run for a fresh person: skip once, then
// make another same-day echo and prove the offer stays away and no check was stored.
const skipUser = await postJson('users', { name: 'e2e skip' })
const skipPing = await postJson('pings', { userId: skipUser.userId, kind: 'full', setting: 'home', startedAt: new Date().toISOString(), features: probeFeatures, device: { ua: 'e2e-skip', native: false, airpodsMotion: false, airpodsHr: false } })
const skipPhone = await phoneCtx.newPage(); watch(skipPhone, 'skip')
const skipDay = (() => { const d = new Date(skipPing.at); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` })()
await skipPhone.addInitScript(({ user, echo, day }) => {
  localStorage.setItem('vire.user', JSON.stringify({ userId: user.userId, name: user.name }))
  localStorage.setItem('vire.today', JSON.stringify({ day, echo }))
  if (!localStorage.getItem('vire.e2e.skip.init')) {
    localStorage.removeItem('vire.phq2.last')
    localStorage.setItem('vire.e2e.skip.init', '1')
  }
}, { user: skipUser, echo: skipPing, day: skipDay })
await skipPhone.goto(base + '#/')
const waitSkipHome = async () => {
  if (await skipPhone.waitForSelector('.va-home', { timeout: 60000 }).catch(() => null)) return
  await skipPhone.reload()
  await skipPhone.waitForSelector('.va-home', { timeout: 60000 })
}
await waitSkipHome()
await skipPhone.locator('.va-today').click()
await skipPhone.waitForSelector('.va-check-offer')
await skipPhone.click('.va-check-offer .va-link')
await skipPhone.waitForSelector('.va-echo')
const skippedChecks = await (await fetch(`${base}api/users/${skipUser.userId}/checks`)).json()
if (skippedChecks.length) throw new Error(`PHQ-2 skip stored a check: ${JSON.stringify(skippedChecks)}`)
const skipNext = await postJson('pings', { userId: skipUser.userId, kind: 'full', setting: 'home', startedAt: new Date(Date.now() + 1000).toISOString(), features: probeFeatures, device: { ua: 'e2e-skip', native: false, airpodsMotion: false, airpodsHr: false } })
await skipPhone.evaluate((echo) => { const d = new Date(echo.at); const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; localStorage.setItem('vire.today', JSON.stringify({ day, echo })) }, skipNext)
await skipPhone.reload()
await waitSkipHome()
await skipPhone.locator('.va-today').click()
await skipPhone.waitForSelector('.va-echo')
if (await skipPhone.locator('.va-check-offer').count()) throw new Error('PHQ-2 was offered again after skipping it today')
console.log('PHQ2_SKIP_ASSERTION', JSON.stringify({ checks: skippedChecks.length, offeredAgain: false }))
for (let i = 0; i < 2; i++) await postJson('pings', { userId: user.userId, kind: 'full', setting: 'home', startedAt: new Date(Date.now() + (i + 1) * 1000).toISOString(), features: probeFeatures, device: { ua: 'e2e', native: false, airpodsMotion: false, airpodsHr: false } })
const calibrated = (await (await fetch(`${base}api/users/${user.userId}/echoes`)).json()).at(-1)
const clinicCheck = await (await fetch(`${base}api/clinics/AALTO`)).json()
const unknownClinic = await fetch(`${base}api/clinics/unknown-code`)
const guest = await postJson('users', { name: 'e2e guest', visitor: true })
const guestEcho = await postJson('pings', { userId: guest.userId, visitor: true, kind: 'full', setting: 'home', startedAt: new Date().toISOString(), features: probeFeatures, device: { ua: 'e2e', native: false, airpodsMotion: false, airpodsHr: false } })
await postJson('doses', { userId: guest.userId, dose: 'wait', startedAt: new Date().toISOString(), durationS: 120, prePingId: guestEcho.pingId, postPingId: null, felt: null, metrics: { quietSeconds: 120 } })
const clinicRows = await (await fetch(`${base}api/clinic/patients`)).json()
console.log('APP2 probes', JSON.stringify({ calibrationEnded: calibrated?.status !== 'calibrating', clinic: clinicCheck.name, unknownClinic: unknownClinic.status, guestLoop: !!guestEcho.suggestion, guestOffClinic: !clinicRows.some((x) => x.id === guest.userId), waitRecorded: true }))

await phone.click('.va-offer .va-btn-primary')
await phone.waitForSelector('.va-intro'); await phone.waitForTimeout(500); await shot(phone, 'phone-dose-intro')
await phone.click('.va-intro-go .va-btn')
await phone.waitForSelector('.va-dose', { timeout: 20000 })
await phone.waitForTimeout(15000); await shot(phone, 'phone-dose'); await shot(mirror, 'mirror-dose')
await phone.click('.va-dose-foot .va-btn')
await phone.waitForSelector('.va-feel', { timeout: 90000 }); await shot(phone, 'phone-feel')
await phone.click('text=A bit better')
await phone.waitForSelector('.va-learned', { timeout: 20000 }); await phone.waitForTimeout(1500)
await phone.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-phone-learned.png`, fullPage: true })
await phone.click('.va-learned > .va-btn')
await phone.waitForSelector('.va-home'); await phone.waitForTimeout(1500)
await phone.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-phone-home.png`, fullPage: true })
console.log('APP2 home updated', /Today|echo|waiting/i.test(await phone.locator('.va-home').innerText()))

const clinic = await deskCtx.newPage(); watch(clinic, 'clinic')
await clinic.goto(base + '#/clinic'); await clinic.waitForTimeout(2500)
await clinic.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-clinic-list.png`, fullPage: true })
await clinic.goto(base + '#/clinic/p/' + user.userId); await clinic.waitForTimeout(3000)
await clinic.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-clinic-patient.png`, fullPage: true })
const cohortId = (await (await fetch(`${base}api/clinic/patients`)).json()).find((p) => p.synthetic)?.id
await clinic.goto(base + '#/clinic/p/' + cohortId); await clinic.waitForTimeout(3000)
await clinic.screenshot({ path: `${out}${String(++n).padStart(2, '0')}-clinic-patient-cohort.png`, fullPage: true })
console.log('ERRORS', JSON.stringify(errors, null, 1))
await b.close()
