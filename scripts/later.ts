// bun scripts/later.ts <job.json> <minute.json ...>: the model the sandbox found for one person, replayed with the app's own
// reader over minutes it was not taught from, scored against what the screen asked (no camera needed).
import { readFileSync } from 'node:fs'
import { createEarReader } from '../web/src/tune/ear/index'
const job = JSON.parse(readFileSync(process.argv[2], 'utf8')); const model = job.model
const load = (p: string) => { const d = JSON.parse(readFileSync(p, 'utf8')); return d.recording ?? d }
const auc = (y: number[], p: number[]) => { const idx = p.map((v, i) => [v, y[i]]).sort((a, b) => a[0] - b[0]); let rank = 0, pos = 0, neg = 0, i = 0; while (i < idx.length) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (idx[k][1]) { rank += r; pos++ } else neg++; i = j } return pos && neg ? (rank - pos * (pos + 1) / 2) / (pos * neg) : NaN }
console.log(`model: by ${model.by}, taught ${model.at}, ${model.minutes} minutes, ${model.shell} ${model.hz} Hz; live events: ${Object.entries(model.events).filter(([, v]: any) => v.score.ok).map(([e]) => e).join(', ')}`)
for (const f of process.argv.slice(3)) {
  const rec = load(f); const r = createEarReader(model)
  const gyro = rec.device.gyro
  const stepAt = (t: number) => rec.steps.find((s: any) => t >= s.t0 && t < s.t1)
  const ticks: { t: number; ask: string; p: Record<string, number>; on: string[] }[] = []
  let lastT = -1
  for (const h of rec.head) {
    const now = r.push({ t: h[0] + 1000, source: 'airpods', pitch: h[1], yaw: h[2], roll: h[3], ax: h[4], ay: h[5], az: h[6], rx: gyro ? h[7] : undefined, ry: gyro ? h[8] : undefined, rz: gyro ? h[9] : undefined } as any)
    if (!now || now.t === lastT) continue
    ticks.push({ t: h[0], ask: stepAt(h[0])?.ask ?? '-', p: now.p as any, on: now.on as any }); lastT = now.t
  }
  console.log(`\n== ${f.split('/').pop()}  ${rec.device.shell} ${rec.device.hz} Hz, kind ${rec.kind ?? 'teaching'}, ${rec.face.length} camera frames, recorded ${rec.at}`)
  for (const e of ['nod', 'shake'] as const) {
    const asked = rec.steps.filter((s: any) => s.ask === e)
    // heard: the event was on at some point from the ask until 1 s after it ended
    const heard = asked.filter((s: any) => ticks.some(k => k.t >= s.t0 && k.t < s.t1 + 1000 && k.on.includes(e))).length
    // starts outside: the event switched on while something else was asked (more than 1 s after an ask of it ended)
    let was = false; let outside = 0; const where: Record<string, number> = {}
    for (const k of ticks) { const on = k.on.includes(e); if (on && !was) { const near = asked.some((s: any) => k.t >= s.t0 - 200 && k.t < s.t1 + 1000); if (!near) { outside++; where[k.ask] = (where[k.ask] ?? 0) + 1 } } was = on }
    // how well its number separates the asked seconds from the rest (asked windows shifted 0.5 s for the reaction)
    const y = ticks.map(k => (asked.some((s: any) => k.t >= s.t0 + 500 && k.t < s.t1 + 500) ? 1 : 0)); const p = ticks.map(k => k.p[e] ?? 0)
    console.log(`  ${e.padEnd(5)} heard ${heard} of ${asked.length} asked; switched on ${outside} times when it was not asked ${JSON.stringify(where)}; asked seconds against the rest: ${auc(y, p).toFixed(2)} (${ticks.length} readings)`)
  }
}
