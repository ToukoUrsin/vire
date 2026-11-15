// Screenshots of the check-in steps (needs taps). node scripts/shot-care.mjs <outdir>
import { createRequire } from 'node:module'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const out = process.argv[2] ?? '/tmp'
const base = process.env.VIRE_BASE ?? 'http://127.0.0.1:5881/app/'
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)))
await page.goto(`${base}#/care/checkin`)
await page.waitForTimeout(2200)
await page.screenshot({ path: `${out}/ci-1.png` })
for (let i = 0; i < 4; i++) {
  await page.locator('.ci-option').nth(i % 3).click()
  await page.waitForTimeout(i === 0 ? 120 : 900)
  if (i === 0) {
    await page.screenshot({ path: `${out}/ci-1b.png` })
    await page.waitForTimeout(900)
  }
  if (i === 1) await page.screenshot({ path: `${out}/ci-3.png` })
}
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/ci-sum.png` })
await page.locator('.btn-ember').click()
await page.waitForTimeout(1800)
await page.screenshot({ path: `${out}/ci-done.png` })
// the chat after a message and a booked call
await page.goto(`${base}#/care`)
await page.waitForTimeout(1500)
await page.locator('.care-callbtn').click()
await page.waitForTimeout(700)
await page.locator('.care-slots .row').first().click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/care-sheet.png` })
await page.locator('.sheet .btn').click()
await page.waitForTimeout(400)
await page.locator('.composer textarea').fill('Thanks Sanna. Friday works.')
await page.locator('.composer-send').click()
await page.waitForTimeout(3200)
await page.screenshot({ path: `${out}/care-end.png` })
await b.close()
console.log('ok')
