#!/usr/bin/env node
// Headless Chrome run of /#/lab against a fake camera (+ mic) file. Prints one JSON report.
//
//   node tests/sense/lab-e2e.mjs --video talk.mjpeg --audio talk.wav --seconds 30
//   node tests/sense/lab-e2e.mjs --video swing66.y4m --ping full
//
// --video / --audio   file names inside FIXTURES (default /bulk2/runs/depression/sense-fixtures; see make-fixtures.sh)
// --seconds N         how long to watch the live streams (default 25)
// --ping full|mini    also run a recording through the lab buttons and report the features
// --smile-loop S      smile.mjpeg check: the fixture shows one smile every S seconds. Finds a smile onset, then records
//                     settle 8 s + laugh 8 s + breathe 10 s with the laughter onset placed 1500 ms before the next smile.
// --url               lab URL (default http://127.0.0.1:5872/#/lab)
// --chrome            'pw' (Playwright chromium, default) or a path such as /usr/bin/google-chrome
// --shot file.png     save a screenshot at the end
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
)
const FIXTURES = process.env.FIXTURES ?? '/bulk2/runs/depression/sense-fixtures'
const url = args.url ?? 'http://127.0.0.1:5872/#/lab'
const seconds = Number(args.seconds ?? 25)

const require = createRequire(import.meta.url)
let chromium
for (const p of ['playwright', '/home/ubuntu/.local/lib/node_modules/playwright']) {
  try {
    chromium = require(p).chromium
    break
  } catch {
    /* next */
  }
}
if (!chromium) throw new Error('playwright not found')

const fix = (f) => (path.isAbsolute(f) ? f : path.join(FIXTURES, f))
const flags = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader']
if (args.video) {
  if (!existsSync(fix(args.video))) throw new Error(`missing fixture ${fix(args.video)}`)
  flags.push(`--use-file-for-fake-video-capture=${fix(args.video)}`)
}
if (args.audio) flags.push(`--use-file-for-fake-audio-capture=${fix(args.audio)}`)
if (args.nogpu) flags.push('--disable-gpu')

const browser = await chromium.launch({ headless: true, args: flags, ...(args.chrome && args.chrome !== 'pw' ? { executablePath: args.chrome } : {}) })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] })
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' || m.type() === 'warning' || t.includes('[sense]')) logs.push(`${m.type()}: ${t.slice(0, 300)}`)
})
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

const t0 = Date.now()
await page.goto(url, { waitUntil: 'load' })
await page.click('[data-testid=start]')
try {
  await page.waitForFunction(() => window.__vireLab?.sense.debug().running, null, { timeout: 60000 })
} catch (err) {
  const error = await page.locator('[data-testid=error]').textContent().catch(() => null)
  console.log(JSON.stringify({ ok: false, error, logs }, null, 2))
  await browser.close()
  process.exit(1)
}
const startMs = Date.now() - t0

// collect every stream inside the page
await page.evaluate(() => {
  const s = window.__vireLab.sense
  const cap = (window.__cap = { face: [], head: [], pulse: [], voice: [], dbg: [], caps: [] })
  s.on('face', (f) => {
    const d = s.debug()
    cap.face.push([f.t, f.present ? 1 : 0, f.smile, f.cheek, f.brow, f.jawOpen, f.blink, f.pitch, f.yaw, f.roll, d.lmPitch, d.lmYaw, d.pulseGate, d.pulseSnrDb, ...(d.rgb ?? [0, 0, 0])])
  })
  s.on('head', (h) => cap.head.push([h.t, h.pitch, h.yaw, h.roll, h.source]))
  s.on('pulse', (p) => cap.pulse.push([p.t, p.bpm, p.quality, p.wave, p.source]))
  s.on('voice', (v) => cap.voice.push([v.t, v.rms, v.voiced ? 1 : 0, v.f0]))
  s.on('caps', (c) => cap.caps.push(c))
})

let ping = null
let smileCheck = null
if (args['smile-loop']) {
  smileCheck = await page.evaluate(async (L) => {
    const s = window.__vireLab.sense
    const onset = () =>
      new Promise((res) => {
        let armed = false
        const off = s.on('face', (f) => {
          if (f.smile < 0.03) armed = true
          else if (armed && f.smile > 0.15) {
            off()
            res(f.t)
          }
        })
      })
    const at = (t) => new Promise((r) => setTimeout(r, Math.max(0, t - performance.now())))
    const on1 = await onset()
    const on2 = await onset()
    const next = on2 + L // the smile passes 0.15 here
    await at(next - 2500 - 8000)
    s.beginRecording()
    s.mark('settle')
    await at(next - 2500)
    s.mark('laugh')
    await at(next - 1500)
    const laughOnsetT = performance.now()
    await at(next - 2500 + 8000)
    s.mark('breathe')
    await at(next - 2500 + 18000)
    const r = s.endRecording({ laughOnsetT })
    return { loopMeasuredMs: on2 - on1, expectedLatencyMs: next - laughOnsetT, features: r.features, cheekPeak: Math.max(...r.traces.cheek), smilePeakTrace: Math.max(...r.traces.smile) }
  }, Number(args['smile-loop']) * 1000)
} else if (args.ping) {
  const label = args.ping === 'mini' ? 'Run mini' : 'Run full ping'
  await page.getByRole('button', { name: new RegExp(label) }).click()
  await page.waitForSelector('[data-testid=features]', { timeout: 90000 })
  ping = await page.evaluate(() => window.__vireLab.lastResult.current)
} else {
  await page.waitForTimeout(seconds * 1000)
}

const out = await page.evaluate(() => ({ cap: window.__cap, dbg: window.__vireLab.sense.debug(), caps: window.__vireLab.sense.caps }))
if (args.shot) await page.screenshot({ path: args.shot, fullPage: true })

// stop must release the devices
await page.getByRole('button', { name: 'Stop' }).click()
const afterStop = await page.evaluate(() => {
  const v = document.querySelector('video')
  return { caps: window.__vireLab.sense.caps, srcObject: v?.srcObject === null, running: window.__vireLab.sense.debug().running }
})
await browser.close()

// ---- stats ----
const col = (rows, i) => rows.map((r) => r[i])
const fin = (a) => a.filter((x) => typeof x === 'number' && Number.isFinite(x))
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
const q = (a, p) => {
  const s = fin(a).sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null
}
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100)
const range = (a) => ({ min: r2(q(a, 0)), p5: r2(q(a, 0.05)), med: r2(q(a, 0.5)), p95: r2(q(a, 0.95)), max: r2(q(a, 0.999)) })
const corr = (a, b) => {
  const ma = mean(a)
  const mb = mean(b)
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return saa && sbb ? r2(sab / Math.sqrt(saa * sbb)) : null
}

const face = out.cap.face.filter((r) => r[1] === 1)
const ft = col(out.cap.face, 0)
const dts = ft.slice(1).map((t, i) => t - ft[i])
const pulse = out.cap.pulse
const bpmVals = fin(col(pulse, 1))
const voice = out.cap.voice
const voiced = voice.filter((r) => r[2] === 1)
const vt = col(voice, 0)
const report = {
  ok: true,
  video: args.video ?? '(chrome default pattern)',
  startMs,
  seconds: r2((ft[ft.length - 1] - ft[0]) / 1000),
  perf: { fps: r2(out.dbg.fps), frameMs: r2(out.dbg.frameMs), frameMsP95: r2(out.dbg.frameMsP95), modelMs: r2(out.dbg.modelMs), skinMs: r2(out.dbg.skinMs), delegate: out.dbg.delegate, video: `${out.dbg.videoW}x${out.dbg.videoH}`, frameIntervalMs: range(dts) },
  caps: out.caps,
  mic: out.dbg.micLabel,
  camera: out.dbg.cameraLabel,
  face: {
    frames: out.cap.face.length,
    presentFraction: r2(face.length / Math.max(1, out.cap.face.length)),
    smile: range(col(face, 2)),
    cheek: range(col(face, 3)),
    brow: range(col(face, 4)),
    jawOpen: range(col(face, 5)),
    blink: range(col(face, 6)),
    pitch: range(col(face, 7)),
    yaw: range(col(face, 8)),
    roll: range(col(face, 9)),
    lmPitch: range(col(face, 10)),
    lmYaw: range(col(face, 11)),
    corrPitchVsLandmarks: corr(col(face, 7), col(face, 10)),
    corrYawVsLandmarks: corr(col(face, 8), col(face, 11)),
    rgb: [r2(mean(col(face, 14))), r2(mean(col(face, 15))), r2(mean(col(face, 16)))],
  },
  head: { frames: out.cap.head.length, source: out.cap.head.at(-1)?.[4] ?? null },
  pulse: {
    samples: pulse.length,
    bpmNullFraction: r2(1 - bpmVals.length / Math.max(1, pulse.length)),
    bpm: range(bpmVals),
    bpmLast: r2(pulse.at(-1)?.[1] ?? null),
    quality: range(col(pulse, 2)),
    qualityLast: r2(pulse.at(-1)?.[2] ?? null),
    snrDb: range(fin(col(face, 13))),
    gate: range(col(face, 12)),
    wave: range(col(pulse, 3)),
    // bpm and quality every 2 s, to see the estimate settle
    timeline: pulse.filter((_, i) => i % 60 === 59).map((r) => `${r2((r[0] - pulse[0][0]) / 1000)}s ${r[1] === null ? 'null' : r[1].toFixed(1)} q${r[2].toFixed(2)}`),
  },
  voice: {
    mode: out.dbg.voiceMode,
    sampleRate: out.dbg.sampleRate,
    frames: voice.length,
    framesPerSecond: voice.length > 1 ? r2((voice.length - 1) / ((vt[vt.length - 1] - vt[0]) / 1000)) : 0,
    rms: range(col(voice, 1)),
    voicedFraction: r2(voiced.length / Math.max(1, voice.length)),
    f0: range(col(voiced, 3)),
  },
  ping,
  smileCheck,
  afterStop,
  logs: logs.slice(0, 12),
}
if (ping?.traces) report.ping = { features: ping.features, traceLen: ping.traces.t.length, phases: ping.traces.phases }
console.log(JSON.stringify(report, null, 2))
