// bun scripts/realcheck.ts <job.json> <minute.json> > check.json
// Makes the bundle "Watch a real check" (#/heard) plays: one person's own check-in, camera off, replayed through the
// app's own reader with the model their setup found, and scored against what the screen asked. The bundle goes to
// the server with the worker's token (POST /api/ear/check); it never goes into the repo.
import { readFileSync } from 'node:fs'
import type { CheckBundle, CheckEvent, CheckScore } from '../shared/earcheck'
import { isCheckBundle } from '../shared/earcheck'
import { createEarReader } from '../web/src/tune/ear/index'

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const model = job.model
const file = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const rec = file.recording ?? file

const auc = (y: number[], p: number[]) => {
  const idx = p.map((v, i) => [v, y[i]]).sort((a, b) => a[0] - b[0])
  let rank = 0
  let pos = 0
  let neg = 0
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j < idx.length && idx[j][0] === idx[i][0]) j++
    const r = (i + j + 1) / 2
    for (let k = i; k < j; k++) {
      if (idx[k][1]) {
        rank += r
        pos++
      } else neg++
    }
    i = j
  }
  return pos && neg ? (rank - (pos * (pos + 1)) / 2) / (pos * neg) : NaN
}

// ---- the model's readings, as the app would have had them live ----
const reader = createEarReader(model)
const gyro = rec.device.gyro
const ticks: { t: number; p: Record<string, number>; on: string[] }[] = []
let lastT = -1
for (const h of rec.head) {
  const now = reader.push({ t: h[0] + 1000, source: 'airpods', pitch: h[1], yaw: h[2], roll: h[3], ax: h[4], ay: h[5], az: h[6], rx: gyro ? h[7] : undefined, ry: gyro ? h[8] : undefined, rz: gyro ? h[9] : undefined } as never)
  if (!now || now.t === lastT) continue
  ticks.push({ t: h[0], p: now.p as never, on: now.on as never })
  lastT = now.t
}

const score = (e: CheckEvent): CheckScore => {
  const asked = rec.steps.filter((s: { ask: string }) => s.ask === e) as { t0: number; t1: number }[]
  const heard = asked.filter((s) => ticks.some((k) => k.t >= s.t0 && k.t < s.t1 + 1000 && k.on.includes(e))).length
  let was = false
  let unasked = 0
  for (const k of ticks) {
    const on = k.on.includes(e)
    if (on && !was && !asked.some((s) => k.t >= s.t0 - 200 && k.t < s.t1 + 1000)) unasked++
    was = on
  }
  const y = ticks.map((k) => (asked.some((s) => k.t >= s.t0 + 500 && k.t < s.t1 + 500) ? 1 : 0))
  return { asked: asked.length, heard, unasked, auc: Math.round(auc(y, ticks.map((k) => k.p[e] ?? 0)) * 100) / 100 }
}

// ---- the head, for drawing: each angle unwrapped, its own 4 s average taken away, 25 a second ----
const rows = rec.head as number[][]
const flat = (col: number): number[] => {
  const v: number[] = []
  let off = 0
  for (let i = 0; i < rows.length; i++) {
    if (i) {
      const d = rows[i][col] - rows[i - 1][col]
      if (d > 180) off -= 360
      else if (d < -180) off += 360
    }
    v.push(rows[i][col] + off)
  }
  const out: number[] = []
  let a = 0
  let b = 0
  let sum = 0
  for (let i = 0; i < rows.length; i++) {
    while (b < rows.length && rows[b][0] <= rows[i][0] + 2000) sum += v[b++]
    while (rows[a][0] < rows[i][0] - 2000) sum -= v[a++]
    out.push(v[i] - sum / (b - a))
  }
  return out
}
const pitch = flat(1)
const yaw = flat(2)
const head: [number, number, number][] = []
let nextT = 0
for (let i = 0; i < rows.length; i++) {
  if (rows[i][0] < nextT) continue
  nextT = rows[i][0] + 40
  head.push([Math.round(rows[i][0]), Math.round(pitch[i] * 10) / 10, Math.round(yaw[i] * 10) / 10])
}

// ---- the readings, 12 a second: the highest number and any "heard" inside each 80 ms ----
const read: [number, number, number, number, number][] = []
for (let i = 0; i < ticks.length; ) {
  const t0 = ticks[i].t
  let pn = 0
  let ps = 0
  let on = 0
  let os = 0
  let j = i
  for (; j < ticks.length && ticks[j].t < t0 + 80; j++) {
    pn = Math.max(pn, ticks[j].p.nod ?? 0)
    ps = Math.max(ps, ticks[j].p.shake ?? 0)
    if (ticks[j].on.includes('nod')) on = 1
    if (ticks[j].on.includes('shake')) os = 1
  }
  read.push([Math.round(t0), Math.round(pn * 100) / 100, Math.round(ps * 100) / 100, on, os])
  i = j
}

const bundle: CheckBundle = {
  v: 1,
  recordedAt: rec.at,
  taughtAt: model.at,
  shell: rec.device.shell,
  taughtShell: model.shell,
  hz: rec.device.hz,
  ms: Math.round(rows[rows.length - 1][0]),
  steps: rec.steps.map((s: { t0: number; t1: number; ask: string }) => ({ t0: Math.round(s.t0), t1: Math.round(s.t1), ask: s.ask })),
  head,
  read,
  score: { nod: score('nod'), shake: score('shake') },
  model: {
    minutes: model.minutes,
    tried: model.tried,
    held: { nod: Math.round(model.events.nod.score.auc * 100) / 100, shake: Math.round(model.events.shake.score.auc * 100) / 100, smile: Math.round(model.events.smile.score.auc * 100) / 100 },
  },
}
if (!isCheckBundle(bundle)) throw new Error('the bundle does not pass its own check')
console.log(JSON.stringify(bundle))
