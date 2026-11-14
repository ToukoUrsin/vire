#!/usr/bin/env node
// Safari-engine smoke test: Playwright WebKit has no fake camera, so getUserMedia is replaced by a canvas
// stream (a still face with a 72 bpm green tint) plus a 150 Hz tone. Everything after getUserMedia is the real code:
// MediaPipe on WebKit, requestVideoFrameCallback, the AudioWorklet, the pulse chain.
//   node tests/sense/lab-webkit.mjs [--deny] [--seconds 25] [--engine webkit|chromium]
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const pw = require('/home/ubuntu/.local/lib/node_modules/playwright')
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []))
const FIXTURES = process.env.FIXTURES ?? '/bulk2/runs/depression/sense-fixtures'
const engine = args.engine ?? 'webkit'
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
const logs = []
page.on('console', (m) => (m.type() === 'error' || m.text().includes('[sense]')) && logs.push(`${m.type()}: ${m.text().slice(0, 240)}`))
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
if (!args.deny) {
  const jpeg = `data:image/jpeg;base64,${readFileSync(`${FIXTURES}/still.jpg`).toString('base64')}`
  await page.addInitScript((jpeg) => {
    window.__shim = { tracks: [] }
    // patch the prototype: WebKit drops properties set on the navigator.mediaDevices wrapper when it is collected
    MediaDevices.prototype.enumerateDevices = async () => []
    MediaDevices.prototype.getUserMedia = async (c) => {
      const img = new Image()
      img.src = jpeg
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = 480
      cv.height = 640
      const g = cv.getContext('2d')
      const t0 = performance.now()
      const draw = () => {
        g.globalAlpha = 1
        g.drawImage(img, 0, 0)
        g.fillStyle = `rgba(0,255,0,${0.02 * (1 + Math.cos((2 * Math.PI * 1.2 * (performance.now() - t0)) / 1000))})`
        g.fillRect(0, 0, 480, 640)
        window.__shim.raf = requestAnimationFrame(draw)
      }
      draw()
      const tracks = [...cv.captureStream(30).getVideoTracks()]
      if (c.audio) {
        const ac = new (window.AudioContext ?? window.webkitAudioContext)()
        void ac.resume()
        const osc = ac.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = 150
        const gain = ac.createGain()
        gain.gain.value = 0.1
        const dest = ac.createMediaStreamDestination()
        osc.connect(gain).connect(dest)
        osc.start()
        tracks.push(...dest.stream.getAudioTracks())
      }
      window.__shim.tracks.push(...tracks)
      return new MediaStream(tracks)
    }
  }, jpeg)
}
await page.goto(args.url ?? 'http://127.0.0.1:5872/#/lab', { waitUntil: 'load' })
const features = await page.evaluate(() => ({
  ua: navigator.userAgent,
  rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  audioWorklet: typeof AudioWorkletNode !== 'undefined',
  mediaDevices: !!navigator.mediaDevices?.getUserMedia,
}))
await page.click('[data-testid=start]')
const started = await page
  .waitForFunction(() => window.__vireLab?.sense.debug().running || document.querySelector('[data-testid=error]'), null, { timeout: 60000 })
  .then(() => true, () => false)
const error = await page.locator('[data-testid=error]').textContent({ timeout: 500 }).catch(() => null)
let out = null
if (started && !error) {
  await page.evaluate(() => {
    const s = window.__vireLab.sense
    const cap = (window.__cap = { face: [], pulse: [], voice: [] })
    s.on('face', (f) => cap.face.push([f.t, f.present ? 1 : 0, f.smile, f.pitch, f.yaw]))
    s.on('pulse', (p) => cap.pulse.push([p.t, p.bpm, p.quality]))
    s.on('voice', (v) => cap.voice.push([v.t, v.rms, v.voiced ? 1 : 0, v.f0]))
  })
  await page.waitForTimeout(Number(args.seconds ?? 25) * 1000)
  out = await page.evaluate(() => {
    const c = window.__cap
    const d = window.__vireLab.sense.debug()
    const f0 = c.voice.map((v) => v[3]).filter((x) => x !== null).sort((a, b) => a - b)
    const last = c.pulse.at(-1)
    return {
      dbg: { fps: +d.fps.toFixed(1), frameMs: +d.frameMs.toFixed(1), modelMs: +d.modelMs.toFixed(1), skinMs: +d.skinMs.toFixed(1), delegate: d.delegate, voiceMode: d.voiceMode, sampleRate: d.sampleRate, video: `${d.videoW}x${d.videoH}` },
      caps: window.__vireLab.sense.caps,
      faceFrames: c.face.length,
      facePresent: c.face.filter((f) => f[1]).length,
      pose: c.face.length ? { pitch: +c.face.at(-1)[3].toFixed(1), yaw: +c.face.at(-1)[4].toFixed(1) } : null,
      pulseLast: last ? { bpm: last[1], quality: +last[2].toFixed(2) } : null,
      voiceFrames: c.voice.length,
      voicedFraction: c.voice.length ? +(c.voice.filter((v) => v[2]).length / c.voice.length).toFixed(2) : 0,
      f0Median: f0.length ? +f0[f0.length >> 1].toFixed(1) : null,
      rmsLast: c.voice.at(-1)?.[1] ?? null,
    }
  })
  await page.getByRole('button', { name: 'Stop' }).click()
  out.afterStop = await page.evaluate(() => ({ caps: window.__vireLab.sense.caps, tracks: window.__shim.tracks.map((t) => t.readyState) }))
}
await browser.close()
console.log(JSON.stringify({ engine, features, started, error, out, logs: logs.slice(0, 10) }, null, 1))
