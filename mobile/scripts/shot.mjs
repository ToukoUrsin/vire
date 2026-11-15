// Screenshot one screen of the phone app from the running dev server, as a phone shows it (402 wide at 2x).
//   node scripts/shot.mjs /signals/calls /bulk2/runs/depression/mobile/shots/calls.png [height] [scrollTop]
// A tall height (for example 2600) shows a whole scrolling screen in one picture. Default is one phone screen, 874.
import { createRequire } from 'node:module'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const [path = '/today', out = '/tmp/shot.png', h = '874', top = '0'] = process.argv.slice(2)
const base = process.env.VIRE_BASE ?? 'http://127.0.0.1:5881/app/'
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 402, height: +h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)))
await page.goto(`${base}#${path}`)
await page.waitForTimeout(2600)
if (+top) {
  await page.evaluate((y) => {
    const s = [...document.querySelectorAll('.screen')].pop()
    if (s) s.scrollTop = y
  }, +top)
  await page.waitForTimeout(500)
}
await page.screenshot({ path: out })
await b.close()
console.log(out)
