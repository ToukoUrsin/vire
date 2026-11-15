// Screenshots of one practice: the intro, the running player (twice), and the result.
//   node scripts/shot-practice.mjs breathing /bulk2/runs/depression/mobile/shots/pr [short|full] [runSeconds]
import { createRequire } from 'node:module'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const [id = 'breathing', out = '/tmp/pr', len = 'short', wait = '0'] = process.argv.slice(2)
const base = process.env.VIRE_BASE ?? 'http://127.0.0.1:5881/app/'
const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)))
await page.goto(`${base}#/practice/${id}`)
await page.waitForTimeout(2400)
await page.screenshot({ path: `${out}-${id}-1-intro.png` })
if (len === 'short') await page.getByRole('button', { name: '1 min', exact: true }).click()
await page.getByRole('button', { name: 'Begin' }).click()
await page.waitForTimeout(3200)
await page.screenshot({ path: `${out}-${id}-2-run-in.png` })
await page.waitForTimeout(5000)
await page.screenshot({ path: `${out}-${id}-3-run-out.png` })
if (+wait) {
  await page.waitForTimeout(+wait * 1000)
} else if (len === 'short') {
  await page.waitForSelector('.pr-done', { timeout: 70000 })
} else {
  await page.getByRole('button', { name: 'Finish' }).click()
}
await page.waitForTimeout(2600)
await page.screenshot({ path: `${out}-${id}-4-done.png` })
await page.screenshot({ path: `${out}-${id}-5-done-full.png`, fullPage: false })
await b.close()
console.log('ok', id)
