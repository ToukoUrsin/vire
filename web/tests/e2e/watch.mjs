#!/usr/bin/env node
// "Watch a run" (#/watch): a stored Today run played back in about 40 seconds, for anyone without AirPods.
//   node web/tests/e2e/watch.mjs <baseUrl> <outDir> [api base]
// checks, in WebKit at 390x844 and 1440x900: the label says scripted, the pace steps down, the before and after
// appear, the clinic card lands, blocked sound shows "Tap for sound", and the page POSTs nothing.
//
//   node web/tests/e2e/watch.mjs --make <baseUrl> <helper ws url> <api base>
// makes the scripted run instead: the real Today flow at real speed (about five minutes) with the stand-in AirPods
// (`bun scripts/fake-ears.ts <port>`) and a flat stand-in heart rate, on a test API of its own. It prints the id of
// the session it sent; server/earreplay.ts turns that into server/replay-scripted.json (see its header).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { webkit } = require('/home/ubuntu/.local/lib/node_modules/playwright')

if (process.argv[2] === '--make') {
  const base = process.argv[3].replace(/\/?$/, '/')
  const helper = process.argv[4]
  const browser = await webkit.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.addInitScript((url) => localStorage.setItem('vire.ears.url', url), helper)
  let sent = null
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && /\/api\/ear\/sessions$/.test(res.url())) sent = await res.json().catch(() => null)
  })
  await page.goto(`${base}#/today`, { waitUntil: 'domcontentloaded' })
  await page.click('text=Connect AirPods', { timeout: 60000 })
  await page.waitForSelector('[data-start]:not([disabled])', { timeout: 30000 })
  if ((await page.locator('[data-next]').getAttribute('data-next')) !== 'breathe') await page.click('[data-pick="breathe"]')
  await page.click('[data-start]')
  // the stand-in heart: flat around 70 with a little noise, so the script claims nothing about the heart
  await page.evaluate(() => {
    window.__vireNative?.({ k: 'status', airpods: 'connected', hr: 'on', route: 'stand-in' })
    setInterval(() => {
      const bpm = Math.round((70 + (Math.random() - 0.5) * 3) * 10) / 10
      window.__vireNative?.({ k: 'hr', t: Date.now(), bpm })
      window.__vireNative?.({ k: 'hrs', t: Date.now(), bpm, src: 'AirPods (stand-in)', model: 'AirPods', n: 1 })
    }, 1000)
  })
  // the stand-in head does what the screen asks, as a calm person would: nods when asked, sits still in the checks
  // (fidgeting a little more before the practice than after), and breathes with the sea (scripts/fake-ears.ts /script)
  const ctl = helper.replace(/^ws/, 'http').replace(/\/?$/, '/script')
  let lastMode = ''
  const t00 = Date.now()
  for (let i = 0; i < 6000; i++) {
    const [stage, say, phase, secs, err] = await page.evaluate(() => [
      document.querySelector('.td')?.getAttribute('data-stage') ?? '',
      document.querySelector('.el-say')?.textContent ?? '',
      document.querySelector('.td-orb')?.getAttribute('data-phase') ?? '',
      parseFloat(document.querySelector('.td-orb')?.style.transitionDuration ?? '') || 4,
      document.querySelector('.el-err')?.textContent ?? '',
    ])
    const mode =
      stage === 'practice' && (phase === 'in' || phase === 'out') ? phase
      : stage === 'still' ? 'restless'
      : stage === 'after' ? (/still/i.test(say) ? 'calm' : 'quiet')
      : /^nod/i.test(say) ? 'nod'
      : /shake/i.test(say) ? 'shake'
      : 'quiet'
    if (mode !== lastMode) {
      lastMode = mode
      await fetch(`${ctl}?mode=${mode}&secs=${secs}`).catch(() => {})
      if (mode !== 'in' && mode !== 'out') console.log(`${Math.round((Date.now() - t00) / 1000)}s ${stage} | ${say} | ${mode} ${err}`)
    }
    if (i % 80 === 0) console.log(`${Math.round((Date.now() - t00) / 1000)}s ${stage} | ${say} | ${mode}`)
    if (/^done/.test(stage)) break
    await page.waitForTimeout(125)
  }
  await fetch(`${ctl}?mode=off`).catch(() => {})
  for (let i = 0; i < 50 && !sent; i++) await page.waitForTimeout(100)
  console.log(`SENT ${sent?.id}`)
  await browser.close()
  process.exit(sent?.id ? 0 : 1)
}

const base = (process.argv[2] ?? 'http://127.0.0.1:5895/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/watch'
const apiBase = process.argv[4] ?? 'http://127.0.0.1:8885'
mkdirSync(out, { recursive: true })
const errors = []
const fail = (why) => { console.log(`FAIL ${why}`); errors.push(why) }
const latest = async () => { try { const r = await fetch(`${apiBase}/api/ear/sessions/latest`); return r.ok ? (await r.json()).id : null } catch { return null } }
const latest0 = await latest()
const browser = await webkit.launch({ headless: true })

for (const [w, h, block] of [[390, 844, true], [1440, 900, false]]) {
  const tag = `${w}x${h}`
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  page.on('pageerror', (e) => errors.push(`${tag} ${e}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${tag} ${m.text()}`) })
  const posts = []
  page.on('request', (r) => { if (r.method() !== 'GET' && r.method() !== 'HEAD') posts.push(`${r.method()} ${r.url()}`) })
  await page.addInitScript(() => localStorage.setItem('vire.watch.speed', '2'))
  if (block) {
    // a browser that will not start sound without a tap: the context stays suspended until the test lets it go
    await page.addInitScript(() => {
      const AC = window.AudioContext ?? window.webkitAudioContext
      if (!AC) return
      const desc = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state')
      const resume = AC.prototype.resume
      Object.defineProperty(AC.prototype, 'state', { get() { return window.__allow ? desc.get.call(this) : 'suspended' } })
      AC.prototype.resume = function () {
        return new Promise((ok) => { const t = setInterval(() => { if (window.__allow) { clearInterval(t); resume.call(this).then(ok) } }, 50) })
      }
    })
  }
  await page.goto(`${base}#/watch`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.wt[data-part="before"] [data-where]', { timeout: 60000 })
  const label = await page.locator('[data-label]').innerText()
  if (!/^A scripted run: a stand-in plays the AirPods\. Not a person\.$/.test(label)) fail(`${tag} the label says "${label}"`)
  if ((await page.locator('.wt').getAttribute('data-real')) !== 'false') fail(`${tag} the page does not say the run is not real`)
  await page.waitForTimeout(1200)
  const snd = await page.locator('.wt').getAttribute('data-sound')
  console.log(`${tag} sound ${snd}`)
  if (block) {
    if (snd !== 'blocked' || !(await page.locator('[data-tap-sound]').isVisible())) fail(`${tag} blocked sound does not show "Tap for sound" (sound ${snd})`)
    await page.evaluate(() => { window.__allow = true })
    await page.click('[data-tap-sound]')
    await page.waitForSelector('.wt[data-sound="on"]', { timeout: 5000 }).catch(() => fail(`${tag} the tap did not start the sound`))
    if (await page.locator('[data-tap-sound]').count()) fail(`${tag} "Tap for sound" stays after the tap`)
  } else if (snd !== 'on' && !(snd === 'blocked' && (await page.locator('[data-tap-sound]').isVisible()))) fail(`${tag} sound is ${snd} with no way to start it`)
  await page.screenshot({ path: `${out}/${tag}-1-before.png` })
  const where = await page.locator("[data-where]").textContent()
  if (!/Check before: \d+ s in \d+ s/.test(where)) fail(`${tag} the check before says "${where}"`)

  // keyboard: Tab reaches the controls
  let reached = false
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-pause') ?? false)
  }
  if (!reached) fail(`${tag} Tab does not reach Pause`)

  // the practice: the pace steps down as it did in the run, each check shows whether the breath followed
  await page.waitForSelector('.wt[data-part="practice"]', { timeout: 30000 })
  const paces = []
  const phases = new Set()
  let checkText = ''
  let shot = false
  while ((await page.locator('.wt').getAttribute('data-part')) === 'practice') {
    const p = await page.locator('[data-pace]').getAttribute('data-pace').catch(() => null)
    if (p && paces[paces.length - 1] !== Number(p)) paces.push(Number(p))
    const ph = await page.locator('.wt-orb').getAttribute('data-phase').catch(() => null)
    if (ph) phases.add(ph)
    const t = await page.locator('[data-pace]').innerText().catch(() => '')
    if (/followed|stillness|did not follow/.test(t)) checkText = t
    if (!shot && paces.length >= 2) { await page.screenshot({ path: `${out}/${tag}-2-practice.png` }); shot = true }
    await page.waitForTimeout(150)
  }
  const pw = await page.locator('[data-where]').innerText().catch(() => '')
  console.log(`${tag} paces ${paces.join(' > ')}; orb ${[...phases]}; check "${checkText}"`)
  if (paces.length < 2 || paces[paces.length - 1] >= paces[0]) fail(`${tag} the pace did not step down: ${paces}`)
  if (!phases.has('in') || !phases.has('out')) fail(`${tag} the sea did not rise and fall`)
  if (!checkText) fail(`${tag} no pace check was shown`)
  if (!shot) await page.screenshot({ path: `${out}/${tag}-2-practice.png` })
  void pw

  // pause holds the clock
  await page.waitForSelector('.wt[data-part="after"]', { timeout: 30000 })
  await page.click('[data-pause]')
  const w0 = await page.locator('.el-bar i').getAttribute('style')
  await page.waitForTimeout(1200)
  if ((await page.locator('.el-bar i').getAttribute('style')) !== w0) fail(`${tag} pause did not hold the replay`)
  await page.screenshot({ path: `${out}/${tag}-3-after.png` })
  await page.click('[data-pause]')

  // before and after, in Today's words
  await page.waitForSelector('[data-result]', { timeout: 30000 })
  const res = (await page.locator('[data-result]').innerText()).replace(/\n+/g, ' | ')
  console.log(`${tag} RESULT ${res}`)
  if (!/(Calmer after\.|Not calmer today\.|Mixed today\.|No change today\.|Done for today\.)/.test(res)) fail(`${tag} no verdict in Today's words`)
  if (!/Stillness \| (your head moved [\d.]+° a second before, [\d.]+° after|not read)/.test(res)) fail(`${tag} stillness before and after is not shown`)
  if (!/Heart rate \| [\d.]+ before, [\d.]+ after/.test(res)) fail(`${tag} heart rate before and after is not shown`)
  if (/from your AirPods/.test(res)) fail(`${tag} the scripted run names the AirPods as what measured the heart`)
  await page.screenshot({ path: `${out}/${tag}-4-result.png`, fullPage: true })

  // the clinic's screen
  await page.waitForSelector('[data-clinic] .sg-practice', { timeout: 30000 })
  const card = (await page.locator('[data-clinic]').innerText()).replace(/\n+/g, ' | ')
  if (!/Slow breathing/.test(card)) fail(`${tag} the clinic card does not name the practice`)
  if (!/Demo signals: a script made this practice, not a person\./.test(card)) fail(`${tag} the clinic card does not say demo signals`)
  if ((await page.locator('[data-clinic] a', { hasText: 'See the clinic' }).getAttribute('href')) !== '#/clinic') fail(`${tag} no link to the clinic`)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/${tag}-5-clinic.png` })
  await page.screenshot({ path: `${out}/${tag}-6-full.png`, fullPage: true })
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (over > 0) fail(`${tag} the page scrolls sideways by ${over}px`)
  if (!(await page.locator('a[href="#/"]').first().isVisible())) fail(`${tag} no way back to #/`)

  // replay starts again
  await page.click('[data-replay]')
  await page.waitForSelector('.wt[data-part="before"]', { timeout: 5000 }).catch(() => fail(`${tag} replay did not start again`))
  if (posts.length) fail(`${tag} the page sent ${posts.join(', ')}`)
  await page.close()
}

// Today without AirPods points here
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`${base}#/today`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-watch]', { timeout: 60000 }).catch(() => fail('Today has no "Watch a run" without AirPods'))
  const t = await page.locator('[data-watch]').innerText().catch(() => '')
  if (!/No AirPods here\? Watch a run/.test(t)) fail(`Today's way to watch says "${t}"`)
  await page.screenshot({ path: `${out}/today-no-airpods.png`, fullPage: true })
  await page.click('[data-watch]')
  await page.waitForSelector('.wt [data-label]', { timeout: 30000 }).catch(() => fail('the tap on "Watch a run" did not open the replay'))
  await page.waitForTimeout(1500)
  console.log(`from Today: sound ${await page.locator('.wt').getAttribute('data-sound')}`)
  await page.close()
}

if ((await latest()) !== latest0) fail('watching changed the clinic’s newest practice')
await browser.close()
console.log(errors.length ? `ERRORS ${JSON.stringify(errors)}` : 'CLEAN')
process.exit(errors.length ? 1 : 0)
