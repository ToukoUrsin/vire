#!/usr/bin/env node
// The big screen (#/clinic/live?cohort=1) shows the whole clinic re-learning at once: one tile per simulated patient,
// from GET /api/ear/cohort/latest. This starts a run with the corner button, plays the worker through the endpoints
// (no Modal, no search: the numbers are made up here and checked on screen exactly), and checks the caps, the counts,
// what each done tile says helps that patient most (and the learned / leaning / too early tally), the "simulated patients" label, that a person's newer search takes the screen, and that nothing overflows at
// 1920x1080 or 1366x768.
//   node web/tests/e2e/cohort.mjs [pageUrl] [apiUrl] [outDir]
// The API must run with VIRE_WORKER_TOKEN=cohort-test and be a test instance of its own (the newest run is global).
// Set BROWSER=webkit when headless Chromium drops page loads here.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const pw = require('/home/ubuntu/.local/lib/node_modules/playwright')

const base = (process.argv[2] ?? 'http://127.0.0.1:5891/').replace(/\/?$/, '/')
const apiBase = (process.argv[3] ?? 'http://127.0.0.1:8881').replace(/\/$/, '')
const out = (process.argv[4] ?? '/bulk3/runs/depression/cohort/e2e').replace(/\/?$/, '/')
const web = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
mkdirSync(out, { recursive: true })

const worker = { authorization: 'Bearer cohort-test', 'content-type': 'application/json' }
const call = async (method, path, body, headers = worker) => {
  const res = await fetch(`${apiBase}/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const ok = async (method, path, body, headers) => {
  const r = await call(method, path, body, headers)
  if (r.status >= 300 && r.status !== 204) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  return r.body
}

const errors = []
const fail = (why) => {
  console.log(`FAIL ${why}`)
  errors.push(why)
}

// a run left going by an earlier try is finished first, so this one starts clean
{
  const latest = await call('GET', 'ear/cohort/latest')
  if (latest.body?.state === 'queued') {
    const c = await call('POST', 'ear/cohort/claim', {})
    if (c.body?.id) await call('POST', `ear/cohort/${c.body.id}/done`, { error: 'cleared by the cohort test' })
  } else if (latest.body?.state === 'running') await call('POST', `ear/cohort/${latest.body.id}/done`, { error: 'cleared by the cohort test' })
  if (latest.body?.at && Date.now() - latest.body.at < 121_000) {
    const wait = 121_000 - (Date.now() - latest.body.at)
    console.log(`waiting ${Math.ceil(wait / 1000)} s: the server keeps two minutes between runs`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

const kind = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium'
const browser = await pw[kind].launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('console', (m) => m.type() === 'error' && !/404|409|429|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 220)}`))
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
/** nothing of the scene outside the screen, and nothing cut off inside its own box */
const fits = async (where) => {
  const bad = await page.evaluate(() => {
    const out = []
    const W = innerWidth
    const H = innerHeight
    if (document.documentElement.scrollWidth > W + 1 || document.documentElement.scrollHeight > H + 1) out.push('the page scrolls')
    for (const el of document.querySelectorAll('.ch h1, .ch-sub, .ch-demo, .ch-stats, .ch-range, .ch-tile, .ch-board > header, .ch-start button')) {
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${el.className} off screen`)
    }
    const side = document.querySelector('.ch-side')
    if (side && side.scrollHeight > side.clientHeight + 2) out.push(`the left side is cut off (${side.scrollHeight} > ${side.clientHeight})`)
    const grid = document.querySelector('.ch-grid')
    if (grid && grid.scrollHeight > grid.clientHeight + 2) out.push('the grid is cut off')
    for (const t of document.querySelectorAll('.ch-tile')) if (t.scrollHeight > t.clientHeight + 2) { out.push(`tile ${t.dataset.n} is cut off`); break }
    // the words of what helps most are never cut short with an ellipsis
    for (const w of document.querySelectorAll('.ch-works b, .ch-works small')) {
      const range = document.createRange()
      range.selectNodeContents(w)
      // the text's own width, measured with the ellipsis turned off
      const was = w.style.textOverflow
      w.style.textOverflow = 'clip'
      const need = range.getBoundingClientRect().width
      w.style.textOverflow = was
      if (need > w.getBoundingClientRect().width + 0.5) { out.push(`tile words cut short: "${w.textContent}" (${need.toFixed(1)} > ${w.getBoundingClientRect().width.toFixed(1)})`); break }
    }
    const sum = document.querySelector('.ch-works-sum')
    if (sum) { const r = sum.getBoundingClientRect(); if (r.bottom > H + 1) out.push('the what-works line is off screen') }
    return out
  })
  for (const b of bad) fail(`${where}: ${b}`)
}

const N = 50
const patients = (f) => Array.from({ length: N }, (_, i) => ({ n: i + 1, state: 'waiting', tried: 0, seconds: 0, auc: null, ...f(i + 1) }))
const tiles = (state) => page.locator(`.ch-tile[data-state="${state}"]`).count()

try {
  await page.goto(`${base}#/clinic/live?cohort=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sg', { timeout: 60000 })

  // ---- the corner button starts a run of 50 simulated patients ----
  const button = page.locator('.ch-start button')
  await button.waitFor({ timeout: 15000 })
  if ((await button.innerText()) !== 'Re-train the whole clinic') fail(`button says "${await button.innerText()}"`)
  await button.click()
  await page.waitForSelector('.ch[data-state="queued"]', { timeout: 15000 }).catch(() => fail('queued: the run is not on the screen'))
  if ((await page.locator('.ch-tile').count()) !== N) fail(`queued: ${await page.locator('.ch-tile').count()} tiles, want ${N}`)
  if ((await tiles('waiting')) !== N) fail('queued: every tile should be waiting')
  {
    const t = await text()
    if (!/simulated patients/i.test(t)) fail('queued: does not say simulated patients')
    if (!/Demo signals/.test(t)) fail('queued: does not say demo signals')
  }
  if (!(await button.isDisabled())) fail('queued: the button should be off while a run is going')
  await shot('queued')

  // ---- caps: one at a time ----
  {
    const again = await call('POST', 'ear/cohort', { patients: N }, { 'content-type': 'application/json' })
    if (again.status !== 409 || !/already going/.test(again.body?.error ?? '')) fail(`a second run while one goes: ${again.status} ${JSON.stringify(again.body)}`)
    const big = await call('POST', 'ear/cohort', { patients: 61 }, { 'content-type': 'application/json' })
    if (big.status !== 400) fail(`61 patients should be refused, got ${big.status}`)
    const noToken = await call('POST', 'ear/cohort/claim', {}, { 'content-type': 'application/json' })
    if (noToken.status !== 401) fail(`claim without the worker token: ${noToken.status}`)
  }

  // ---- the worker takes it; first on this machine (a test run), then on Modal ----
  const claim = await ok('POST', 'ear/cohort/claim', {})
  if (claim?.patients !== N) fail(`claim: ${JSON.stringify(claim)}`)
  const id = claim.id
  const auc = (k) => Math.round((0.62 + ((k * 37) % 38) / 100) * 1000) / 1000
  // what works per patient: every third learned, then leaning, then too early; the learned ones cycle through the kinds
  const KINDS = ['breathe', 'scan', 'walk']
  const works = (k) => {
    const said = ['learned', 'leaning', 'early'][k % 3]
    const total = said === 'early' ? 2 : 6 + (k % 20)
    const best = KINDS[Math.floor(k / 3) % 3]
    const kinds = KINDS.map((kind, i) => ({ kind, n: kind === best ? total - (said === 'early' ? 1 : 2) : i === (KINDS.indexOf(best) + 1) % 3 ? (said === 'early' ? 1 : 2) : 0, mean: null }))
    for (const x of kinds) x.mean = x.n ? (x.kind === best ? 24.5 : 3.2) : null
    return { best, said, sure: said === 'learned' ? 0.91 : 0.6, next: best, total, kinds }
  }
  const worksText = (k) => {
    const w = works(k)
    const word = { breathe: 'breathing', scan: 'body scan', walk: 'walking' }[w.best]
    return `${w.said === 'learned' ? `${word} helps most` : w.said === 'leaning' ? `${word} so far` : 'too early'} ${w.total} practices`
  }
  const send = (body) => ok('POST', `ear/cohort/${id}/progress`, body)
  await send({ patients: patients((k) => (k <= 3 ? { state: 'running', tried: 10, seconds: 2 } : {})), seconds: 3, sandboxes: 3, peak: 3, where: 'local' })
  await page.waitForSelector('.ch[data-state="running"]', { timeout: 15000 })
  await waitText(/a test run, not Modal/, 'local')
  if (/network-blocked Modal Sandbox/.test(await text())) fail('local: says Modal for a run on the worker’s machine')

  const steps = [
    { at: 6, running: 47, done: 0 },
    { at: 18, running: 30, done: 20 },
    { at: 31, running: 4, done: 46 },
  ]
  for (const s of steps) {
    const ps = patients((k) => (k <= s.done ? { state: 'done', tried: 200 + k, seconds: 14 + (k % 9), auc: auc(k), works: works(k) } : k <= s.done + s.running ? { state: 'running', tried: 3 * k, seconds: s.at - 4 } : {}))
    const so = await send({ patients: ps, seconds: s.at + 0.4, sandboxes: s.running, peak: 47, where: 'modal', refused: 0 })
    const sum = ps.reduce((a, p) => a + p.tried, 0)
    if (so.tried !== sum) fail(`server totals ${so.tried}, the patients add up to ${sum}`)
    await page.waitForFunction((x) => document.querySelector('[data-tried]')?.textContent === x, sum.toLocaleString('en-US'), { timeout: 15000 }).catch(() => fail(`running: models tried ${sum} never shown`))
    const shown = await page.locator('[data-sandboxes]').innerText()
    if (shown !== String(s.running)) fail(`running: sandboxes shows ${shown}, want ${s.running}`)
    if ((await page.locator('[data-seconds]').innerText()) !== String(Math.round(s.at + 0.4))) fail('running: seconds')
    if ((await tiles('done')) !== s.done || (await tiles('running')) !== s.running) fail(`running: tiles ${await tiles('done')} done / ${await tiles('running')} running, want ${s.done}/${s.running}`)
    if (s.done) {
      const first = await page.locator('.ch-tile[data-n="1"] .ch-auc').innerText()
      if (first !== auc(1).toFixed(2)) fail(`tile 1 shows ${first}, want ${auc(1).toFixed(2)}`)
      for (const k of [1, 2, 3]) {
        const said = (await page.locator(`.ch-tile[data-n="${k}"] .ch-works`).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        if (said !== worksText(k)) fail(`tile ${k} says "${said}", want "${worksText(k)}"`)
      }
      const want = { learned: 0, leaning: 0, early: 0 }
      for (let k = 1; k <= s.done; k++) want[works(k).said]++
      for (const [said, v] of Object.entries(want)) {
        const got = await page.locator(`.ch-works-n [data-said="${said}"] b`).innerText().catch(() => '')
        if (got !== String(v)) fail(`running: ${said} shows ${got}, want ${v}`)
      }
    } else if (await page.locator('.ch-works-sum').count()) fail('running: the what-works tally shows before any patient is done')
    const t = await text()
    if (!/each in its own network-blocked Modal Sandbox/.test(t)) fail('running: should say each patient is in its own network-blocked Modal Sandbox')
    if (!/simulated patients/i.test(t)) fail('running: does not say simulated patients')
    await shot(`running-${s.done}`)
  }
  await fits('running 1920')

  // ---- done ----
  const last = patients((k) => (k === 50 ? { state: 'failed', tried: 40, seconds: 30, works: works(k) } : { state: 'done', tried: 200 + k, seconds: 14 + (k % 9), auc: auc(k), works: works(k) }))
  const fin = await ok('POST', `ear/cohort/${id}/done`, { patients: last, seconds: 41.3, sandboxes: 0, peak: 47, where: 'modal', refused: 2 })
  if (fin.state !== 'done') fail(`done: ${JSON.stringify(fin).slice(0, 200)}`)
  await page.waitForSelector('.ch[data-state="done"]', { timeout: 15000 }).catch(() => fail('done: not on the screen'))
  await waitText(/49 of 50 patients re-learned in 41 seconds/, 'done')
  {
    const t = await text()
    if (!/Each in its own network-blocked Modal Sandbox/.test(t)) fail('done: the sandbox line is missing')
    if (!/1 could not finish/.test(t)) fail('done: the failed patient is not said')
    const aucs = last.filter((p) => p.auc !== null).map((p) => p.auc)
    const range = `from ${Math.min(...aucs).toFixed(2)} to ${Math.max(...aucs).toFixed(2)}`
    if (!t.includes(range)) fail(`done: the score range "${range}" is not on the screen`)
    if ((await page.locator('[data-sandboxes]').innerText()) !== '47') fail('done: should show the peak sandboxes at once (47)')
    if (!/peak sandboxes at once/.test(t)) fail('done: the peak is not named')
    if ((await tiles('done')) !== 49 || (await tiles('failed')) !== 1) fail('done: tiles')
    if (!/simulated patients/i.test(t) || !/Demo signals/.test(t)) fail('done: the simulated label is gone')
    if (/AUC|posterior|thompson|bayes|gamma/i.test(t)) fail('done: jargon on screen')
    // 49 done (patient 50 failed, so its works are not counted): k % 3 = 1 learned, 2 leaning, 0 too early
    const want = { learned: 0, leaning: 0, early: 0 }
    for (let k = 1; k <= 49; k++) want[works(k).said]++
    for (const [said, v] of Object.entries(want)) {
      const got = await page.locator(`.ch-works-n [data-said="${said}"] b`).innerText().catch(() => '')
      if (got !== String(v)) fail(`done: ${said} shows ${got}, want ${v}`)
    }
    if (!/from the patient’s simulated practices/.test(t)) fail('done: the what-works line does not say simulated')
    if (!/breathing/.test(t) || !/body scan/.test(t) || !/walking/.test(t)) fail('done: the tiles do not show the mix of practices')
    if (/treatment/i.test(t)) fail('done: a practice is called a treatment')
  }
  await shot('done-1920')
  await fits('done 1920')
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(500)
  await shot('done-1366')
  await fits('done 1366')
  await page.setViewportSize({ width: 1920, height: 1080 })

  // ---- caps: two minutes between runs, said in plain words on the screen ----
  await button.click()
  await page.waitForSelector('.ch-start-say', { timeout: 10000 }).catch(() => fail('gap: no refusal shown'))
  {
    const say = await page.locator('.ch-start-say').innerText().catch(() => '')
    if (!/less than 2 minutes ago/.test(say)) fail(`gap: refusal says "${say}"`)
  }
  await shot('refused')

  // ---- a person's newer search takes the screen ----
  {
    const rec = JSON.parse(execFileSync('bun', ['-e', "import { simulateTeach } from './src/tune/ear/sim.ts'; console.log(JSON.stringify(simulateTeach({ seed: 4, hz: 25 })))"], { cwd: web, maxBuffer: 64 << 20 }).toString())
    const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const kept = await ok('POST', 'ear/recordings', { recording: rec, key }, { 'content-type': 'application/json' })
    await page.waitForSelector('.sg-search', { timeout: 15000 }).catch(() => fail('a newer search does not take the screen'))
    if (await page.locator('.ch').count()) fail('the run is still on the screen next to the newer search')
    await shot('search-newer')
    // tidy: the job is the test's own, nobody else's worker should get it
    const job = await call('POST', 'ear/jobs/claim', {})
    if (job.body?.id) await call('POST', `ear/jobs/${job.body.id}/done`, { error: 'cleared by the cohort test' })
    if (!kept?.jobId) fail('the minute did not start a search')
  }
} catch (e) {
  fail(`stopped: ${e instanceof Error ? e.message : String(e)}`)
  await shot('stopped').catch(() => {})
}

await browser.close()
writeFileSync(`${out}README.txt`, `Screens of node web/tests/e2e/cohort.mjs ${base} ${apiBase} (${kind})\n${new Date().toISOString()}\n`)
console.log(`COHORT_ERRORS ${JSON.stringify([...new Set(errors)])}`)
if (errors.length) process.exitCode = 1
