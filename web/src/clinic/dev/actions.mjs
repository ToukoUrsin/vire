// Clicks the two clinician actions and checks that state follows: "Request booster session" (POST on/off,
// read back from the server and from the list) and "Mark called" (clinic-local).
//   node web/src/clinic/dev/actions.mjs [baseUrl] [outDir] [apiUrl] [mock|real]
// Leaves the booster flag as it found it.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(`${execSync('npm root -g').toString().trim()}/playwright`)

const base = (process.argv[2] ?? 'http://127.0.0.1:5874').replace(/\/$/, '')
const out = process.argv[3] ?? '/bulk2/runs/depression/clinic'
const api = (process.argv[4] ?? 'http://127.0.0.1:8871').replace(/\/$/, '')
const mode = process.argv[5] ?? 'real'
const q = mode === 'mock' ? '?mock=1' : ''
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
const results = []
const check = (name, ok, note = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? `  (${note})` : ''}`)
}
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(`${base}/#/clinic${q}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.cl-name')
const href = await page.$eval('.cl-name', (a) => a.getAttribute('href'))
const id = decodeURIComponent(href.replace(/\?.*$/, '').split('/').pop())
const server = async () => (mode === 'mock' ? null : (await (await fetch(`${api}/api/clinic/patients/${id}`)).json()).boosterRequested)
const before = await server()

// mark called on the list
const callBtn = page.locator('.cl-row .cl-btn--small').first()
await callBtn.click()
check('list: "Mark called" becomes "Called HH:MM"', /Called \d/.test(await callBtn.innerText()), await callBtn.innerText())

// patient page: booster on
await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.cl-actions, .cl-btn--primary')
check('patient: called state carried over from the list', /Called today/.test(await page.locator('body').innerText()))
if (before) {
  await page.getByText('Withdraw request').click()
  await page.waitForTimeout(500)
}
await page.getByRole('button', { name: 'Request booster session' }).click()
await page.waitForTimeout(600)
check('patient: shows "Booster session requested"', await page.getByText('Booster session requested').isVisible())
if (mode !== 'mock') check('server: boosterRequested is true', (await server()) === true)
await page.screenshot({ path: `${out}/${mode}-patient-booster-on-desktop.png` })

// reflected in the list
await page.goto(`${base}/#/clinic${q}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.cl-name')
check('list: row carries "Booster requested"', (await page.locator('.cl-row').first().innerText()).includes('Booster requested'))
await page.screenshot({ path: `${out}/${mode}-today-booster-on-desktop.png` })

// and off again
await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' })
await page.getByText('Withdraw request').click()
await page.waitForTimeout(600)
check('patient: back to "Request booster session"', await page.getByRole('button', { name: 'Request booster session' }).isVisible())
if (mode !== 'mock') check('server: boosterRequested is false', (await server()) === false)

// restore
if (before) {
  await page.getByRole('button', { name: 'Request booster session' }).click()
  await page.waitForTimeout(500)
}
await page.goto(`${base}/#/clinic${q}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.cl-name')
await page.locator('.cl-row .cl-btn--small').first().click() // un-mark called

await browser.close()
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${[...new Set(errors)].join('\n')}` : 'no console errors')
process.exit(results.every(Boolean) && !errors.length ? 0 : 1)
