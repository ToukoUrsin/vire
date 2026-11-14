#!/usr/bin/env node
// The pitch deck PDF the Junction form asks for.
//   node pitch/deck/build.mjs   -> /bulk3/runs/depression/deck/vire-deck.pdf (+ slide-01.png ... one per slide)
// Product pictures are fresh screenshots of the live site, taken here with Playwright WebKit (read only: nothing is
// pressed, booked or started). They land in /bulk3/runs/depression/deck/shots/, never in the repo.
// Every number on a slide has a row in pitch/claims.md and matches pitch/submission.md.
import { createRequire } from 'node:module'

import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---- The founder's own Today run on his AirPods (Sunday morning). Fill from the phone's result screen. ----
// Until `ran` is set, the "What ran" slide says what is true today: the loop is online and tested with a script in
// place of AirPods. Same slots as [REAL: ran], [REAL: heart], [REAL: still] in pitch/submission.md.
const REAL = {
  ran: null, // true: the whole loop ran on his AirPods. false: it did not (then say which step in `stopped`). null: not run yet
  stopped: '', // only when ran is false, e.g. 'the breathing did not start'
  heartBefore: null, // beats a minute in the still check before, e.g. 72. Only if the result screen names the AirPods as the source
  heartAfter: null, // beats a minute in the check after, e.g. 68
  stillerPct: null, // "your head sat N% stiller" -> N; "moved N% more" -> -N
}

function realLine() {
  // the later check (claims.md row 134): the one real result from after the setup, so it leads until the full run exists
  const later = 'Camera off, my model heard 3 of 3 asked nods and 3 of 3 head shakes, none unasked. One check, on me.'
  if (REAL.ran === null) {
    return {
      n: '3 of 3',
      title: 'Four hours after setup',
      text: `${later} The whole loop is online, tested with a script in place of AirPods.`,
    }
  }
  if (REAL.ran === false) {
    return {
      n: '3 of 3',
      title: 'Four hours after setup',
      text: `${later} The whole loop is online, tested with a script; on my own AirPods this morning, ${REAL.stopped || 'it did not run all the way'}.`,
    }
  }
  const heart =
    REAL.heartBefore != null && REAL.heartAfter != null
      ? `heart rate ${REAL.heartBefore} → ${REAL.heartAfter} a minute`
      : 'no heart rate from the AirPods yet'
  const still =
    REAL.stillerPct == null ? '' : REAL.stillerPct >= 0 ? `, head ${REAL.stillerPct}% stiller` : `, head moved ${-REAL.stillerPct}% more`
  return {
    n: 'Ran',
    title: 'On my own AirPods',
    text: `The whole loop, this morning: ${heart}${still}. Four hours after setup, camera off, my model heard 3 of 3 asked nods and 3 of 3 head shakes.`,
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const out = '/bulk3/runs/depression/deck'
const shots = join(out, 'shots')
mkdirSync(shots, { recursive: true })
const require = createRequire(import.meta.url)
const pw = require('/home/ubuntu/.local/lib/node_modules/playwright')
const { renderSVG } = require(join(root, 'web/node_modules/uqr'))
const SITE = 'https://vire.fly.dev/'
const SKIP_SHOTS = process.argv.includes('--keep-shots')

// ---- screenshots, WebKit, one browser at a time ----
const caps = {}
if (!SKIP_SHOTS) {
  const b = await pw.webkit.launch()
  const phone = () => b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
  const laptop = () => b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const open = async (ctx, hash, settle = 2500) => {
    const p = await ctx.newPage()
    await p.goto(SITE + hash, { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    await p.waitForTimeout(settle)
    return p
  }
  const shot = (p, name, opts = {}) => p.screenshot({ path: join(shots, `${name}.jpg`), type: 'jpeg', quality: 90, ...opts })
  // sticky and fixed bars would sit on top of a clipped part of a long page: put them back in the flow first
  const unstick = (p) =>
    p.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const pos = getComputedStyle(el).position
        if (pos === 'sticky' || pos === 'fixed') el.style.position = 'static'
      }
    })
  // page coordinates of the element whose own text is `re` (a text node match), and of the box `up` levels above it
  const boxOf = (p, re, up = 0) =>
    p.evaluate(
      ([src, up]) => {
        const re = new RegExp(src, 'i')
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let n
        while ((n = w.nextNode())) if (re.test(n.data.trim())) break
        if (!n) throw new Error('not found: ' + src)
        let el = n.parentElement
        for (let i = 0; i < up; i++) el = el.parentElement
        const r = el.getBoundingClientRect()
        return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, bottom: r.bottom + scrollY }
      },
      [re.source, up],
    )
  // the card that holds a heading: walk up until a sizeable box with its own background
  const cardOf = (p, text) =>
    p.evaluate((text) => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let n
      while ((n = w.nextNode())) if (n.data.trim() === text) break
      if (!n) throw new Error('not found: ' + text)
      let el = n.parentElement
      while (el.parentElement) {
        el = el.parentElement
        const r = el.getBoundingClientRect()
        const bg = getComputedStyle(el).backgroundColor
        if (r.height > 300 && bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break
      }
      const r = el.getBoundingClientRect()
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }
    }, text)

  // phone: the first screen
  {
    const ctx = await phone()
    const p = await open(ctx, '#/')
    await shot(p, 'phone-home')
    await ctx.close()
  }
  // phone: Today, before anything is started (nothing is pressed)
  {
    const ctx = await phone()
    const p = await open(ctx, '#/today')
    await shot(p, 'phone-today')
    await ctx.close()
  }
  // phone: the replay, at six a minute with the breath followed, then at its result
  {
    const ctx = await phone()
    const p = await open(ctx, '#/watch', 300)
    caps.watch = (await p.locator('text=/scripted run|real run|stand-in/i').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    await p.waitForFunction(() => /6 breaths a minute, breath followed/.test(document.body.innerText) && /Breathe (in|out)/.test(document.body.innerText), null, { timeout: 60000 })
    await p.waitForTimeout(900)
    await shot(p, 'phone-breathe')
    await p.waitForFunction(() => /What Today said/.test(document.body.innerText), null, { timeout: 60000 })
    await p.waitForTimeout(700)
    await p.evaluate(() => scrollTo(0, 0))
    await shot(p, 'phone-result')
    await ctx.close()
  }
  // laptop: the last practice on the clinic's big screen, from its kicker down to the before/after numbers
  {
    const ctx = await laptop()
    const p = await open(ctx, '#/clinic/live?practice=1', 4000)
    caps.practiceDemo = /Demo signals/.test(await p.evaluate(() => document.body.innerText))
    await shot(p, 'laptop-practice')
    const nums = await boxOf(p, /^heart rate before and after/, 1)
    const note = await boxOf(p, /from this device/).catch(() => nums)
    const sound = await boxOf(p, /^The sound led the breath/).catch(() => nums)
    const bottom = Math.max(nums.bottom + 28, note.bottom + 28, sound.bottom + 6)
    await shot(p, 'laptop-practice-crop', { clip: { x: 16, y: 96, width: 1408, height: bottom - 96 } })
    await ctx.close()
  }
  // laptop: the clinic list (its first group) and the top patient's four signals. Opened, nothing pressed.
  {
    const ctx = await laptop()
    const p = await open(ctx, '#/clinic')
    await shot(p, 'laptop-clinic')
    await unstick(p)
    const top = await boxOf(p, /^Below their usual in spite of the practices/)
    const end = await boxOf(p, /^Worth a call today/)
    await shot(p, 'laptop-clinic-top', { clip: { x: 24, y: top.y - 14, width: 1392, height: end.y - top.y + 2 }, fullPage: true })
    const href = await p.locator('a[href^="#/clinic/p/"]').first().getAttribute('href')
    const q = await open(ctx, href)
    await unstick(q)
    await shot(q, 'laptop-patient-signals', { clip: await cardOf(q, 'The four signals, against their usual'), fullPage: true })
    await ctx.close()
  }
  // laptop: the whole clinic re-learned, the 50 boxes (the latest run; "Re-train" is not pressed)
  {
    const ctx = await laptop()
    const p = await open(ctx, '#/clinic/live?cohort=1', 4000)
    await shot(p, 'laptop-cohort')
    await ctx.close()
  }
  await b.close()
  writeFileSync(join(shots, 'captions.json'), JSON.stringify(caps, null, 2))
} else {
  Object.assign(caps, JSON.parse(readFileSync(join(shots, 'captions.json'), 'utf8')))
}

// ---- fill the page ----
const real = realLine()
const watchLabel = caps.watch || 'A scripted run: a stand-in plays the AirPods. Not a person.'
const practiceLabel = caps.practiceDemo ? 'Demo signals: a script made this practice, not a person.' : 'The last practice that reached the clinic’s big screen.'
const qr = renderSVG('https://vire.fly.dev', { border: 0, whiteColor: '#f3ece0', blackColor: '#14110d' })
const html = readFileSync(join(here, 'deck.html'), 'utf8')
  .replaceAll('../../web/', `file://${join(root, 'web')}/`)
  .replaceAll('SHOTS/', `file://${shots}/`)
  .replace('QRSVG', qr)
  .replace('REAL_N', real.n)
  .replace('REAL_TITLE', real.title)
  .replace('REAL_TEXT', real.text)
  .replaceAll('WATCH_LABEL', watchLabel)
  .replace('PRACTICE_LABEL', practiceLabel)
const built = join(out, 'deck.built.html')
writeFileSync(built, html)

// ---- print: Chromium opens the local page and prints a vector PDF; one PNG per slide ----
const b = await pw.chromium.launch()
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await page.goto(`file://${built}`)
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(500)
const pdf = join(out, 'vire-deck.pdf')
await page.pdf({ path: pdf, width: '1920px', height: '1080px', printBackground: true })
const n = await page.locator('.slide').count()
for (let i = 0; i < n; i++) {
  await page.locator('.slide').nth(i).screenshot({ path: join(out, `slide-${String(i + 1).padStart(2, '0')}.png`) })
}
await b.close()
const mb = (statSync(pdf).size / 1e6).toFixed(1)
console.log(`${n} slides -> ${pdf} (${mb} MB)`)
if (statSync(pdf).size > 15e6) console.log('PDF is over 15 MB')
