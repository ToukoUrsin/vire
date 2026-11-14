#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('/home/ubuntu/.local/lib/node_modules/playwright')
const base = (process.argv[2] ?? 'http://127.0.0.1:5889/').replace(/\/?$/, '/')
const out = process.argv[3] ?? '/bulk3/runs/depression/usual'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.evaluate(async () => {
  const [{ UsualFromMinutes }, { simulateTeach }, ReactModule, ReactDOMModule] = await Promise.all([
    import('/src/tune/usual/Usual.tsx'),
    import('/src/tune/ear/sim.ts'),
    import('/node_modules/.vite/deps/react.js'),
    import('/node_modules/.vite/deps/react-dom_client.js'),
  ])
  const React = ReactModule.default ?? ReactModule
  const ReactDOM = ReactDOMModule.default ?? ReactDOMModule
  const at = (minute) => new Date(Date.UTC(2026, 10, 14, 9, minute)).toISOString()
  const minutes = [
    simulateTeach({ seed: 1, smileSize: 2, at: at(0) }),
    simulateTeach({ seed: 2, smileSize: 2.5, at: at(1) }),
    simulateTeach({ seed: 3, smileSize: 4, at: at(2) }),
  ]
  const host = document.createElement('div')
  host.id = 'usual-shot-root'
  document.body.appendChild(host)
  document.body.style.margin = '0'
  document.body.style.background = '#fff'
  for (const child of Array.from(document.body.children)) {
    if (child !== host) child.setAttribute('hidden', 'true')
  }
  ReactDOM.createRoot(host).render(React.createElement(UsualFromMinutes, { minutes, big: false }))
})
await page.waitForSelector('.us-shell')
await page.screenshot({ path: `${out}/usual-phone-390x844.png` })
await page.evaluate(() => {
  const shell = document.querySelector('.us-shell')
  shell?.classList.add('us-big')
})
await page.setViewportSize({ width: 1920, height: 1080 })
await page.screenshot({ path: `${out}/usual-big-1920x1080.png` })
await browser.close()
if (errors.length) {
  console.error(`BROWSER_ERRORS ${JSON.stringify(errors.slice(0, 8))}`)
  process.exit(1)
}
