#!/usr/bin/env node
// Runs the shipped sensing pipeline on video files: headless Chrome opens /#/lab with the file as its camera
// (same flags and page as web/tests/sense/lab-e2e.mjs), taps Start and records every face and pulse sample
// the pipeline emits, each tied to the video frame it came from (frame stamp, see stamp_y4m.py).
//
//   node validation/run_lab.mjs --jobs jobs.jsonl --out /bulk2/runs/depression/validation/raw/<tag> \
//        --url http://127.0.0.1:5872/v0/ --parallel 14
//
// jobs.jsonl: one JSON object per line: { "id": "...", "video": "/abs/file.y4m", "frames": N, "fps": F, "loops": 1, "warp": 1 }
// Output: <out>/<id>.json with the raw series. One browser per job (the fake camera file is a browser flag).
//
// warp: the shared test server is often too loaded to run the face model at camera rate. With "warp": W the
// camera file is one that plays W times slower than it was recorded (its y4m header says native fps / W) and the
// page's clock (performance.now and the video frame callback times) is slowed by the same W, so the pipeline
// sees a camera at its native frame rate and a device that keeps up with it. Nothing in the app is changed.
// "fps" is the real delivery rate of the file (native / W). Frame-rate numbers from warped runs mean nothing;
// model time is reported in real milliseconds.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
)
const base = args.url ?? 'http://127.0.0.1:5872/v0/'
const outDir = args.out
const parallel = Number(args.parallel ?? 12)
if (!args.jobs || !outDir) throw new Error('--jobs and --out are required')
mkdirSync(outDir, { recursive: true })
const jobs = readFileSync(args.jobs, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

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

async function runJob(job) {
  const outFile = path.join(outDir, `${job.id}.json`)
  if (existsSync(outFile) && !args.force) return 'have'
  if (!existsSync(job.video)) throw new Error(`missing ${job.video}`)
  const flags = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    `--use-file-for-fake-video-capture=${job.video}`,
  ]
  const browser = await chromium.launch({ headless: true, args: flags })
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] })
    const warp = job.warp ?? 1
    if (warp !== 1) {
      await ctx.addInitScript((W) => {
        const real = performance.now.bind(performance)
        const t0 = real()
        const w = (t) => t0 + (t - t0) / W
        performance.now = () => w(real())
        const proto = HTMLVideoElement.prototype
        const rvfc = proto.requestVideoFrameCallback
        if (rvfc) {
          proto.requestVideoFrameCallback = function (cb) {
            return rvfc.call(this, (now, meta) => {
              const m = { ...meta }
              for (const k of ['captureTime', 'presentationTime', 'expectedDisplayTime', 'receiveTime']) if (typeof m[k] === 'number') m[k] = w(m[k])
              cb(w(now), m)
            })
          }
        }
        const raf = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (cb) => raf((now) => cb(w(now)))
      }, warp)
    }
    const page = await ctx.newPage()
    const logs = []
    page.on('console', (m) => {
      const t = m.text()
      if (m.type() === 'error' || m.type() === 'warning' || t.includes('[sense]')) logs.push(`${m.type()}: ${t.slice(0, 300)}`)
    })
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
    // camera only: the datasets have no sound, and Chrome's fake microphone beeps
    const url = `${base}?audio=0${job.query ?? ''}#/lab`
    const t0 = Date.now()
    await page.goto(url, { waitUntil: 'load' })
    await page.click('[data-testid=start]')
    await page.waitForFunction(() => window.__vireLab?.sense.debug().running, null, { timeout: 90000 })
    const startMs = Date.now() - t0
    const frames = job.frames
    const loops = job.loops ?? 1
    const fps = job.fps ?? 30
    const timeoutMs = ((frames * loops) / fps) * 1000 * 1.5 + 30000
    const cap = await page.evaluate(
      ({ frames, loops, timeoutMs }) =>
        new Promise((resolve) => {
          const s = window.__vireLab.sense
          const video = document.querySelector('video')
          const cv = document.createElement('canvas')
          cv.width = 128
          cv.height = 16
          const cx = cv.getContext('2d', { willReadFrequently: true })
          const stamp = () => {
            try {
              cx.drawImage(video, 0, 0, 128, 16, 0, 0, 128, 16)
              const d = cx.getImageData(0, 0, 128, 16).data
              let n = 0
              for (let i = 0; i < 16; i++) {
                const a = d[(4 * 128 + 8 * i + 4) * 4 + 1] > 128 ? 1 : 0
                const b = d[(12 * 128 + 8 * i + 4) * 4 + 1] > 128 ? 1 : 0
                if (a === b) return -1
                n = (n << 1) | a
              }
              return n
            } catch {
              return -1
            }
          }
          const out = { face: [], pulse: [], wraps: 0 }
          let last = -1
          let done = false
          const finish = (why) => {
            if (done) return
            done = true
            offF()
            offP()
            out.why = why
            out.dbg = s.debug()
            resolve(out)
          }
          const r3 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
          const offF = s.on('face', (f) => {
            const k = stamp()
            const d = s.debug()
            if (k >= 0 && last >= 0 && k < last - 5) out.wraps++
            if (k >= 0) last = k
            const rgb = d.rgb ?? [null, null, null]
            // t, frame, loop, present, smile, cheek, jawOpen, blink, pitch, yaw, roll, gate, snrDb, r, g, b, faceW, cx, cy, modelMs
            out.face.push([r3(f.t), k, out.wraps, f.present ? 1 : 0, r3(f.smile), r3(f.cheek), r3(f.jawOpen), r3(f.blink), r3(f.pitch), r3(f.yaw), r3(f.roll), r3(d.pulseGate), r3(d.pulseSnrDb), r3(rgb[0]), r3(rgb[1]), r3(rgb[2]), r3(d.faceW), r3(d.faceCx), r3(d.faceCy), r3(d.modelMs)])
            if (out.wraps >= loops || (out.wraps === loops - 1 && k >= frames - 2)) finish('end')
          })
          // t, bpm, quality, wave
          const offP = s.on('pulse', (p) => out.pulse.push([r3(p.t), r3(p.bpm), r3(p.quality), r3(p.wave)]))
          setTimeout(() => finish('timeout'), timeoutMs)
        }),
      { frames, loops, timeoutMs },
    )
    const d = cap.dbg
    const res = {
      id: job.id,
      job,
      url,
      startMs,
      why: cap.why,
      warp,
      perf: { fps: d.fps, frameMs: d.frameMs * warp, frameMsP95: d.frameMsP95 * warp, modelMs: d.modelMs * warp, delegate: d.delegate, video: `${d.videoW}x${d.videoH}` },
      faceCols: ['t', 'frame', 'loop', 'present', 'smile', 'cheek', 'jawOpen', 'blink', 'pitch', 'yaw', 'roll', 'gate', 'snrDb', 'r', 'g', 'b', 'faceW', 'cx', 'cy', 'modelMs'],
      pulseCols: ['t', 'bpm', 'quality', 'wave'],
      face: cap.face,
      pulse: cap.pulse,
      logs: logs.slice(0, 20),
    }
    writeFileSync(outFile, JSON.stringify(res))
    return `${cap.why} ${cap.face.length} samples, ${d.fps.toFixed(1)} fps, ${d.delegate}, start ${startMs} ms`
  } finally {
    await browser.close().catch(() => {})
  }
}

let next = 0
let failed = 0
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++]
    try {
      const msg = await runJob(job)
      console.log(`${job.id}: ${msg}`)
    } catch (err) {
      failed++
      console.log(`${job.id}: FAILED ${String(err?.message ?? err).slice(0, 300)}`)
    }
  }
}
await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
console.log(`done: ${jobs.length - failed}/${jobs.length}`)
process.exit(failed ? 1 : 0)
