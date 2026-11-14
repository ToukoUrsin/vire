#!/usr/bin/env node
// The pitch deck PDF the Junction form asks for. Product pictures are frames of the film's own captures
// (film/assets/capture, made by film/capture.sh), so the deck always shows the product as the film does.
//   node pitch/deck/build.mjs            -> /bulk2/runs/depression/deck/vire-deck.pdf (+ one PNG per slide)
// Every number on a slide has a row in pitch/claims.md.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const out = '/bulk2/runs/depression/deck'
const frames = join(out, 'frames')
mkdirSync(frames, { recursive: true })
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const { renderSVG } = require(join(root, 'web/node_modules/uqr'))

// clip, seconds into it, name
const SHOTS = [
  ['stage-laugh', 7, 'stage-laugh'],
  ['phone-nod', 2, 'phone-nod'],
  ['phone-laugh', 7, 'phone-laugh'],
  ['phone-speak', 6, 'phone-speak'],
  ['phone-breathe', 10, 'phone-breathe'],
  ['phone-echo', 10, 'phone-echo'],
  ['phone-offer', 5, 'phone-offer'],
  ['phone-dose', 8, 'phone-dose'],
  ['phone-after', 6, 'phone-after'],
  ['clinic-list', 4, 'clinic-list'],
  ['clinic-patient', 5, 'clinic-patient'],
]
for (const [clip, at, name] of SHOTS) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(at), '-i', join(root, 'film/assets/capture', `${clip}.mp4`), '-frames:v', '1', join(frames, `${name}.png`)])
}

const qr = renderSVG('https://vire.fly.dev/#/visit', { border: 0, whiteColor: '#f3ecdf', blackColor: '#14110d' })
const html = readFileSync(join(here, 'deck.html'), 'utf8').replaceAll('FRAMES/', `file://${frames}/`).replace('QRSVG', qr)
const built = join(here, '.deck.built.html')
writeFileSync(built, html)

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await page.goto(`file://${built}`)
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
await page.pdf({ path: join(out, 'vire-deck.pdf'), width: '1920px', height: '1080px', printBackground: true })
const n = await page.locator('.slide').count()
for (let i = 0; i < n; i++) {
  await page.locator('.slide').nth(i).screenshot({ path: join(out, `slide-${String(i + 1).padStart(2, '0')}.png`) })
}
await b.close()
console.log(`${n} slides -> ${join(out, 'vire-deck.pdf')}`)
