#!/usr/bin/env node
// EEG booth protocol. Use WebKit because Chromium on this box can drop page loads.
//   bun scripts/fake-ears.ts 8899
//   node web/tests/e2e/eeg.mjs http://127.0.0.1:5899/ /bulk3/runs/depression/eeg/ ws://127.0.0.1:8899 http://127.0.0.1:8889
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { webkit } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5899/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/eeg'
const helper = process.argv[4] ?? 'ws://127.0.0.1:8899'
const apiBase = (process.argv[5] ?? 'http://127.0.0.1:8889').replace(/\/$/, '')
mkdirSync(out, { recursive: true })
const browser = await webkit.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.addInitScript(({ helper }) => { localStorage.setItem('vire.ears.url', helper); localStorage.setItem('vire.eeg.speed', '100') }, { helper })
await page.goto(`${base}#/eeg`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-start]', { timeout: 30000 })
await page.screenshot({ path: `${out}/ready.png` })
await page.click('[data-start]')
await page.waitForSelector('[data-saved]', { timeout: 30000 })
const text = await page.locator('.eeg-card').innerText()
if (!/Log ID/.test(text) || !/EEG code/.test(text)) throw new Error(`save result missing: ${text}`)
const response = await page.locator('[data-saved]').getAttribute('data-saved')
if (!response) throw new Error('saved result missing')
const id = await page.locator('[data-saved] p').first().innerText().then((s) => s.replace(/^Log ID\s+/, '').trim())
const res = await fetch(`${apiBase}/api/ear/eeg/${encodeURIComponent(id)}`, { headers: { authorization: 'Bearer eeg-test' } })
if (!res.ok) throw new Error(`stored log unavailable: ${res.status}`)
const log = await res.json()
const names = new Set(log.steps.map((s) => s.name))
for (const name of ['sync-1', 'eyes-open', 'eyes-closed', 'slow-breathing', 'smile-1', 'smile-2', 'smile-3', 'smile-4', 'sync-2']) if (!names.has(name)) throw new Error(`missing step ${name}`)
if (log.sync.length !== 6) throw new Error(`expected six sync beeps, got ${log.sync.length}`)
for (let i = 1; i < log.motion.length; i++) if (log.motion[i][0] < log.motion[i - 1][0]) throw new Error('motion epoch times are not rising')
for (let i = 1; i < log.heart.length; i++) if (log.heart[i].t < log.heart[i - 1].t) throw new Error('heart epoch times are not rising')
await page.screenshot({ path: `${out}/saved.png`, fullPage: true })
await browser.close()
if (errors.length) throw new Error(`browser errors: ${JSON.stringify(errors)}`)
console.log(`EEG ${id}: ${log.steps.length} steps, ${log.sync.length} sync beeps, ${log.motion.length} motion rows`)
