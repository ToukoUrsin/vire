// The You screen with a taught model in place (a fixture, only in this headless browser). node scripts/shot-you.mjs <out.png> [height]
import { createRequire } from 'node:module'
const require = createRequire('/home/ubuntu/.local/lib/node_modules/playwright')
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const [out = '/tmp/you.png', h = '874'] = process.argv.slice(2)
const base = process.env.VIRE_BASE ?? 'http://127.0.0.1:5881/app/'
const sc = (auc, ok) => ({ score: { auc, chance: 0.57, windows: 120, times: 12, ok }, det: null })
const model = { v: 2, at: '2026-11-14T20:00:00Z', by: 'sandbox', shell: 'ios', hz: 50, gyro: true, tried: 366, minutes: 3, held: 'minute', events: { nod: sc(0.972, true), shake: sc(0.971, true), smile: sc(0.644, false) } }
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 402, height: +h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript((m) => localStorage.setItem('vire.ear.v3', JSON.stringify(m)), model)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)))
await page.goto(`${base}#/you`)
await page.waitForTimeout(3200)
await page.screenshot({ path: out })
await b.close()
console.log(out)
