#!/usr/bin/env node
// Records the real product for the film, the way the founder demos it at the table: a phone (390x844) in the
// iPhone shell with AirPods, the big-screen mirror (1920x1080) following it, and the clinic's list.
//   node film/scripts/capture.mjs --base https://vire.fly.dev/ --out /bulk2/runs/depression/film/capture
// (film/capture.sh builds the face clips and calls this.)
//
// What is real and what is a test input:
//   - the app, the mirror, the clinic pages, the server and every number they show are the product's own;
//   - the camera is fed a video of a real face (fake-io.mjs), the microphone a recording of real speech;
//   - the AirPods (head motion, heart rate) are a stand-in for the iPhone shell's bridge, scripted below.
//   The first pings set this "person's" usual. The film's ping is a quieter day: the smile comes later and is
//   shorter, the nod and the heart's swing are a little smaller. The re-measure after the dose answers exactly
//   like the film's ping: no improvement is scripted, so the product reports what it reports.
//
// Writes, all cut on the product's own events so the film never needs retiming:
//   <out>/phone-<shot>.mp4, stage-<shot>.mp4, snd-<shot>.wav for shot = settle nod laugh speak breathe echo intro dose mini after
//   <out>/clinic-list.mp4, clinic-patient.mp4, clinic-booster.mp4
//   <out>/meta.json (events, the product's words and numbers, where things sit on the big screen), cap.js (the same for the film)
//   <out>/shots/*.png (stills from before the recording starts), camera.webm (what the camera was fed), sound.webm (everything the app played)
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { installIO, screencast } from './fake-io.mjs'
const require = createRequire(import.meta.url)
const { chromium, devices } = require('/home/ubuntu/.local/lib/node_modules/playwright')

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k)
  return i > 0 ? process.argv[i + 1] : d
}
const rawBase = arg('base', 'https://vire.fly.dev/')
const [basePath, baseQuery = ''] = rawBase.split('#')[0].split('?')
const base = basePath.replace(/\/?$/, '/')
const q = baseQuery ? '?' + baseQuery : ''
const out = arg('out', '/bulk2/runs/depression/film/capture').replace(/\/$/, '')
const clips = arg('clips', `${out}/clips`)
const speech = arg('speech', '/bulk2/runs/depression/sense-fixtures/talk.wav')
const warm = Number(arg('warm', '3'))
const name = arg('name', 'Aino')
// Keep the patient name human-readable; use the clinic code as the deletion handle for this run.
const clinicCode = arg('clinic-code', `film-${Date.now().toString(36)}`)
const wantDose = arg('dose', 'forest')
const doseSeconds = Number(arg('dose-seconds', '38'))
// how many recorded pixels per page pixel: the film enlarges parts of both screens, so they are recorded sharper
// than they are shown (1 is the lightest, if the box is too busy to keep up)
const stageScale = Number(arg('stage-scale', '1.5'))
const phoneScale = Number(arg('phone-scale', '2'))
const airpods = arg('airpods', '1') !== '0'
// "host=ip,host=ip": where the browser finds the server and the web fonts (capture.sh pins them when it runs the
// browser in a network of its own, where names do not resolve)
const resolve = arg('resolve', '')
// when the "person" starts to smile after the laugh step begins (the laughter itself starts 1 s in)
const usualSmileMs = Number(arg('usual-smile-ms', '1150'))
const filmSmileMs = Number(arg('film-smile-ms', '1750'))
// the film's ping is a quieter day than this person's usual: the nod and the heart's swing are this much smaller
const filmNod = Number(arg('film-nod', '0.93'))
const filmSwing = Number(arg('film-swing', '0.92'))
if (name !== 'Aino') throw new Error('capture: visible test user must be named Aino')
if (!/^film-/.test(clinicCode)) throw new Error('capture: clinic code must start with film-')
mkdirSync(`${out}/shots`, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000
const events = []
const log = (ev) => {
  events.push({ t: ev.t ?? now(), ...ev })
  if (ev.name !== 'sample') console.log(`[${new Date().toISOString().slice(11, 19)}]`, JSON.stringify(ev).slice(0, 160))
}

// which clip the "person" shows for each asked-for face: [file, loop from, loop to, start]
// (one man posing for the camera, Wikimedia Commons "20140529 - ...", Clément Bucco-Lechat, CC BY-SA 3.0)
const REST = ['rest-loop.webm', 0, 1e9, 0]
const FACES = {
  rest: [REST],
  smile: [['smiling.webm', 1.35, 2.1, 0.75], ['smiling.webm', 2.1, 2.8, 0.75], ['smiling.webm', 1.35, 2.8, 0.75]],
  sad: [REST], // there is no corners-down recording of this man: he keeps a resting face
  angry: [['frowning.webm', 0.5, 1.15, 0.25], ['frowning.webm', 1.15, 1.8, 0.25]],
  surprised: [['surprised.webm', 1.2, 1.8, 0.85], ['surprised.webm', 1.8, 2.45, 0.85]],
}
const files = { 'speech.wav': speech }
for (const f of ['rest-loop.webm', 'smiling.webm', 'frowning.webm', 'surprised.webm', 'smile-long.webm', 'smile-short.webm']) files[f] = `${clips}/${f}`
for (const [n, p] of Object.entries(files)) if (!existsSync(p)) throw new Error(`missing ${n}: ${p}`)
const clipSeconds = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', files[f]], { encoding: 'utf8' }).stdout) || 6
const SMILE = { long: clipSeconds('smile-long.webm'), short: clipSeconds('smile-short.webm') }

// two browsers, because the recording's sharpness is a setting of the whole browser
const launch = (scale) => chromium.launch({
  args: [
    `--force-device-scale-factor=${scale}`,
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(resolve ? [`--host-resolver-rules=${resolve.split(',').map((r) => 'MAP ' + r.replace('=', ' ')).join(', ')}`] : []),
  ],
})
const errors = []
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${String(e).slice(0, 200)}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/XNNPACK|GL Driver|vo-tune|Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text().slice(0, 200)}`)
  })
}
const browser = await launch(phoneScale)
const desk = await launch(stageScale)
const phoneCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  ...(airpods ? { userAgent: devices['iPhone 13'].userAgent + ' VireShell/1' } : {}),
})
const deskCtx = await desk.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: stageScale })
const clinicCtx = await desk.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: stageScale })

// what the phone sends and what the server answers: the product's own numbers (the traces are left out, they are big)
await phoneCtx.addInitScript(({ clinicCode }) => {
  if (window.top !== window) return
  const real = window.fetch
  window.__sent = []
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input))
    if (/\/api\/users$/.test(url.split('?')[0]) && init?.body) {
      try {
        const body = JSON.parse(init.body)
        init = { ...init, body: JSON.stringify({ ...body, clinicCode }) }
      } catch {}
    }
    const res = await real.call(this, input, init)
    try {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input))
      const m = /\/api\/(pings|doses)$/.exec(url.split('?')[0])
      if (m && typeof init?.body === 'string') {
        const { traces: _traces, ...body } = JSON.parse(init.body)
        const t = Date.now() / 1000
        res
          .clone()
          .json()
          .then((answer) => window.__sent.push({ t, what: m[1], body, res: answer }))
          .catch(() => window.__sent.push({ t, what: m[1], body, res: null }))
      }
    } catch {}
    return res
  }
}, { clinicCode })

// ---- the AirPods: a stand-in for the iPhone shell's bridge (CONTRACT.md "Native bridge") ----
// Head: a little living sway, two nods when asked; in the forest a slow look left and right that stops on a bird
// when the phone says "There. Hold it.", the way a person does, and turns back the other way once it is found.
// Heart: 63 bpm; while the app leads a slow breath it rises on the in-breath and falls on the out-breath.
if (airpods) {
  await phoneCtx.addInitScript(() => {
    if (window.top !== window) return
    const st = { on: false, heart: false, nodAt: -1, nodScale: 1, swingScale: 1, look: false, lookT: 0, lookGain: 0, held: false, heldAt: 0, giveUp: false, breathAt: -1, breathEnd: -1, cmds: [] }
    window.__pods = st
    const say = (m) => {
      try {
        window.__vireNative?.(m)
      } catch {}
    }
    const status = () => say({ k: 'status', airpods: 'connected', hr: st.heart ? 'on' : 'off' })
    window.webkit = {
      messageHandlers: {
        vire: {
          postMessage(m) {
            st.cmds.push(m.cmd)
            if (m.cmd === 'start') {
              st.on = true
              setTimeout(() => {
                say({ k: 'caps', airpodsMotion: true, airpodsHr: true })
                status()
              }, 50)
            }
            if (m.cmd === 'stop') st.on = false
            if (m.cmd === 'heart') {
              st.heart = !!m.on
              setTimeout(status, 30)
            }
          },
        },
      },
    }
    const dip = (a, len) => (a > 0 && a < len ? 0.5 - 0.5 * Math.cos((2 * Math.PI * a) / len) : 0)
    const LOOK_S = 24
    let last = null
    let lastT = 0
    const step = (s) => {
      const dt = lastT ? Math.min(0.2, Math.max(0.001, s - lastT)) : 0.04
      lastT = s
      // the look around: its clock only runs while the head is not holding on a bird; it eases in and out
      if (st.look && !st.held) st.lookT += dt
      st.lookGain += ((st.look ? 1 : 0) - st.lookGain) * Math.min(1, dt / 0.6)
      const look = 70 * Math.sin((2 * Math.PI * st.lookT) / LOOK_S) * st.lookGain
      const calm = 1 - 0.7 * st.lookGain
      const nod = st.nodAt < 0 ? 0 : st.nodScale * (-13 * dip(s - st.nodAt, 0.62) - 11 * dip(s - st.nodAt - 0.82, 0.58))
      const p = [1.6 * Math.sin(s * 0.71) + 0.5 * Math.sin(s * 1.9 + 1) + nod, calm * (2.2 * Math.sin(s * 0.33) + 0.6 * Math.sin(s * 1.3 + 2)) + look, 0.5 * Math.sin(s * 0.9 + 0.4)]
      const b = last ?? p
      last = p
      return [p[0], p[1], p[2], 0, 0, 0, (p[0] - b[0]) / dt, (p[1] - b[1]) / dt, (p[2] - b[2]) / dt]
    }
    setInterval(() => {
      if (!st.on) return
      const t = Date.now()
      if (st.look) {
        // what the person reads on the phone
        const line = /Hold it/.test(document.querySelector('.va-app')?.textContent ?? '')
        if (!line) {
          if (st.held) {
            // found: the next bird calls from the other side, so turn back that way
            const ph = ((2 * Math.PI * st.lookT) / LOOK_S) % (2 * Math.PI)
            if (Math.sin(ph) * Math.cos(ph) > 0) st.lookT = ((Math.PI - ph + 2 * Math.PI) % (2 * Math.PI)) * (LOOK_S / (2 * Math.PI))
          }
          st.held = false
          st.giveUp = false
        } else if (!st.held && !st.giveUp) {
          st.held = true
          st.heldAt = t
        } else if (st.held && t - st.heldAt > 9000) {
          // lost it: look around again
          st.held = false
          st.giveUp = true
        }
      } else st.held = false
      const rows = []
      for (let i = 0; i < 5; i++) {
        const at = t - (4 - i) * 40
        rows.push([at, ...step(at / 1000)])
      }
      say({ k: 'head', s: rows })
    }, 200)
    setInterval(() => {
      if (!st.on || !st.heart) return
      const s = Date.now() / 1000
      let bpm = 63 + 0.4 * Math.sin(s / 7.3) + 0.2 * Math.sin(s / 2.9 + 1)
      // one breath is ten seconds: up on the in-breath, down on the out-breath, the same swing for one breath or two
      if (st.breathAt >= 0 && s >= st.breathAt && (st.breathEnd < 0 || s < st.breathEnd)) bpm += 5 * st.swingScale * Math.sin((2 * Math.PI * (s - st.breathAt)) / 10)
      say({ k: 'hr', t: Date.now(), bpm: Math.round(bpm * 10) / 10 })
    }, 1000)
  })
}
await installIO(phoneCtx, files, out, log)
const phone = await phoneCtx.newPage()
watch(phone, 'phone')
const stage = await deskCtx.newPage()
watch(stage, 'stage')

// ---- recordings: every painted frame with its wall-clock time; shots are cut out of them afterwards ----
const live = {}
const reels = {}
async function rec(key, page, size) {
  const dir = `${out}/frames-${key}`
  rmSync(dir, { recursive: true, force: true })
  live[key] = { dir, cast: await screencast(page, dir, size) }
}
async function cut(key) {
  const r = live[key]
  delete live[key]
  const times = await r.cast.stop()
  if (!times.length) throw new Error(`no frames for ${key}`)
  reels[key] = { dir: r.dir, times, end: now() }
}
const videos = {}
/** one shot: the frames of a reel between two wall-clock times, as 30 fps video */
function slice(file, key, from, to) {
  const r = reels[key]
  if (!r || !(to > from)) throw new Error(`capture: cannot cut ${file} (${from} to ${to})`)
  const pad = (i) => String(i).padStart(6, '0')
  let a = 0
  while (a + 1 < r.times.length && r.times[a + 1] <= from) a++
  const lines = ['ffconcat version 1.0']
  let n = 0
  for (let i = a; i < r.times.length && r.times[i] < to; i++) {
    const s = Math.max(from, r.times[i])
    const e = Math.min(to, i + 1 < r.times.length ? r.times[i + 1] : r.end)
    if (e <= s) continue
    lines.push(`file '${r.dir}/${pad(i)}.jpg'`, `duration ${(e - s).toFixed(4)}`)
    n++
    if (r.times[i + 1] === undefined || r.times[i + 1] >= to) lines.push(`file '${r.dir}/${pad(i)}.jpg'`)
  }
  const list = `${r.dir}/${file}.txt`
  writeFileSync(list, lines.join('\n') + '\n')
  const p = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-t', (to - from).toFixed(3),
    '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-g', '30',
    '-movflags', '+faststart', `${out}/${file}.mp4`], { encoding: 'utf8' })
  if (p.status !== 0) throw new Error(`ffmpeg ${file}: ${p.stderr.slice(-400)}`)
  videos[file] = { start: from, seconds: Math.round((to - from) * 100) / 100, frames: n }
}
/** when a part of a shot lights up (the wireframe face turns gold with a smile): seconds into the shot, or null */
function litAt(file, r) {
  if (!r || !videos[file]) return null
  const size = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', `${out}/${file}.mp4`], { encoding: 'utf8' }).stdout
  const k = (Number(size) || 1920) / 1920
  const [x, y, w, h] = [r[0] + r[2] * 0.08, r[1] + r[3] * 0.12, r[2] * 0.84, r[3] * 0.76].map((v) => Math.max(0, Math.round(v * k)))
  const p = spawnSync('ffmpeg', ['-v', 'error', '-i', `${out}/${file}.mp4`, '-vf', `crop=${w}:${h}:${x}:${y},signalstats,metadata=print:key=lavfi.signalstats.SATAVG:file=-`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const pts = [...p.stdout.matchAll(/pts_time:([\d.]+)\s+lavfi\.signalstats\.SATAVG=([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
  if (pts.length < 20) return null
  const early = pts.filter(([t]) => t < 1.5).map(([, v]) => v).sort((a, b) => a - b)
  const base = early[Math.floor(early.length / 2)] ?? pts[0][1]
  const top = Math.max(...pts.map(([, v]) => v))
  if (top - base < 0.8) return null
  const hit = pts.find(([, v]) => v > base + 0.3 * (top - base))
  return hit ? Math.round(hit[0] * 100) / 100 : null
}
/** the app's own sound over the same window */
function sliceSound(file, from, to) {
  const t0 = events.find((e) => e.name === 'sound-rec-start')?.t
  if (t0 == null || !existsSync(`${out}/sound.webm`)) return
  const args = ['-v', 'error', '-y', '-i', `${out}/sound.webm`, '-ss', Math.max(0, from - t0).toFixed(3), '-t', (to - from).toFixed(3), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', `${out}/${file}.wav`]
  const p = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  if (p.status !== 0) throw new Error(`ffmpeg ${file}.wav: ${p.stderr.slice(-300)}`)
}
const PHONE = { maxWidth: Math.round(390 * phoneScale), maxHeight: Math.round(844 * phoneScale), quality: 92 }
const DESK = { maxWidth: Math.round(1920 * stageScale), maxHeight: Math.round(1080 * stageScale), quality: 90 }

let shotN = 0
/** a still of both screens; never while recording (a screenshot stalls the page it is taken from) */
const shot = async (tag) => {
  if (Object.keys(live).length) return
  const n = String(++shotN).padStart(2, '0')
  await phone.screenshot({ path: `${out}/shots/${n}-${tag}-phone.png` }).catch(() => {})
  await stage.screenshot({ path: `${out}/shots/${n}-${tag}-stage.png`, scale: 'css' }).catch(() => {})
}
const show = (take) => phone.evaluate(([f, from, to, start]) => window.__cam.play(f, from, to, start ?? from), take).catch(() => {})
const rest = () => show(REST)
const pods = (fn, a) => (airpods ? phone.evaluate(fn, a).catch(() => {}) : Promise.resolve())
/** open a page and make sure it really drew: a dropped connection leaves a blank page behind */
const open = async (page, url, what, ready, has) => {
  let last
  for (let i = 0; i < 6; i++) {
    try {
      if (i > 0) await page.goto('about:blank').catch(() => {})
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForSelector(ready, { timeout: 25000 })
      if (has) await page.waitForFunction((w) => document.body.innerText.toUpperCase().includes(w), has.toUpperCase(), { timeout: 20000 })
      return
    } catch (e) {
      last = e
      log({ name: 'retry', what, err: String(e).slice(0, 80) })
      await sleep(1500 + i * 1500)
    }
  }
  throw new Error(`capture step "${what}" failed: ${last?.message ?? last}`)
}
const STAGE_READY = '.sg, [class^="sg-"], [class*=" sg-"]'

// ---- the person: watches the phone and answers the way a person would ----
let alive = true
let laps = {}
let mode = 'usual' // 'usual' while Vire learns this person, 'film' for the ping in the film and its re-measure
const marks = {}
const mark = (k) => {
  if (!(k in marks)) marks[k] = now()
}
const seen = { view: '', step: '', tune: '', found: 0 }
const person = (async () => {
  while (alive) {
    const s = await phone
      .evaluate(() => {
        const app = document.querySelector('.va-app')
        const st = document.querySelector('.va-stage')
        const tf = document.querySelector('.vt-flow')
        const view = app?.dataset.view ?? ''
        return {
          view,
          step: st?.dataset.step ?? '',
          tune: tf ? `${tf.dataset.screen}|${tf.dataset.step ?? ''}|${tf.dataset.index ?? ''}` : '',
          found: view === 'dose' ? Number(/(\d) of \d found/.exec(app.textContent ?? '')?.[1] ?? 0) : 0,
        }
      })
      .catch(() => null)
    if (!s) {
      await sleep(100)
      continue
    }
    if (s.found > seen.found) {
      log({ name: 'bird', n: s.found })
      mark(`bird-${s.found}`)
    }
    seen.found = s.found
    if (s.view !== seen.view) {
      seen.view = s.view
      log({ name: 'view', view: s.view })
      if (mode === 'film') mark(`view-${s.view}`)
    }
    if (s.step !== seen.step) {
      const was = seen.step
      seen.step = s.step
      if (s.step) {
        log({ name: 'step', step: s.step, view: s.view })
        if (mode === 'film') mark(`${s.view}-${s.step}`)
      }
      if (s.step === 'nod') setTimeout(() => void pods(() => { window.__pods.nodAt = Date.now() / 1000 }).then(() => log({ name: 'nod' })), 1700)
      if (s.step === 'laugh') {
        const film = mode === 'film'
        const after = film ? filmSmileMs : usualSmileMs
        const clip = film ? 'smile-short.webm' : 'smile-long.webm'
        setTimeout(() => void show([clip, 1e9, 1e9, 0]).then(() => log({ name: 'smile', clip })), after)
        // the clip ends on a resting face; go back to the resting loop once it is over
        setTimeout(() => void rest(), after + (film ? SMILE.short : SMILE.long) * 1000 - 120)
      }
      if (s.step === 'speak') setTimeout(() => void phone.evaluate(() => window.__mic.speak(1.2, 8.5)).then(() => log({ name: 'talk' })).catch(() => {}), 3400)
      if (s.step === 'breathe') void pods(() => { window.__pods.breathAt = Date.now() / 1000; window.__pods.breathEnd = -1 })
      if (was === 'breathe') void pods(() => { window.__pods.breathEnd = Date.now() / 1000 })
    }
    if (s.tune !== seen.tune) {
      seen.tune = s.tune
      const [screen, face, index] = s.tune.split('|')
      if (screen) log({ name: 'tune', screen, face, index: Number(index) })
      if (screen === 'run' && Number(index) >= 0 && FACES[face]) {
        const lap = (laps[face] = (laps[face] ?? -1) + 1)
        const take = FACES[face][Math.min(lap, FACES[face].length - 1)]
        setTimeout(() => void show(take), 800)
      }
    }
    await sleep(50)
  }
})()

// The big screen shows each step a moment after the phone (the phone relays it). Note when its title changes, so
// the big screen's shots can be cut that much later and both screens show the same moment.
const stageWatch = (async () => {
  let title = ''
  while (alive) {
    if (mode === 'film') {
      const t = await stage.evaluate(() => (document.querySelector('.sg-say')?.innerText ?? '').split('\n')[0].trim().toLowerCase()).catch(() => null)
      if (t && t !== title) {
        title = t
        mark(`stage-${t.replace(/[^a-z]+/g, '-')}`)
      }
    }
    await sleep(120)
  }
})()

const waitView = (v, timeout = 120000) => phone.waitForSelector(`.va-app[data-view="${v}"]`, { timeout })
const must = async (step, fn) => {
  try {
    return await fn()
  } catch (e) {
    throw new Error(`capture step "${step}" failed: ${e?.message ?? e}`)
  }
}
const text = async (page, sel, max = 900) => ((await page.textContent(sel, { timeout: 1500 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
// where things sit on the big screen (CSS px of a 1920x1080 page) and what it says, so the film can frame them
// whatever the layout is tonight
const rects = {}
const said = {}
const measure = async (tag, page = stage, prefix = 'sg') => {
  const got = await page
    .evaluate((pre) => {
      const o = {}
      const nth = {}
      for (const el of document.querySelectorAll(`[class*="${pre}"]`)) {
        const cls = [...el.classList].find((c) => c === pre || c.startsWith(pre + '-'))
        if (!cls) continue
        const r = el.getBoundingClientRect()
        if (!(r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight)) continue
        // the first of a kind under its class, the next ones as ".class:2", ".class:3"
        nth[cls] = (nth[cls] ?? 0) + 1
        if (nth[cls] > 6) continue
        o['.' + cls + (nth[cls] > 1 ? ':' + nth[cls] : '')] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
      }
      return { o, words: (document.body.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200) }
    }, prefix)
    .catch(() => null)
  rects[tag] = got?.o ?? {}
  said[tag] = got?.words ?? ''
}
const product = { said }
let stageLag = null // how far the big screen ran behind the phone (s); its shots are cut that much later
const collect = async () => {
  const sent = await phone.evaluate(() => window.__sent ?? []).catch(() => null)
  if (!sent) return
  const pings = sent.filter((x) => x.what === 'pings')
  const full = pings.filter((p) => p.body.kind !== 'mini')
  const hero = full.at(-1)
  const mini = pings.filter((p) => p.body.kind === 'mini').at(-1)
  product.ping = hero ? { features: hero.body.features, unreadable: hero.body.unreadable ?? [], device: hero.body.device, echo: hero.res } : null
  product.usual = full.slice(0, -1).map((p) => ({ smileLatencyMs: p.body.features?.smile?.latencyMs ?? null, values: Object.fromEntries((p.res?.components ?? []).map((c) => [c.channel, c.value])), strength: p.res?.strength, status: p.res?.status }))
  product.mini = mini ? { features: mini.body.features, unreadable: mini.body.unreadable ?? [], echo: mini.res } : null
  const dose = sent.filter((x) => x.what === 'doses').at(-1)
  product.dose = dose ? { dose: dose.body.dose, felt: dose.body.felt, metrics: dose.body.metrics, res: dose.res } : null
}

try {
  // ---- first run and Tune (not in the film: it gives this face its own range, which every reading is scored against) ----
  await open(stage, base + q + '#/clinic/live', 'open live mirror', STAGE_READY)
  await open(phone, base + q + '#/', 'open patient app', '.va-field input')
  await must('load camera and microphone fixtures', () => phone.waitForFunction(() => !!window.__cam && !!window.__mic, null, { timeout: 60000 }))
  await phone.evaluate(() => Promise.all([window.__cam.load(), window.__mic.load()]))
  await rest()
  await phone.evaluate(() => window.__cam.record())
  await sleep(1200)
  await shot('first')
  await phone.fill('.va-field input', name)
  await sleep(500)
  log({ name: 'start-tap' })
  await must('start patient onboarding', () => phone.click('button[type=submit]'))
  await must('load Tune screen', () => phone.waitForFunction(() => !!document.querySelector('.va-tune-mock, .vt-flow'), null, { timeout: 60000 }))
  const user = JSON.parse((await phone.evaluate(() => localStorage.getItem('vire.user'))) ?? 'null')
  if (user?.userId) {
    product.room = user.userId.slice(0, 6).toUpperCase()
    await open(stage, `${base}${q}#/clinic/live/${product.room}`, 'open this phone on the mirror', STAGE_READY, product.room)
  }
  if (await phone.locator('.va-tune-mock').count()) {
    log({ name: 'tune-scripted' })
    await must('finish scripted Tune', () => phone.waitForFunction(() => !document.querySelector('.va-tune-mock'), null, { timeout: 60000 }))
  } else {
    await must('show Tune intro', () => phone.waitForSelector('.vt-flow[data-screen="intro"]', { timeout: 120000 }))
    await sleep(2500)
    log({ name: 'tune-start' })
    await must('start Tune', () => phone.click('[data-testid="tune-start"]'))
    const t0 = Date.now()
    for (;;) {
      if (Date.now() - t0 > 240000) throw new Error('capture step "Tune" failed: did not finish in 4 minutes')
      const scr = await phone.evaluate(() => document.querySelector('.vt-flow')?.dataset.screen ?? null)
      if (!scr) throw new Error('capture step "Tune" failed: flow disappeared')
      if (scr === 'result') break
      await sleep(100)
    }
    log({ name: 'tune-result' })
    await rest()
    await sleep(2200)
    product.tuneAccuracy = (await text(phone, '[data-testid="tune-accuracy"]')) || null
    await shot('tune-result')
    await show(FACES.smile[2])
    await sleep(2600)
    product.tuneReadSmile = (await text(phone, '.vt-read b')) || null
    await rest()
    await sleep(1400)
    log({ name: 'tune-done', read: product.tuneReadSmile })
    await must('finish Tune', () => phone.click('[data-testid="tune-done"]'))
  }

  // ---- pings: the first ones teach Vire this person's usual, the last one is the film's ----
  const total = warm + 1
  for (let k = 1; k <= total; k++) {
    const hero = k === total
    if (k > 1) {
      await waitView('home')
      await sleep(hero ? 1500 : 500)
    }
    if (hero) {
      mode = 'film'
      await pods(([n, w]) => { window.__pods.nodScale = n; window.__pods.swingScale = w }, [filmNod, filmSwing])
      await shot('home')
      await rec('phone', phone, PHONE)
      await rec('stage', stage, DESK)
      if (k > 1) await sleep(2500)
      mark('tap')
    }
    if (k > 1) {
      log({ name: 'ping-tap', k })
      await must(`tap ping ${k}`, () => phone.locator('.va-portal, .va-link').first().click({ timeout: 30000 }))
    }
    await phone.waitForSelector('.va-stage[data-step="settle"]', { timeout: 120000 })
    log({ name: 'ping', k, hero })
    if (hero) {
      for (const [step, wait] of [['nod', 2600], ['laugh', filmSmileMs + 2400], ['speak', 7500], ['breathe', 12000]]) {
        await phone.waitForSelector(`.va-stage[data-step="${step}"]`, { timeout: 60000 })
        await sleep(wait)
        await measure(step)
      }
    }
    await waitView('echo', 180000)
    log({ name: 'echo', k })
    if (!hero) {
      await sleep(1500)
      if (k === 1) await shot('echo-first')
      // close the echo without a dose
      await phone.locator('.va-offer .va-btn-ghost, .va-echo-next').first().click({ timeout: 20000 })
    }
  }

  // ---- the film's echo, the dose, the re-measure, what Vire learned ----
  await sleep(7000)
  await measure('echo')
  product.echoText = await text(phone, '.va-echo')
  await sleep(4500)
  const offered = (await text(phone, '.va-offer h2, .va-offer h3', 80)).toLowerCase()
  product.offer = await text(phone, '.va-offer', 400)
  mark('offer-tap')
  if (offered && (wantDose === 'any' || offered.includes(wantDose))) {
    log({ name: 'offer-tap', offered })
    await phone.click('.va-offer .va-btn-primary')
  } else {
    // Vire offered something else (or nothing) this time: the person picks the dose from the home screen
    log({ name: 'offer-skip', offered })
    await phone.locator('.va-offer .va-btn-ghost, .va-echo-next').first().click()
    await waitView('home')
    await sleep(1800)
    const chip = phone.locator('.va-dose-row .va-chip', { hasText: new RegExp(wantDose === 'any' ? '.' : wantDose, 'i') }).first()
    if (await chip.count()) await chip.click()
    else await must('take the suggested dose', () => phone.click('.va-suggest .va-btn-primary'))
    product.dosePickedFromHome = true
  }
  await waitView('intro', 30000)
  await sleep(4500)
  product.doseIntro = await text(phone, '.va-intro', 400)
  log({ name: 'dose-go' })
  mark('dose-go')
  await phone.click('.va-intro-go .va-btn')
  await waitView('dose', 30000)
  // the forest: look slowly left and right for the birds; breathing: the heart follows the breath
  await sleep(2500)
  await pods(() => { window.__pods.look = true; window.__pods.breathAt = Date.now() / 1000; window.__pods.breathEnd = -1 })
  await sleep(doseSeconds * 500)
  await measure('dose')
  await sleep(Math.max(1000, doseSeconds * 500 - 2500))
  product.doseScreen = await text(phone, '.va-app', 300)
  await pods(() => { window.__pods.look = false; window.__pods.breathEnd = Date.now() / 1000 })
  await sleep(1700)
  log({ name: 'dose-end' })
  mark('dose-end')
  await phone.click('.va-dose-foot .va-btn')
  await waitView('mini', 60000).catch(() => {})
  await phone.waitForSelector('.va-stage[data-step="laugh"]', { timeout: 60000 }).catch(() => {})
  await sleep(filmSmileMs + 2400)
  await measure('mini-laugh')
  await waitView('feel', 120000)
  await sleep(2600)
  await measure('again')
  log({ name: 'feel-tap' })
  mark('feel-tap')
  await phone.click('text=About the same')
  await waitView('learned', 30000)
  await sleep(5000)
  await measure('learned')
  product.learned = await text(phone, '.va-learned')
  await sleep(3500)
  mark('learned-done')
  await phone.click('.va-learned > .va-btn').catch(() => {})
  await waitView('home', 30000).catch(() => {})
  await sleep(2500)
  mark('end')
  await cut('phone')
  await sleep(2500) // the big screen is behind the phone: let it catch up before its recording stops
  await cut('stage')
  await shot('home-after')
  await collect()
  await phone.evaluate(() => {
    window.__cam.stop()
    try {
      window.__soundRec?.stop()
    } catch {}
  })
  await sleep(1500)

  // ---- the clinic ----
  const clinic = await clinicCtx.newPage()
  watch(clinic, 'clinic')
  await open(clinic, base + q + '#/clinic', 'open clinic list', 'a[href*="/clinic/p/"]')
  const api = (path, init) => clinic.evaluate(async ([p, i]) => {
    const r = await fetch(new URL('api/' + p, location.href.split('#')[0].split('?')[0]), i ?? undefined)
    return r.headers.get('content-type')?.includes('json') ? r.json() : null
  }, [path, init ?? null]).catch(() => null)
  const patients = (await api('clinic/patients')) ?? []
  await sleep(1500)
  await clinic.screenshot({ path: `${out}/shots/90-clinic-list.png`, scale: 'css' }).catch(() => {})
  await rec('clinic', clinic, DESK)
  await sleep(600)
  marks.clinicList = now()
  log({ name: 'clinic-list' })
  await measure('clinic-list', clinic, 'cl')
  await sleep(6500)
  const row = clinic.locator('a[href*="/clinic/p/"]').first()
  const topId = (await row.getAttribute('href'))?.split('/').pop()?.split('?')[0]
  const top = patients.find((p) => p.id === topId) ?? { id: topId }
  product.clinic = {
    heading: await text(clinic, 'h1', 160),
    total: patients.length,
    synthetic: patients.filter((p) => p.synthetic).length,
    top: { name: top.name, reason: top.reason, status: top.status, drift: top.drift, strength: top.strength, daysSinceCourse: top.daysSinceCourse, synthetic: top.synthetic },
  }
  rects['clinic-row'] = { row: await row.boundingBox().then((b) => (b ? [b.x, b.y, b.width, b.height].map(Math.round) : null)) }
  marks.clinicOpen = now()
  log({ name: 'clinic-open' })
  await must('open clinic patient', () => row.click())
  const ask = clinic.getByRole('button', { name: /booster/i }).first()
  await must('find booster action', () => ask.waitFor({ timeout: 30000 }))
  await sleep(1200)
  rects['clinic-patient'] = { button: await ask.boundingBox().then((b) => (b ? [b.x, b.y, b.width, b.height].map(Math.round) : null)) }
  await measure('clinic-patient-parts', clinic, 'cl')
  product.clinic.patientTitle = await text(clinic, 'h1', 160)
  product.clinic.boosterLabel = await text(clinic, 'button:has-text("booster")', 80)
  await sleep(6300)
  marks.clinicBooster = now()
  log({ name: 'clinic-booster' })
  await ask.click()
  await sleep(4800)
  product.clinic.afterBooster = await text(clinic, 'button:has-text("ooster")', 80)
  marks.clinicEnd = now()
  await cut('clinic')
  await clinic.screenshot({ path: `${out}/shots/92-clinic-booster.png`, scale: 'css' }).catch(() => {})
  // leave the cohort as it was found
  if (top?.id) await api(`clinic/patients/${top.id}/booster`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) })

  // ---- cut the shots on the product's own events ----
  const m = marks
  const need = (k) => {
    if (m[k] == null) throw new Error(`capture: the film's ping never reached "${k}"`)
    return m[k]
  }
  const echoAt = need('view-echo')
  const bird = m['bird-1']
  const windows = {
    settle: [need('ping-settle') - 0.4, need('ping-nod') - 0.05],
    nod: [need('ping-nod') - 0.2, need('ping-laugh') - 0.05],
    laugh: [need('ping-laugh') - 1.0, need('ping-speak') - 0.05],
    speak: [need('ping-speak') - 0.2, need('ping-breathe') - 0.05],
    breathe: [need('ping-breathe') - 0.2, echoAt - 0.05],
    echo: [echoAt - 0.3, need('offer-tap') + 0.25],
    intro: [need('view-intro') - 0.2, need('dose-go') + 0.2],
    // the dose shot is cut around the first bird found (or the start of the dose when there is none to find)
    dose: bird ? [Math.max(need('dose-go') + 1.5, bird - 7), Math.min(need('dose-end') + 0.5, bird + 7)] : [need('dose-go') + 1.5, Math.min(need('dose-end') + 0.5, need('dose-go') + 15.5)],
    mini: [need('dose-end') + 0.3, need('view-feel') + 0.2],
    after: [need('view-feel') - 0.2, need('end')],
  }
  const lags = ['nod', 'laugh', 'speak', 'breathe'].map((s) => (m[`stage-${s}`] && m[`ping-${s}`] ? m[`stage-${s}`] - m[`ping-${s}`] : null)).filter((x) => x != null && x > -0.5 && x < 4).sort((x, y) => x - y)
  stageLag = lags.length ? Math.round(lags[Math.floor(lags.length / 2)] * 100) / 100 : 0
  for (const [shotName, [a, b]] of Object.entries(windows)) {
    slice(`phone-${shotName}`, 'phone', a, b)
    slice(`stage-${shotName}`, 'stage', a + stageLag, b + stageLag)
    sliceSound(`snd-${shotName}`, a, b)
  }
  slice('clinic-list', 'clinic', m.clinicList, m.clinicOpen - 0.1)
  slice('clinic-patient', 'clinic', m.clinicOpen + 0.5, m.clinicBooster - 0.1)
  slice('clinic-booster', 'clinic', m.clinicBooster - 0.8, m.clinicEnd)
  for (const r of Object.values(reels)) rmSync(r.dir, { recursive: true, force: true })

  // when things happen inside the shots (seconds from the start of each)
  const at = (k, shotName) => (m[k] ? Math.round((m[k] - windows[shotName][0]) * 100) / 100 : null)
  const laughSample = events.filter((e) => e.name === 'sample' && e.dur > 5 && e.t > m['ping-laugh'] - 0.5 && e.t < m['ping-laugh'] + 4)[0]
  product.at = {
    laughter: laughSample ? Math.round((laughSample.t - windows.laugh[0]) * 100) / 100 : 2.0,
    smile: Math.round((m['ping-laugh'] + filmSmileMs / 1000 - windows.laugh[0]) * 100) / 100,
    bird: at('bird-1', 'dose'),
    miniLaugh: at('mini-laugh', 'mini'),
    miniBreathe: at('mini-breathe', 'mini'),
    learned: at('view-learned', 'after'),
    // the moment the wireframe face lights up on the big screen, in the laugh shot and in the re-measure
    faceLit: litAt('stage-laugh', rects.laugh?.['.sg-facebox']),
    faceLit2: litAt('stage-mini', rects['mini-laugh']?.['.sg-facebox']),
  }
  product.birds = Object.keys(m).filter((k) => k.startsWith('bird-')).length
} finally {
  alive = false
  await person.catch(() => {})
  await stageWatch.catch(() => {})
  for (const k of Object.keys(live)) await cut(k).catch(() => {})
  if (!product.ping) await collect()
  const meta = { at: new Date().toISOString(), base, name, warm, airpods, stageScale, phoneScale, stageLag, wantDose, usualSmileMs, filmSmileMs, filmNod, filmSwing, videos, marks, rects, product, errors: errors.slice(0, 40), events }
  writeFileSync(`${out}/meta.json`, JSON.stringify(meta, null, 1))
  writeFileSync(`${out}/cap.js`, `window.__CAP = ${JSON.stringify({ at: meta.at, base, name, stageScale, videos, rects, product })}\n`)
  await browser.close().catch(() => {})
  await desk.close().catch(() => {})
}
for (const [f, v] of Object.entries(videos)) console.log(f.padEnd(16), `${v.seconds}s`.padEnd(8), `${(v.frames / v.seconds).toFixed(1)} fps`)
console.log('product', JSON.stringify(product).slice(0, 3000))
if (errors.length) console.log('errors', errors.slice(0, 12))
