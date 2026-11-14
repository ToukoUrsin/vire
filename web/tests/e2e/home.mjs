#!/usr/bin/env node
// The first impression: the first screen says what Vire is and offers the four ways in, the replay button fits the
// first view and says "real" only when the server does, the idle big screen speaks of AirPods (not the camera minute),
// the clinic's tabs have plain names, and the camera minute still opens at #/visit and #/minute.
// node tests/e2e/home.mjs [base] [out]   (WebKit: headless Chromium on the box drops loads)
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { webkit } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5894/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/home'
mkdirSync(out, { recursive: true })

const fail = []
const check = (ok, what) => {
  if (!ok) fail.push(what)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

const browser = await webkit.launch({ headless: true })
for (const [w, h] of [[390, 844], [1440, 900]]) {
  for (const replay of ['missing', 'real']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    if (replay === 'real') await page.route('**/api/ear/replay', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"real":true}' }))
    else await page.route('**/api/ear/replay', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' }))
    const tag = `${w}x${h} replay=${replay}`

    await page.goto(`${base}#/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.hm-watch', { timeout: 15000 })
    await page.waitForFunction(() => /scripted|real run/.test(document.querySelector('.hm-watch')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {})
    const text = await page.locator('main').innerText()
    check(text.includes('Like Meru Health, but your AirPods sense every step.'), `${tag}: punchline`)
    check(text.includes('plays a practice in your ears'), `${tag}: second sentence`)
    const watch = await page.locator('.hm-watch').innerText()
    if (replay === 'real') check(/Watch a real run/.test(watch) && /founder’s own AirPods, 40 seconds/.test(watch), `${tag}: says real when the server does`)
    else check(/Watch a run/.test(watch) && !/real/i.test(watch) && /A scripted run for now, 40 seconds/.test(watch), `${tag}: never says real otherwise`)
    const box = await page.locator('.hm-watch').boundingBox()
    check(!!box && box.y >= 0 && box.y + box.height <= h && box.x >= 0 && box.x + box.width <= w, `${tag}: replay button inside the first view (${box && Math.round(box.y + box.height)}px of ${h})`)
    const hrefs = await page.locator('main a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
    const order = ['#/watch', '#/today', '#/clinic', '#/clinic/live', '#/try', '#/visit']
    check(JSON.stringify(hrefs.filter((x) => order.includes(x))) === JSON.stringify(order), `${tag}: ways in, in order (${hrefs.join(' ')})`)
    check(text.includes('Today') && text.includes('AirPods in, five minutes') && text.includes('The clinic') && text.includes('The big screen') && text.includes('No AirPods?') && text.includes('Try the breathing on your phone') && text.includes('Or one minute with the camera') && text.includes('stopped working for about half of the people it helped'), `${tag}: the four ways in are named`)
    check(text.includes('A signal for the clinic, not a diagnosis.') && text.includes('No patient has used Vire yet. The clinic’s patients are simulated.'), `${tag}: the honest lines`)
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
    check(scrollW <= w, `${tag}: no sideways scroll (${scrollW})`)
    check(!/echo|ping|laughter/i.test(text), `${tag}: none of the old product's words`)
    await page.screenshot({ path: `${out}/home-${w}-${replay}.png` })
    if (replay === 'missing') await page.screenshot({ path: `${out}/home-${w}-full.png`, fullPage: true })
    if (replay === 'real') {
      await page.click('.hm-watch')
      await page.waitForTimeout(300)
      check(page.url().endsWith('#/watch'), `${tag}: one tap to the replay`)
      check(!errors.length, `${tag}: no page errors ${JSON.stringify(errors.slice(0, 3))}`)
      await ctx.close()
      continue
    }

    // the big screen with no phone: the loop's words, three links, no face
    await page.goto(`${base}#/clinic/live`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.sg-idle', { timeout: 15000 })
    await page.waitForTimeout(600)
    const live = await page.locator('.sg').innerText()
    check(!/laughter|wireframe/i.test(live), `${tag}: idle big screen has no laughter or wireframe`)
    check(live.includes('AirPods in, camera off.'), `${tag}: idle big screen says AirPods in, camera off`)
    const liveLinks = await page.locator('.sg-idle-links a').evaluateAll((as) => as.map((a) => `${a.textContent}|${a.getAttribute('href')}`))
    check(JSON.stringify(liveLinks) === JSON.stringify(['Watch a run|#/watch', 'The last practice|#/clinic/live?practice=1', 'Re-train the whole clinic|#/clinic/live?cohort=1']), `${tag}: idle links ${JSON.stringify(liveLinks)}`)
    check((await page.locator('.sg-facebox, .sg-story').count()) === 0, `${tag}: no face or camera story when idle`)
    await page.screenshot({ path: `${out}/live-idle-${w}.png` })
    // the link to ?cohort=1 on the same page holds the clinic view (and its button) without a reload
    await page.click('.sg-idle-links a[href$="cohort=1"]')
    await page.waitForTimeout(800)
    check((await page.locator('.ch-start button').count()) === 1, `${tag}: ?cohort=1 keeps the re-train button`)
    await page.screenshot({ path: `${out}/live-cohort-${w}.png` })

    // the clinic's tabs
    await page.goto(`${base}#/clinic`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.cl-nav', { timeout: 15000 })
    const tabs = await page.locator('.cl-nav').innerText()
    check(/Big screen/.test(tabs) && /Hall visitors/.test(tabs) && !/Live mirror|Hall today/.test(tabs), `${tag}: tabs renamed (${tabs.replace(/\s+/g, ' ')})`)
    check((await page.locator('a.cl-brand').getAttribute('href')) === '#/', `${tag}: clinic wordmark leads to #/`)
    await page.goto(`${base}#/clinic/hall`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.va-hall', { timeout: 15000 })
    await page.waitForTimeout(800)
    const hall = await page.locator('.va-hall').innerText()
    check(/Hall visitors/.test(hall) && /one-minute camera check on their own phones/.test(hall), `${tag}: hall page says what it is`)
    await page.screenshot({ path: `${out}/hall-${w}.png` })

    // the camera minute still opens at #/visit and #/minute
    for (const path of ['visit', 'minute']) {
      await page.goto(`${base}#/${path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.va-first', { timeout: 20000 })
      await page.waitForTimeout(2500)
      const note = await page.locator('.va-camera-note').innerText().catch(() => '')
      check(/camera version, for people without AirPods/.test(note), `${tag}: #/${path} opens the camera minute and says so`)
      check((await page.locator('.va-camera-note a').getAttribute('href').catch(() => null)) === '#/', `${tag}: #/${path} links back to #/`)
      // nothing faint: every paragraph under the intro reads at 4.5:1 or better
      const faint = await page.evaluate(() => {
        const lum = (c) => {
          const m = c.match(/[\d.]+/g).map(Number)
          const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const bg = lum(getComputedStyle(document.body).backgroundColor)
        return [...document.querySelectorAll('.va-first-body p')].filter((p) => p.textContent.trim()).map((p) => {
          const s = getComputedStyle(p)
          const fg = lum(s.color)
          const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
          return { t: p.textContent.slice(0, 30), ratio: +ratio.toFixed(2), op: +s.opacity }
        }).filter((x) => x.ratio < 4.5 || x.op < 0.9)
      })
      check(!faint.length, `${tag}: #/${path} has no faint text ${JSON.stringify(faint)}`)
      await page.screenshot({ path: `${out}/${path}-${w}.png` })
    }
    check(!errors.length, `${tag}: no page errors ${JSON.stringify(errors.slice(0, 3))}`)
    await ctx.close()
  }
}
await browser.close()
if (fail.length) {
  console.log(`\n${fail.length} failed`)
  process.exit(1)
}
console.log('\nall passed')
