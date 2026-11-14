#!/usr/bin/env node
// What the model sees in each clip, frame by frame: plays every clip of a set once through the real camera path
// (/#/tune, MediaPipe in the page) and writes one line per clip with the observations over the clip's own time.
// Used to pick the part of each clip where the face is on, and to set the tune step's "is the face there" thresholds.
//   node tests/tune/clip-scan.mjs [ravdess|commons] [baseUrl] [out.jsonl]
import { writeFileSync } from 'node:fs'
import { SETS, filesOf, installCamera, launch } from './fake-camera.mjs'

const setName = process.argv[2] ?? 'ravdess'
const base = (process.argv[3] ?? 'http://127.0.0.1:5876/').replace(/\/?$/, '/')
const out = process.argv[4] ?? `/bulk2/runs/depression/tune/work/scan-${setName}.jsonl`
const set = SETS[setName]
const files = filesOf(set)

const b = await launch()
const ctx = await b.newContext({ viewport: { width: 900, height: 700 } })
await installCamera(ctx, files)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)))
await page.goto(base + '#/tune?auto=1', { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction(() => !!window.__tune, null, { timeout: 120000 })
await page.evaluate(() => window.__cam.load())
await page.waitForSelector('.vt-lab[data-phase="on"]', { timeout: 120000 })
const lines = []
for (const name of Object.keys(files)) {
  const rows = await page.evaluate(async (n) => {
    const cam = window.__cam
    const tune = window.__tune
    const rows = []
    const off = tune.sense.on('face', (f) => {
      const x = tune.now.x
      if (f.present && x) rows.push([Math.round(cam.time() * 1000) / 1000, ...Array.from(x, (v) => Math.round(v * 1e4) / 1e4)])
    })
    cam.play(n)
    const d = cam.duration(n)
    await new Promise((res) => setTimeout(res, d * 1000 - 120))
    off()
    return rows
  }, name)
  lines.push(JSON.stringify({ clip: name, set: setName, rows }))
  console.log(name, rows.length, 'frames')
}
writeFileSync(out, lines.join('\n') + '\n')
console.log('wrote', out)
await b.close()
