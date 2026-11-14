#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '/home/ubuntu/.local/lib/node_modules/playwright/index.mjs'

const base = process.argv[2] || 'http://127.0.0.1:5882/'
const out = process.argv[3] || '/bulk3/runs/depression/ear/teach/'
await fs.mkdir(out, { recursive: true })
const errors = []
const sizes = [{ name: 'phone', width: 390, height: 844 }, { name: 'desk', width: 1440, height: 900 }]
const browser = await chromium.launch({ headless: true })

for (const size of sizes) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${size.name}: ${e.message}`))
  try {
    await page.goto(`${base.replace(/\/$/, '')}/?mock=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.getByText('Teach your AirPods your smile.').waitFor({ state: 'visible', timeout: 30000 })
    await page.screenshot({ path: path.join(out, `first-${size.name}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Connect AirPods' }).click()
    await page.screenshot({ path: path.join(out, `connect-${size.name}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Start the minute' }).click()
    await page.waitForSelector('.va-teach', { timeout: 30000 })
    await page.screenshot({ path: path.join(out, `teach-start-${size.name}.png`), fullPage: true })
    await page.waitForTimeout(15000)
    await page.screenshot({ path: path.join(out, `teach-middle-${size.name}.png`), fullPage: true })
    await page.waitForTimeout(50000)
    await page.waitForSelector('.va-ear-result', { timeout: 10000 })
    await page.screenshot({ path: path.join(out, `result-${size.name}.png`), fullPage: true })
  } catch (e) {
    errors.push(`${size.name}: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await page.close()
    await context.close()
  }
}
await browser.close()
console.log(`TEACH_ERRORS ${JSON.stringify(errors)}`)
if (errors.length) process.exitCode = 1
