// The teachers. For every AirPods sample: did the camera see a smile, did it see the head nod or shake,
// did the microphone hear a laugh or talk. 1 = yes, 0 = no, -1 = the teacher cannot say (no face, the moment
// something starts or stops, a smile left over from a laugh): those moments are neither taught nor checked.
import type { EarAsk, EarEvent, EarRecording, EarStep } from '@shared/ear'

export type EarLabels = Record<EarEvent, number[]>

const median = (a: number[]) => {
  if (!a.length) return 0
  const b = a.slice().sort((x, y) => x - y)
  return b[b.length >> 1]
}
const quantile = (a: number[], q: number) => {
  if (!a.length) return 0
  const b = a.slice().sort((x, y) => x - y)
  const p = (b.length - 1) * Math.max(0, Math.min(1, q))
  const i = Math.floor(p)
  return b[i] + (b[Math.min(i + 1, b.length - 1)] - b[i]) * (p - i)
}

function unwrap(values: number[]): number[] {
  if (!values.length) return []
  const out = [values[0]]
  for (let i = 1; i < values.length; i++) {
    let d = values[i] - values[i - 1]
    while (d > 180) d -= 360
    while (d < -180) d += 360
    out.push(out[i - 1] + d)
  }
  return out
}

/** the steps that ask for one thing, and how close `t` is to them: inside, in the margin around, or away */
function where(steps: EarStep[], ask: EarAsk, t: number, pad: number): 'in' | 'near' | 'away' {
  let near = false
  for (const s of steps) {
    if (s.ask !== ask) continue
    if (t >= s.t0 && t < s.t1) return 'in'
    if (t >= s.t0 - pad && t < s.t1 + pad) near = true
  }
  return near ? 'near' : 'away'
}

/** Camera and microphone teachers, sampled at each AirPods timestamp. */
export function makeEarLabels(rec: EarRecording): EarLabels {
  const out: EarLabels = { smile: [], nod: [], shake: [], laugh: [], talk: [] }
  const face = rec.face.filter(r => r[1] > 0)
  const ft = face.map(r => r[0])
  const fPitch = unwrap(face.map(r => r[6] ?? 0))
  const fYaw = unwrap(face.map(r => r[7] ?? 0))
  const inAsk = (t: number, asks: EarAsk[]) => rec.steps.some(s => asks.includes(s.ask) && t >= s.t0 && t < s.t1)

  const restSmiles = face.filter(r => inAsk(r[0], ['rest', 'relax'])).map(r => r[2])
  const posed = face.filter(r => inAsk(r[0], ['smile'])).map(r => r[2])
  const restLevel = median(restSmiles.length ? restSmiles : face.map(r => r[2]))
  const top = quantile(posed.length ? posed : face.map(r => r[2]), 0.9)
  // a camera that never saw the smile go up cannot teach one
  const span = top - restLevel >= 0.12 ? top - restLevel : Infinity
  const restLoud = median(rec.voice.filter(r => inAsk(r[0], ['rest', 'relax'])).map(r => r[1]))

  let f0 = 0; let f1 = 0; let fn = 0   // camera frames within ±600 ms, and the nearest one
  let v0 = 0; let v1 = 0               // microphone rows within ±500 ms
  for (const h of rec.head) {
    const t = h[0]
    while (f0 < face.length && ft[f0] < t - 600) f0++
    while (f1 < face.length && ft[f1] <= t + 600) f1++
    while (fn + 1 < face.length && Math.abs(ft[fn + 1] - t) <= Math.abs(ft[fn] - t)) fn++
    while (v0 < rec.voice.length && rec.voice[v0][0] < t - 500) v0++
    while (v1 < rec.voice.length && rec.voice[v1][0] <= t + 500) v1++

    const seen = face.length > 0 && Math.abs(ft[fn] - t) <= 300
    if (!seen) { for (const e of Object.keys(out) as EarEvent[]) out[e].push(-1); continue }

    const share = (face[fn][2] - restLevel) / span
    const jaw = face[fn][4] ?? 0
    let pMin = Infinity; let pMax = -Infinity; let yMin = Infinity; let yMax = -Infinity
    for (let i = f0; i < f1; i++) {
      if (fPitch[i] < pMin) pMin = fPitch[i]
      if (fPitch[i] > pMax) pMax = fPitch[i]
      if (fYaw[i] < yMin) yMin = fYaw[i]
      if (fYaw[i] > yMax) yMax = fYaw[i]
    }
    const pitchSwing = f1 > f0 ? pMax - pMin : 0
    const yawSwing = f1 > f0 ? yMax - yMin : 0
    let voiced = 0; let loud = -120
    for (let i = v0; i < v1; i++) { voiced += rec.voice[i][2] > 0.5 ? 1 : 0; if (rec.voice[i][1] > loud) loud = rec.voice[i][1] }
    const heard = v1 > v0 && (voiced / (v1 - v0) >= 0.15 || loud >= restLoud + 5)

    // smile: the camera decides, wherever in the minute. A smile inside the nods, the laugh or the count is
    // left out: it is a laugh's smile on a moving head, and the laugh has its own row.
    const calm = inAsk(t, ['rest', 'smile', 'relax'])
    out.smile.push(share >= 0.5 ? (calm ? 1 : -1) : share <= 0.2 ? 0 : -1)

    // nod and shake: asked for, and the camera saw the head swing
    const nodAt = where(rec.steps, 'nod', t, 700)
    out.nod.push(nodAt === 'away' ? 0 : pitchSwing >= 5 ? 1 : -1)
    const shakeAt = where(rec.steps, 'shake', t, 700)
    out.shake.push(shakeAt === 'away' ? 0 : yawSwing >= 6 ? 1 : -1)

    // laugh and talk: asked for, and the microphone heard a voice or the camera saw the mouth go
    const laughAt = where(rec.steps, 'laugh', t, 1500)
    const talkAt = where(rec.steps, 'talk', t, 1500)
    const laughing = heard || jaw >= 0.06 || share >= 0.4
    const talking = (heard || jaw >= 0.05) && share < 0.4
    out.laugh.push(laughAt === 'in' ? (laughing ? 1 : -1) : laughAt === 'near' ? (laughing ? -1 : 0) : 0)
    out.talk.push(talkAt === 'in' ? (talking ? 1 : -1) : talkAt === 'near' ? (heard || jaw >= 0.05 ? -1 : 0) : 0)
  }
  return out
}

export const labelsFromRecording = makeEarLabels
export const buildEarLabels = makeEarLabels
export const labelEarEvents = makeEarLabels
export const makeLabels = makeEarLabels
