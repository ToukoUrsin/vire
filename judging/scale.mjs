#!/usr/bin/env node
// Lists every value in web/src that is not on the scales in web/src/shared/theme.css. Exits 1 when there is one.
//   node judging/scale.mjs            (from the repo root)
// What it checks, in each stylesheet and in the lab's inline styles:
//   type     font-size must be a --text-* token (clamp()/max()/calc() and canvas units are fluid by design)
//   radius   border-radius must be a --radius-* token, 50%, 0 or inherit
//   motion   a transition or one-shot animation takes a --dur-* token and --ease / --ease-loop / linear;
//            a loop (infinite) keeps its own period
//   space    padding, margin and gap sit on 2 4 6 8 10 12 14 16 20 24 28 32 40 48 56 64 80 96 (1 px hairlines pass)
// A block drawn on a fixed canvas (the hall wall at 1920 x 1080) is fenced with
//   /* scale:off <why> */ ... /* scale:on */   and keeps its own type and spacing; radius and motion still apply.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../web/src/', import.meta.url))
const GRID = new Set([0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96])
const files = []
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (f.endsWith('.css') || f === 'Lab.tsx') files.push(p)
  }
}
walk(root)

const found = []
for (const file of files) {
  const name = relative(root, file)
  let text = readFileSync(file, 'utf8')
  if (file.endsWith('.tsx')) {
    const m = text.match(/const CSS = `([\s\S]*?)`/)
    if (!m) continue
    text = m[1].replace(/([{;])\s*/g, '$1\n') // one declaration a line
  }
  let off = false
  text.split('\n').forEach((line, i) => {
    if (/\/\*\s*scale:off/.test(line)) off = true
    if (/\/\*\s*scale:on/.test(line)) off = false
    const d = line.match(/^\s*([\w-]+):\s*(.+?);?\s*$/)
    if (!d || line.includes('/*')) return
    const [, prop, val] = d
    const say = (kind, why) => found.push(`${name}:${i + 1}  ${kind}  ${prop}: ${val}${why ? `   (${why})` : ''}`)
    const fluid = /clamp\(|min\(|max\(|calc\(|v[wh]\b|mm\b/.test(val)
    if (prop === 'font-size' && !off && !fluid && /\d(px|rem)\b/.test(val)) say('type')
    if (/^border(-[a-z]+)*-radius$/.test(prop) && !/calc\(|mm\b/.test(val) && /[1-9]\d*(\.\d+)?px/.test(val)) say('radius')
    if (/^(transition|animation)(-duration|-timing-function)?$/.test(prop)) {
      for (const part of val.split(/,(?![^(]*\))/)) {
        if (/cubic-bezier\(|(?<![-\w])ease(-in-out|-out|-in)?(?![-\w(])/.test(part)) say('motion', 'easing')
        const t = part.match(/(?<![\w.#-])(\d+(?:\.\d+)?)(ms|s)\b/)
        const ms = t ? Number(t[1]) * (t[2] === 's' ? 1000 : 1) : 0
        // after a --dur-* token the literal time is a delay, and a delay is a stagger, not a speed
        if (t && !/infinite|var\(--dur-/.test(part) && ms >= 80 && ms <= 950) say('motion', 'duration')
      }
    }
    if (/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/.test(prop) && !off && !/clamp\(|min\(|max\(|v[wh]\b|mm\b|em\b/.test(val)) {
      for (const m of val.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)px/g)) if (!GRID.has(Number(m[1])) && Number(m[1]) >= 2 && Number(m[1]) <= 100) say('space', `${m[1]}px`)
    }
  })
}

if (found.length) {
  console.log(found.join('\n'))
  console.log(`\n${found.length} value${found.length === 1 ? '' : 's'} off the scales in web/src/shared/theme.css`)
  process.exit(1)
}
console.log(`${files.length} files, every type size, radius, duration, easing and spacing is on the scales in web/src/shared/theme.css`)
