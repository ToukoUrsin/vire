// The stage mirror behind the REAL phone pipeline: a headless phone (fake camera and microphone files) runs the
// patient app as it is in the source tree (tune, ping, echo, dose, measure again) and a 1920x1080 mirror follows it.
//   node web/src/clinic/dev/stagePhone.mjs [baseUrl] [outDir] [video] [audio] [name]
// Needs a global Playwright, the dev server (cd web && bunx vite --port 5877 --strictPort) and the API on 8871.
// It signs up one test person on the live server (rows are added, never removed). Every change of what the
// mirror shows is logged with what arrived on the wire, and screenshotted two seconds later.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync, renameSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`)

const base = (process.argv[2] ?? 'http://127.0.0.1:5877/').replace(/\/?$/, '/')
const out = (process.argv[3] ?? '/bulk2/runs/depression/stage/phone').replace(/\/?$/, '/')
const FIX = '/bulk2/runs/depression/sense-fixtures/'
const video = FIX + (process.argv[4] ?? 'swing66.y4m')
const audio = FIX + (process.argv[5] ?? 'talk.wav')
// a name of its own, so the mirror can pick this phone's room out of whatever else is running on the server
const who = process.argv[6] ?? `test-stage-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-video-capture=${video}`, `--use-file-for-fake-audio-capture=${audio}`],
})
const errors = []
const watch = (page, tag) => {
  page.on('console', (m) => m.type() === 'error' && !/XNNPACK|GL Driver|ERR_NETWORK_CHANGED/.test(m.text()) && errors.push(`${tag}: ${m.text().slice(0, 200)}`))
  page.on('pageerror', (e) => errors.push(`${tag} PAGEERROR: ${String(e).slice(0, 200)}`))
}
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const deskCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } })
const phone = await phoneCtx.newPage()
watch(phone, 'phone')
const mirror = await deskCtx.newPage()
watch(mirror, 'mirror')

await mirror.goto(`${base}#/clinic/live`)
await mirror.waitForSelector('.sg', { timeout: 60000 })
await mirror.screenshot({ path: `${out}00-lobby.png` })
await phone.goto(`${base}#/`)
await phone.waitForTimeout(1500)
await phone.fill('.va-field input', who)
await phone.click('button[type=submit]')

const state = () =>
  mirror.evaluate(() => {
    const s = window.__stage
    if (!s) return null
    const v = s.view(performance.now())
    return {
      mode: document.querySelector('.sg')?.getAttribute('data-mode'),
      phase: v.phase,
      tune: v.tuneStep,
      name: v.name,
      mesh: Math.round(s.rates.mesh ?? 0),
      frames: Math.round(s.rates.frame ?? 0),
      ownMesh: v.ownMesh,
      muscles: v.ownMuscles,
      head: v.headSource,
      heart: v.heartSource,
      ear: v.hasEar,
      kind: v.runKind,
      h1: document.querySelector('.sg h1')?.textContent ?? '',
      paint: +window.__stageLoop.cost.toFixed(2),
    }
  })

// follow the mirror: log and screenshot every change of what it shows
let done = false
let n = 0
const seen = []
const follower = (async () => {
  let last = ''
  while (!done) {
    const s = await state().catch(() => null)
    if (s) {
      const key = `${s.mode}/${s.phase}/${s.tune ?? ''}/${s.kind ?? ''}`
      if (key !== last) {
        last = key
        await mirror.waitForTimeout(2000)
        const now = (await state().catch(() => null)) ?? s
        const file = `${String(++n).padStart(2, '0')}-${key.replace(/\/+$/, '').replace(/\//g, '-')}.png`
        await mirror.screenshot({ path: out + file }).catch(() => {})
        seen.push(key)
        console.log(`${file}  ${JSON.stringify(now)}`)
      }
    }
    await mirror.waitForTimeout(300)
  }
})()

const step = async (name, fn) => {
  try {
    await fn()
    console.log(`phone: ${name}`)
    return true
  } catch (e) {
    console.log(`phone: ${name} DID NOT HAPPEN (${String(e).split('\n')[0].slice(0, 120)})`)
    await phone.screenshot({ path: `${out}phone-stuck-${name.replace(/\W+/g, '-')}.png` }).catch(() => {})
    return false
  }
}

// the lobby opens the newest room by itself. Other tests may be running on this server, so make sure the mirror
// is in THIS phone's room before the phone starts anything.
let mine = null
const findRoom = async () => {
  const rows = await fetch(`${base}api/live/rooms`).then((r) => r.json()).catch(() => [])
  return (Array.isArray(rows) ? rows : []).find((r) => r.name === who)?.code ?? null
}
const toRoom = async () => {
  if (mine) return true
  mine = await findRoom()
  if (!mine) return false
  const auto = mirror.url().includes(`/clinic/live/${mine}`)
  if (!auto) {
    await mirror.goto(`${base}#/clinic/live/${mine}`)
    await mirror.waitForSelector('.sg', { timeout: 60000 })
  }
  console.log(`mirror in room ${mine} (${auto ? 'the lobby opened it by itself' : 'sent there: another room was newer'})`)
  return true
}
for (let i = 0; i < 40 && !(await toRoom()); i++) await phone.waitForTimeout(500)

// tune: tap through whatever the flow asks for, until the ping starts
const tuneEnd = Date.now() + 200000
let inPing = false
while (Date.now() < tuneEnd && !inPing) {
  for (const id of ['tune-start', 'tune-done']) {
    const b = phone.locator(`[data-testid="${id}"]`)
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {})
      console.log(`phone: tapped ${id}`)
    }
  }
  await toRoom()
  inPing = await phone.locator('.va-stage[data-step]').first().isVisible().catch(() => false)
  await phone.waitForTimeout(700)
}
if (!inPing) await phone.screenshot({ path: `${out}phone-stuck-tune.png` })
await phone.screenshot({ path: `${out}phone-ping-start.png` }).catch(() => {})

let ok = await step('ping to the echo', () => phone.waitForSelector('.va-echo', { timeout: 150000 }))
if (ok) {
  await phone.waitForTimeout(6000)
  await phone.screenshot({ path: `${out}phone-echo.png` })
  ok = await step('take the dose', async () => {
    await phone.click('.va-offer .va-btn-primary', { timeout: 15000 })
    await phone.waitForSelector('.va-intro', { timeout: 15000 })
    await phone.click('.va-intro-go .va-btn')
    await phone.waitForSelector('.va-dose', { timeout: 20000 })
  })
}
if (ok) {
  await phone.waitForTimeout(15000)
  ok = await step('end the dose, measure again', async () => {
    await phone.click('.va-dose-foot .va-btn')
    await phone.waitForSelector('.va-feel', { timeout: 90000 })
  })
}
if (ok) {
  await phone.screenshot({ path: `${out}phone-feel.png` })
  await mirror.waitForTimeout(6000)
  await step('say how it felt', async () => {
    await phone.click('text=A bit better')
    await phone.waitForSelector('.va-learned', { timeout: 20000 })
  })
  await mirror.waitForTimeout(5000)
}
done = true
await follower
await mirror.screenshot({ path: `${out}99-end.png` })

const v = mirror.video()
await phoneCtx.close()
await deskCtx.close()
if (v) {
  renameSync(await v.path(), `${out}stage-phone.webm`)
  console.log(`video  ${out}stage-phone.webm`)
}
await browser.close()
console.log(`\nmirror showed: ${seen.join('  >  ')}`)
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 12).join('\n')}` : 'no console errors')
