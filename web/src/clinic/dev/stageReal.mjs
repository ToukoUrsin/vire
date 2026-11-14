// The stage mirror against the REAL relay: dev/fakeSensor.ts plays the whole round-2 show (tune, ping, echo,
// dose, measure again) into a test room and this follows it on a 1920x1080 mirror, recording a video.
//   node web/src/clinic/dev/stageReal.mjs [baseUrl] [outDir] [apiUrl] [room] [sensor flags...]
// Needs bun, a global Playwright, the dev server (cd web && bunx vite --port 5877 --strictPort) and the API on 8871.
// It also checks: a mirror opened in the middle of the ping (cold join), the socket dropping and coming back,
// the lobby (/#/clinic/live) opening the room by itself, the "*" room, and the ?debug=1 readout.
// Nothing is stored: the relay only passes messages on.
import { createRequire } from 'node:module'
import { execSync, spawn } from 'node:child_process'
import { mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`)

const base = (process.argv[2] ?? 'http://127.0.0.1:5877').replace(/\/$/, '')
const out = process.argv[3] ?? '/bulk2/runs/depression/stage/real'
const api = process.argv[4] ?? 'http://127.0.0.1:8871'
const room = (process.argv[5] ?? 'STAGE7').toUpperCase()
const sensorFlags = process.argv.slice(6)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] })
const errors = []
const fails = []
const big = { width: 1920, height: 1080 }
const open = async (name, hash, viewport = big, video = false) => {
  const ctx = await browser.newContext({ viewport, ...(video ? { recordVideo: { dir: out, size: viewport } } : {}) })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await page.goto(`${base}/#${hash}`)
  await page.waitForSelector('.sg', { timeout: 60000 })
  return page
}
const state = (page) =>
  page.evaluate(() => {
    const s = window.__stage
    const v = s.view(performance.now())
    const r = s.run
    return {
      mode: document.querySelector('.sg')?.getAttribute('data-mode'),
      phase: v.phase,
      conn: v.conn,
      tune: v.tuneStep,
      ownMesh: v.ownMesh,
      ownMuscles: v.ownMuscles,
      head: v.headSource,
      heart: v.heartSource,
      ear: v.hasEar,
      kind: v.runKind,
      cold: v.cold,
      phases: r ? r.phases.map((p) => p.key).join(',') : '',
      frames: Math.round(s.rates.frame ?? 0),
      mesh: Math.round(s.rates.mesh ?? 0),
      h1: document.querySelector('.sg h1')?.textContent ?? '',
      paint: +window.__stageLoop.cost.toFixed(2),
    }
  })
const until = (page, fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false)
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got ? `  ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`)
  if (!ok) fails.push(name)
}
const snap = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}.png` })
  return state(page)
}

const main = await open('main', `/clinic/live/${room}`, big, true)
const lobby = await open('lobby', '/clinic/live', { width: 1280, height: 720 })
const star = await open('star', '/clinic/live/*', { width: 1280, height: 720 })
const dbg = await open('debug', `/clinic/live/${room}?debug=1`, { width: 1440, height: 900 })
await main.waitForTimeout(2500)
let s = await snap(main, '00-waiting')
check('nobody in the room: attract screen, socket open', s.mode === 'attract' && s.conn === 'open', s)

const sensor = spawn('bun', [join(dirname(fileURLToPath(import.meta.url)), 'fakeSensor.ts'), '--url', api, '--room', room, '--name', 'Aino', '--show', ...sensorFlags], { stdio: ['ignore', 'ignore', 'inherit'] })
const noTune = sensorFlags.includes('--no-tune')
const noDose = sensorFlags.includes('--no-dose')

const tuneStep = (st) => until(main, (x) => window.__stage.tune.step === x, st)
const phase = (p, kind) => until(main, ([x, k]) => window.__stage.phase === x && (!k || window.__stage.run?.kind === k), [p, kind ?? null])
const mode = (m) => until(main, (x) => document.querySelector('.sg')?.getAttribute('data-mode') === x, m)

if (!noTune) {
  check('tune: smile asked', await tuneStep('smile'))
  await main.waitForTimeout(2000)
  s = await snap(main, '01-tune-smile')
  check('tune screen with own mesh', s.mode === 'tune' && s.ownMesh, s)
  check('tune: done', await tuneStep('done'))
  await main.waitForTimeout(1500)
  s = await snap(main, '02-tune-done')
  check('tune done shows the model check', /trained/i.test(s.h1), s.h1)
  const kept = await main.evaluate(() => document.querySelectorAll('.sg-shots li.is-done').length)
  check('five kept faces', kept === 5, String(kept))
}

check('ping: settle', await phase('settle'))
await main.waitForTimeout(4500)
s = await snap(main, '03-settle')
check('settle on screen, frames and mesh arriving', s.mode === 'ping' && s.frames > 8 && s.mesh > 3, s)

check('ping: nod', await phase('nod'))
await main.waitForTimeout(3600)
s = await snap(main, '04-nod')
check('nod on screen, head from the AirPods', s.mode === 'ping' && (sensorFlags.includes('--cam') ? s.head === 'camera' : s.head === 'airpods'), s)

check('ping: laugh', await phase('laugh'))
await main.waitForTimeout(4000)
// a mirror opened in the middle of the ping must catch up
const cold = await open('cold', `/clinic/live/${room}`)
await cold.waitForTimeout(3000)
s = await snap(cold, '05-cold-join-laugh')
const missed = await cold.evaluate(() => document.querySelectorAll('.sg-story li.is-missed').length)
check('cold join: lands in laugh, earlier steps marked as not seen', s.mode === 'ping' && s.phase === 'laugh' && s.cold && missed === 2, { ...s, missed })
s = await snap(main, '05-laugh')
check('laugh on screen', s.mode === 'ping' && s.phase === 'laugh', s)

check('ping: speak', await phase('speak'))
await main.waitForTimeout(2500)
// lose the socket the way a network drop would; the mirror must come back by itself, without a reload
const t0 = Date.now()
await main.evaluate(() => window.__stageDrop())
const closed = await until(main, () => window.__stage.conn !== 'open', null, 3000)
const back = await until(main, () => window.__stage.conn === 'open' && performance.now() - window.__stage.lastFrameAt < 300, null, 10000)
check('socket lost and back without a reload', closed && back, `${Date.now() - t0} ms`)
await main.waitForTimeout(3500)
s = await snap(main, '06-speak')
check('speak on screen after the reconnect', s.mode === 'ping' && s.phase === 'speak' && s.frames > 8, s)

check('ping: breathe', await phase('breathe'))
await main.waitForTimeout(13000)
s = await snap(main, '07-breathe')
check('breathe on screen', s.mode === 'ping' && s.phase === 'breathe', s)
s = await snap(cold, '07-cold-breathe')
check('cold mirror followed to breathe', s.phase === 'breathe' && s.phases === 'laugh,speak,breathe', s)

check('echo arrives', await mode('echo'))
await main.waitForTimeout(3000)
s = await snap(main, '08-echo')
const petals = await main.evaluate(() => document.querySelectorAll('.sg-fig-petal').length)
check('echo with four petals', petals === 4, s.h1)
await snap(cold, '08-cold-echo')
await cold.context().close()

// the other ways in
const lobbyAt = lobby.url()
// the lobby takes the newest room, the "*" mirror the one that started something last: with another test
// running on the same server that can be someone else's room, which is right
check('lobby opened a room by itself', /clinic\/live\/[A-Z0-9]+/.test(lobbyAt), `${lobbyAt.replace(base, '')}${lobbyAt.includes(room) ? '' : '  (another room is newer)'}`)
await lobby.screenshot({ path: `${out}/20-lobby.png` })
s = await snap(star, '21-star')
check('"*" room follows a phone', s.mode !== 'attract', s)
s = await snap(dbg, '22-debug')
const dl = await dbg.evaluate(() => document.querySelector('.sg-debug')?.textContent?.replace(/\s+/g, ' ').slice(0, 200) ?? '')
check('?debug=1 readout', dl.includes('socket'), dl)

if (!noDose) {
  check('dose', await mode('dose'))
  await main.waitForTimeout(9000)
  s = await snap(main, '09-dose')
  check('dose on screen', s.mode === 'dose', s)
  check('measure again: laugh', await phase('laugh', 'mini'))
  await main.waitForTimeout(5000)
  s = await snap(main, '10-again-laugh')
  check('re-measure on screen', s.mode === 'ping' && s.kind === 'mini' && /again/i.test(s.h1), s)
  check('before and after', await mode(sensorFlags.includes('--mini-echo') ? 'echo' : 'again'))
  await main.waitForTimeout(2500)
  s = await snap(main, '11-again')
  check('before and after on screen', /Before and after|After the dose/.test(s.h1), s.h1)
}

// the phone leaves: nothing broken, and the screen settles back
await new Promise((r) => {
  sensor.once('exit', r)
  setTimeout(() => {
    sensor.kill()
    r()
  }, 20000)
})
await main.waitForTimeout(6000)
s = await snap(main, '12-phone-gone')
check('phone gone: screen still whole', !!s.mode && s.conn === 'open', s)

const video = main.video()
for (const p of [lobby, star, dbg, main]) await p.context().close()
if (video) {
  const from = await video.path()
  renameSync(from, `${out}/stage-real.webm`)
  console.log(`video  ${out}/stage-real.webm`)
}
await browser.close()
console.log(errors.length ? `\nCONSOLE ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 12).join('\n')}` : '\nno console errors')
console.log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'all checks passed')
process.exit(fails.length ? 1 : 0)
