import { chromium } from '/home/ubuntu/.local/lib/node_modules/playwright/index.mjs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [baseUrl, out] = process.argv.slice(2)
if (!baseUrl || !out) throw new Error('usage: node scripts/poster.mjs <baseUrl> <out.pdf>')
mkdirSync(dirname(out), { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 })
await page.goto(`${baseUrl.replace(/\/$/, '')}/#/wall/poster`, { waitUntil: 'networkidle' })
await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
await browser.close()
console.log(`POSTER_PDF ${out}`)
