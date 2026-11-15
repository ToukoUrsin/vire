// node web/tests/e2e/heard.mjs <base> <out dir> [bundle.json]
// "Watch a real check" (#/heard) plays, counts up and ends on the stored score, at laptop and phone size.
// With a bundle file the API answer is stood in (a local stack has no check); without one the server's own is used.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { webkit } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5889/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/heard'
const body = process.argv[4] ? readFileSync(process.argv[4], 'utf8') : null
const b = await webkit.launch({ headless: true })
let bad = 0
const check = (ok, what) => {
  console.log(ok ? 'ok  ' : 'FAIL', what)
  if (!ok) bad++
}
for (const [name, w, h] of [
  ['laptop', 1440, 900],
  ['phone', 390, 844],
]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  // the exact path: a doubled /api/api/ must not be answered here
  if (body) await page.route((u) => u.pathname === '/api/ear/check', (r) => r.fulfill({ status: 200, contentType: 'application/json', body }))
  const t = Date.now()
  await page.goto(base + '#/heard', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-label]', { timeout: 30000 })
  console.log(`${name}: label after ${((Date.now() - t) / 1000).toFixed(1)} s: ${await page.locator('[data-label]').innerText()}`)
  await page.waitForFunction(() => document.querySelector('[data-ask]')?.getAttribute('data-ask') === 'nod', null, { timeout: 15000 })
  await page.waitForFunction(() => (document.querySelector('[data-hears]')?.getAttribute('data-hears') ?? '') !== '', null, { timeout: 8000 })
  console.log(`${name}: first nod heard ${((Date.now() - t) / 1000).toFixed(1)} s after opening`)
  await page.screenshot({ path: `${out}/${name}-mid.png` })
  await page.waitForSelector('.hd[data-ended="1"]', { timeout: 40000 })
  const text = await page.locator('.td-main').innerText()
  const said = text.match(/(\d+) of (\d+) nods, (\d+) of (\d+) head shakes/)
  check(!!said, `${name}: ends on the score (${said?.[0] ?? 'nothing'})`)
  check(/heard: \d+ of \d+ asked/.test(text), `${name}: the rows count what was heard`)
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(over <= 0, `${name}: no sideways scroll (${over})`)
  check(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`)
  console.log(`${name}: ended ${((Date.now() - t) / 1000).toFixed(1)} s after opening`)
  await page.screenshot({ path: `${out}/${name}-end.png` })
  await ctx.close()
}
await b.close()
console.log(bad ? `${bad} failed` : 'all passed')
process.exit(bad ? 1 : 0)
