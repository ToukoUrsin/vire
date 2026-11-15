// Runs the one-minute breathing to its end in a phone-sized browser and pictures the first moment after Begin and the result.
//   node scripts/result-check.mjs <outDir>
import { createRequire } from 'node:module'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const out = process.argv[2] ?? '/tmp'
const base = process.env.VIRE_BASE ?? 'http://127.0.0.1:5883/app/'
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)))
await page.goto(`${base}#/practice/breathing`)
await page.waitForTimeout(1500)
await page.getByText('1 min', { exact: true }).last().click()
await page.waitForTimeout(300)
await page.getByText('Begin', { exact: true }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/begin-300ms.png` })
await page.waitForTimeout(62500)
await page.setViewportSize({ width: 402, height: 1500 })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/result.png` })
await b.close()
console.log('done')
