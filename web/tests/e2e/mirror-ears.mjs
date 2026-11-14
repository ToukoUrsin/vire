#!/usr/bin/env node
// The big-screen mirror (#/clinic/live) shows the Modal search for a person's ear model, live, from
// GET /api/ear/jobs/latest. This plays a whole search through the worker endpoints (no Modal): three minutes stored
// under one device key, then claim, progress, done and landed; then a demo-signals search and a failed one.
// The board rows and the model come from a real local run of searchEarModel over simulated minutes.
//   node web/tests/e2e/mirror-ears.mjs [pageUrl] [apiUrl] [outDir]
// The API must run with VIRE_WORKER_TOKEN=lead-test and should be a test instance of its own (the newest job is global).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')

const base = (process.argv[2] ?? 'http://127.0.0.1:5889/').replace(/\/?$/, '/')
const apiBase = (process.argv[3] ?? 'http://127.0.0.1:8879').replace(/\/$/, '')
const out = (process.argv[4] ?? '/bulk3/runs/depression/live-board').replace(/\/?$/, '/')
const web = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
mkdirSync(out, { recursive: true })

// ---- the fixture: three simulated minutes and a real search over them (about a minute of CPU, so kept) ----
const fixturePath = `${out}fixture-v1.json`
if (!existsSync(fixturePath)) {
  console.log('making the fixture: a local search over three simulated minutes')
  const code = `
    import { simulateTeach, searchEarModel, trainEarModel } from './src/tune/ear/index.ts'
    import { writeFileSync } from 'node:fs'
    const day = Date.parse('2026-11-14T09:00:00Z')
    const recs = [1, 2, 3].map((s) => simulateTeach({ seed: s, hz: 50, smileSize: 0.8 + s * 0.1, at: new Date(day + s * 600000).toISOString() }))
    const tried = []
    const found = searchEarModel(recs, { maxCandidates: 24, onTried: (t) => tried.push(t) })
    const quick = trainEarModel(recs[0])
    const demo = simulateTeach({ seed: 9, hz: 50, at: new Date(day + 7200000).toISOString() })
    writeFileSync(process.env.FIXTURE, JSON.stringify({ recs, tried, found, quick, demo, demoModel: trainEarModel(demo) }))
  `
  execFileSync('bun', ['-e', code], { cwd: web, stdio: 'inherit', timeout: 600_000, env: { ...process.env, FIXTURE: fixturePath } })
}
const fx = JSON.parse(readFileSync(fixturePath, 'utf8'))

// The person path: the same simulated minutes, marked as read on an iPhone so the screen's wording for a real person
// can be checked. The demo run below keeps shell 'sim' and must say "Demo signals".
const asPerson = (r) => ({ ...r, device: { ...r.device, shell: 'ios' } })
const personModel = (m) => ({ ...m, shell: 'ios', by: 'sandbox' })

const worker = { authorization: 'Bearer lead-test', 'content-type': 'application/json' }
const call = async (method, path, body, headers = worker) => {
  const res = await fetch(`${apiBase}/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok && res.status !== 204) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}
const store = (recording, key) => call('POST', 'ear/recordings', { recording, key }, { 'content-type': 'application/json' })
const claimMine = async (id) => {
  // claim takes the oldest waiting job: finish any other one first, so the search on screen is ours
  for (let i = 0; i < 20; i++) {
    const job = await call('POST', 'ear/jobs/claim', {})
    if (!job) throw new Error(`job ${id} was never claimed`)
    if (job.id === id) return job
    await call('POST', `ear/jobs/${job.id}/done`, { error: 'cleared by the mirror test' })
  }
  throw new Error('too many waiting jobs')
}
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')

const errors = []
const fail = (why) => {
  console.log(`FAIL ${why}`)
  errors.push(why)
}
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 220)}`))
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${String(e).slice(0, 220)}`))

let n = 0
const shot = async (name) => {
  const path = `${out}${String(++n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path })
  console.log(`shot ${path}`)
}
const text = () => page.locator('.sg').innerText()
const waitText = async (re, what) => {
  try {
    await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.sg')?.textContent ?? ''), re.source, { timeout: 15000 })
  } catch {
    fail(`${what}: never saw ${re} (screen: ${(await text()).replace(/\s+/g, ' ').slice(0, 300)})`)
  }
}
const noLaughTalk = async (where) => {
  const t = await text()
  if (/\b(laugh|talk)/i.test(t.replace(/We play laughter[^.]*\./, ''))) fail(`${where}: the screen names laugh or talk`)
}

try {
  // ---- a phone in the middle of the teaching minute leads over any search on the screen ----
  await page.goto(`${base}#/clinic/live/EARS9`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sg', { timeout: 60000 })
  await page.evaluate(() => new Promise((ok, no) => {
    const u = new URL('/api/live?room=EARS9&role=sensor&name=Mirror%20test', location.href)
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(u)
    ws.onopen = () => { window.__ws = ws; ws.send(JSON.stringify({ type: 'hello', role: 'sensor', name: 'Mirror test' })); ok(true) }
    ws.onerror = no
  }))
  const relay = (m) => page.evaluate((x) => window.__ws.send(JSON.stringify(x)), m)
  await relay({ type: 'teach', state: 'step', ask: 'nod', say: 'Nod', index: 3, of: 10 })
  for (let i = 0; i < 30; i++) {
    await relay({ type: 'frame', t: Date.now(), phase: 'idle', smile: 0.3 + 0.3 * Math.sin(i / 3), cheek: 0.2, pitch: 12 * Math.sin(i / 2), yaw: 2, roll: 0, bpm: null, wave: 0, rms: -40, f0: null, camera: true, headSource: 'airpods' })
    await page.waitForTimeout(60)
  }
  await page.waitForSelector('.sg-teaching', { timeout: 15000 }).catch(() => fail('teach: the teaching minute did not lead'))
  await noLaughTalk('teach')
  await shot('teach-step')
  await page.evaluate(() => window.__ws.close())

  // ---- two earlier minutes of one device, their searches done and over ----
  const key = hex()
  const [r1, r2, r3] = fx.recs.map(asPerson)
  for (const r of [r1, r2]) {
    const kept = await store(r, key)
    await claimMine(kept.jobId)
    await call('POST', `ear/jobs/${kept.jobId}/done`, { model: personModel(fx.quick), board: fx.tried.slice(0, 3) })
  }

  await page.goto(`${base}#/clinic/live`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sg', { timeout: 60000 })

  // ---- the third minute arrives: waiting for a sandbox, nothing tried, no rows ----
  const kept = await store(r3, key)
  const id = kept.jobId
  await page.waitForSelector('.sg-search[data-state="queued"]', { timeout: 15000 })
  await page.waitForTimeout(1200)
  {
    const t = await text()
    if (!/Waiting for a Modal sandbox/.test(t)) fail('queued: should say it waits for a sandbox')
    if (/Searching|trying models/i.test(t)) fail('queued: must not say it is searching')
    if ((await page.locator('.sg-sr-board li').count()) !== 0) fail('queued: rows shown before any were tried')
  }
  await shot('queued')

  // ---- running: the board fills in, best on top ----
  const job = await claimMine(id)
  if (job.minutes?.length !== 3) fail(`the search should learn from 3 minutes, got ${job.minutes?.length}`)
  await page.waitForSelector('.sg-search[data-state="running"]', { timeout: 15000 })
  await waitText(/Modal is trying models on 3 minutes/, 'running')
  await shot('running-empty')
  const steps = [3, 8, 15, fx.tried.length]
  for (const [i, k] of steps.entries()) {
    const so = await call('POST', `ear/jobs/${id}/progress`, { tried: fx.tried.slice(0, k), seconds: 4 + i * 9 })
    await page.waitForFunction((tried) => document.querySelector('[data-tried]')?.textContent === String(tried), so.tried, { timeout: 15000 }).catch(() => fail(`running: count ${so.tried} never shown`))
    await page.waitForTimeout(700)
    const rows = await page.locator('.sg-sr-board li').count()
    if (rows !== so.board.length) fail(`running: ${rows} rows on screen, the endpoint has ${so.board.length}`)
    const first = await page.locator('.sg-sr-board li .sg-sr-name').first().innerText()
    // the screen says the sensor words plainly (attitude is "angles"); otherwise the row is the endpoint's own
    const plain = (n) => n.replace(', attitude', ', angles').replace(', posture', ', angle shifts').replace(', rotation', ', turn rate').replace(', motion', ', angles and acceleration')
    if (first !== plain(so.board[0].name)) fail(`running: top row is "${first}", the endpoint's best is "${so.board[0].name}"`)
    if (i === 1 || i === 3) await shot(`running-${k}`)
  }
  await noLaughTalk('running')

  // ---- done: the best model and each thing's score ----
  const model = personModel(fx.found.model)
  await call('POST', `ear/jobs/${id}/done`, { model, board: fx.found.board })
  await page.waitForSelector('.sg-search[data-state="done"]', { timeout: 15000 })
  await waitText(new RegExp(`Modal tried ${model.tried} models on 3 minutes`), 'done')
  {
    const t = await text()
    if (!/on a whole minute it never saw/.test(t)) fail('done: should say each score is on a whole minute it never saw')
    if (/Demo signals/.test(t)) fail('done: a person path must not say demo signals')
    if (/AUC/i.test(t)) fail('done: jargon on screen')
    if (!/held-out score \d\.\d\d/.test(t)) fail('done: should say the held-out score, as the phone does')
    if (!/Today against their usual/.test(t)) fail('done: the minute against the usual is not on the screen')
    const want = Math.round(model.events.smile.score.auc * 10)
    const got = await page.locator('.sg-sr-scores li[data-event="smile"] .sg-sr-big').innerText()
    if (!got.startsWith(String(want))) fail(`done: smile shows "${got}", the model says ${want} in 10`)
    if (model.curve?.length >= 2 && !(await page.locator('.sg-sr-curve').count())) fail('done: the curve is missing')
  }
  await noLaughTalk('done')
  await shot('done')

  // ---- landed: the phone has it ----
  await call('POST', `ear/jobs/${id}/landed`, {})
  await page.waitForSelector('.sg-search[data-landed="1"]', { timeout: 15000 })
  await waitText(/The model is on the phone now/, 'landed')
  await page.waitForTimeout(1500)
  await shot('landed')

  // ---- demo signals: a model made from a script is never shown as learned from a person ----
  {
    const k = await store(fx.demo, hex())
    await claimMine(k.jobId)
    await call('POST', `ear/jobs/${k.jobId}/progress`, { tried: fx.tried.slice(0, 6), seconds: 3 })
    // a script's minute is called demo signals while the search still runs, not only once it is done
    await page.waitForSelector('.sg-search[data-state="running"] .sg-sr-demo', { timeout: 15000 }).catch(() => fail('demo: a running search over a script\'s minute does not say demo signals'))
    await call('POST', `ear/jobs/${k.jobId}/done`, { model: { ...fx.demoModel, by: 'sandbox' }, board: fx.tried.slice(0, 6) })
    await page.waitForSelector('.sg-search[data-state="done"] .sg-sr-demo', { timeout: 15000 }).catch(() => fail('demo: no demo signals note'))
    const t = await text()
    if (!/Demo signals/.test(t)) fail('demo: should say demo signals')
    if (/this person/i.test(t)) fail('demo: must not speak of a person')
    await page.waitForTimeout(800)
    await shot('demo')
  }

  // ---- failed: the phone keeps its own model ----
  {
    const k = await store(asPerson(fx.demo), hex())
    await claimMine(k.jobId)
    await call('POST', `ear/jobs/${k.jobId}/progress`, { tried: fx.tried.slice(0, 2), seconds: 2 })
    await call('POST', `ear/jobs/${k.jobId}/done`, { error: 'the sandbox ran out of time' })
    await page.waitForSelector('.sg-search[data-state="failed"]', { timeout: 15000 })
    await waitText(/The phone keeps its own model/, 'failed')
    await page.waitForTimeout(800)
    await shot('failed')
  }
} catch (e) {
  fail(`stopped: ${e instanceof Error ? e.message : String(e)}`)
  await shot('stopped').catch(() => {})
}

await browser.close()
writeFileSync(`${out}README.txt`, `Screens of node web/tests/e2e/mirror-ears.mjs ${base} ${apiBase}\n${new Date().toISOString()}\n`)
console.log(`MIRROR_ERRORS ${JSON.stringify([...new Set(errors)])}`)
if (errors.length) process.exitCode = 1
