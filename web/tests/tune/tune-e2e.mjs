#!/usr/bin/env node
// The tune step on real pixels: /#/tune in a headless browser, with a camera made of clips of a real face that changes
// when the prompt changes (see fake-camera.mjs). Takes a screenshot of every step, then checks the trained reader
// against takes the step never showed, and appends one line to <out>/e2e.jsonl.
//   node tests/tune/tune-e2e.mjs [--set ravdess|commons] [--size phone|1080p] [--airpods sim|noise]
//                                [--base http://127.0.0.1:5876/] [--out /bulk2/runs/depression/tune/] [--react 700] [--shots 0]
import { appendFileSync, mkdirSync } from 'node:fs'
import { SETS, filesOf, installCamera, launch } from './fake-camera.mjs'

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : def
}
const setName = arg('set', 'commons')
const size = arg('size', 'phone')
const airpods = arg('airpods', '')
const base = arg('base', 'http://127.0.0.1:5876/').replace(/\/?$/, '/')
const out = arg('out', '/bulk2/runs/depression/tune/').replace(/\/?$/, '/')
const react = Number(arg('react', '700'))
const wantShots = arg('shots', '1') !== '0'
const set = SETS[setName]
const tag = `${setName}-${size}${airpods ? '-' + airpods : ''}`
const shotDir = `${out}flow/${tag}/`
mkdirSync(shotDir, { recursive: true })

const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  '1080p': { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
}
const b = await launch()
const ctx = await b.newContext(SIZES[size])
await installCamera(ctx, filesOf(set))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error' && !/XNNPACK|GL Driver|vo-tune|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200))
})
let n = 0
const shot = async (name) => {
  if (wantShots) await page.screenshot({ path: `${shotDir}${String(++n).padStart(2, '0')}-${name}.png` })
}
const press = (sel) => (size === 'phone' ? page.tap(sel) : page.click(sel))
const show = (take) => page.evaluate(([f, from, to, start]) => window.__cam.play(f, from, to, start ?? from), take)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(`${base}#/tune?flow=1${airpods ? '&airpods=' + airpods : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction(() => !!window.__tune && !!window.__cam, null, { timeout: 120000 })
await page.evaluate(() => window.__cam.load())
await show(set.takes.rest[0])
await page.waitForSelector('.vt-flow[data-screen="intro"]', { timeout: 120000 })
await page.waitForFunction(() => window.__tune.sense.latest().face?.present === true, null, { timeout: 120000 })
await sleep(1200)
await shot('intro')
const t0 = Date.now()
await press('[data-testid="tune-start"]')

// the person: sees a new prompt, and `react` ms later changes their face
const steps = []
let last = -1
let trainingShot = false
const laps = {}
for (;;) {
  if (Date.now() - t0 > 180000) throw new Error('the tune step did not finish in 3 minutes')
  const s = await page.evaluate(() => {
    const el = document.querySelector('.vt-flow')
    const ring = document.querySelector('.vt-ring-fill')
    return el ? { screen: el.dataset.screen, step: el.dataset.step, state: el.dataset.state, index: Number(el.dataset.index), progress: 1 - Number(ring?.style.strokeDashoffset || 1) } : null
  })
  if (!s) throw new Error('the flow went away')
  const t = Date.now() - t0
  if (s.screen === 'run' && s.index >= 0 && s.index !== last) {
    last = s.index
    const lap = (laps[s.step] = (laps[s.step] ?? -1) + 1)
    const takes = set.takes[s.step]
    const take = takes[Math.min(lap, takes.length - 1)]
    steps.push({ face: s.step, lap, clip: take[0], asked: t, hold: null, shot: false })
    setTimeout(() => void show(take).catch(() => {}), react)
  }
  const cur = steps[steps.length - 1]
  if (cur && s.screen === 'run' && s.index === last) {
    if (s.state === 'hold' && cur.hold === null) cur.hold = t
    if (cur.wait === undefined && s.state === 'wait' && t - cur.asked > 250 && (last === 1 || last === 2)) {
      cur.wait = t
      await shot(`${cur.face}-${cur.lap + 1}-waiting`)
    }
    if (!cur.shot && s.state === 'hold' && s.progress > 0.45) {
      cur.shot = true
      await shot(`${cur.face}-${cur.lap + 1}`)
    }
  }
  if (s.screen === 'training' && !trainingShot) {
    trainingShot = true
    if (cur) cur.end = t
    await sleep(400)
    await shot('training')
  }
  if (s.screen === 'result') break
  await sleep(40)
}
const took = Date.now() - t0
for (let i = 0; i < steps.length - 1; i++) steps[i].end = steps[i + 1].asked
// steps where the count only started on the timeout
const late = steps.filter((s) => s.hold !== null && s.hold - s.asked >= 3400).map((s) => `${s.face}-${s.lap + 1}`)

// the result screen, with the face at rest and then smiling
await show(set.takes.rest[0])
await sleep(1800)
await shot('result-rest')
const readRest = await page.textContent('.vt-read b')
await show(set.unseen.smile ?? set.takes.smile[0])
await sleep(2200)
await shot('result-smile')
const readSmile = await page.textContent('.vt-read b')
const accuracyLine = await page.textContent('[data-testid="tune-accuracy"]')
const earLine = (await page.locator('[data-testid="tune-ear"] p').count()) ? await page.textContent('[data-testid="tune-ear"] p') : null
if (size === 'phone') {
  await page.evaluate(() => document.querySelector('.vt-body')?.scrollTo(0, 99999))
  await sleep(300)
  await shot('result-scrolled')
}
await press('[data-testid="tune-done"]')
await page.waitForSelector('.vt-lab-side [data-testid="lab-model"]', { timeout: 20000 })
const model = await page.evaluate(() => window.__tune.model())

// the saved model, read live: every face again, on a take the tune step never showed where there is one
const reads = {}
for (const face of Object.keys(set.takes)) {
  const take = set.unseen[face] ?? set.takes[face][set.takes[face].length - 1]
  await show(take)
  await sleep(1300)
  const tally = {}
  const muscles = new Array(8).fill(0)
  let k = 0
  for (let i = 0; i < 22; i++) {
    const now = await page.evaluate(() => ({ face: window.__tune.now.face, muscles: window.__tune.now.muscles, ear: window.__tune.now.ear }))
    const label = (now.face || 'not sure').split(' ')[0]
    tally[label] = (tally[label] ?? 0) + 1
    if (now.muscles) {
      now.muscles.forEach((v, j) => (muscles[j] += v))
      k++
    }
    await sleep(100)
  }
  reads[face] = { clip: take[0], unseen: !!set.unseen[face], tally, muscles: muscles.map((v) => Math.round((v / Math.max(1, k)) * 100) / 100) }
  if (face === 'smile' || face === 'surprised') await shot(`lab-${face}`)
}
const right = Object.entries(reads).reduce((a, [face, r]) => a + (r.tally[face] ?? 0), 0)
const all = Object.values(reads).reduce((a, r) => a + Object.values(r.tally).reduce((x, y) => x + y, 0), 0)

const line = {
  at: new Date().toISOString(),
  set: setName,
  size,
  airpods: airpods || null,
  tookMs: took,
  late,
  steps: steps.map((s) => ({ face: s.face, lap: s.lap + 1, waitMs: s.hold === null ? null : s.hold - s.asked, totalMs: (s.end ?? took) - s.asked })),
  accuracy: model?.accuracy,
  holdout: model?.holdout,
  heldOut: model?.heldOut,
  frames: model?.frames,
  perFace: model?.perFace,
  calibration: model?.calibration,
  muscles: model?.muscles,
  trainMs: model?.trainMs,
  bytes: JSON.stringify(model ?? null).length,
  earAccuracy: model?.earAccuracy ?? null,
  earCheck: model?.earCheck ?? null,
  screen: { accuracyLine, earLine, readRest, readSmile },
  liveReads: reads,
  liveRight: all ? Math.round((right / all) * 1000) / 1000 : null,
  errors,
}
appendFileSync(`${out}e2e.jsonl`, JSON.stringify(line) + '\n')
console.log(`${tag}: ${(took / 1000).toFixed(1)} s from Start to result; late: ${late.join(', ') || 'none'}`)
console.log(`  screen: "${accuracyLine}"${earLine ? ` / "${earLine}"` : ''} | rest reads "${readRest}", smile reads "${readSmile}"`)
console.log(`  model: held-out ${model?.accuracy} (${model?.holdout}, ${model?.heldOut} of ${model?.frames} frames), per face ${JSON.stringify(model?.perFace)}, trained in ${model?.trainMs} ms, ${line.bytes} bytes`)
console.log(`  ranges: smile ${JSON.stringify(model?.calibration?.smile)} brow ${JSON.stringify(model?.calibration?.brow)}; ear ${JSON.stringify(model?.earCheck ?? null)} -> ${model?.earAccuracy ?? null}`)
for (const [face, r] of Object.entries(reads)) console.log(`  live ${face.padEnd(9)} ${r.unseen ? 'unseen take' : 'seen clip  '} ${JSON.stringify(r.tally)} muscles ${r.muscles.join(' ')}`)
console.log(`  live reads right: ${line.liveRight}; steps: ${line.steps.map((s) => `${s.face}${s.lap} ${s.waitMs}+${s.totalMs - (s.waitMs ?? 0)}`).join(', ')}`)
if (errors.length) console.log('  page errors:', errors.slice(0, 5))
console.log(`  screenshots: ${shotDir}`)
await b.close()
