// Did the walk happen: read from the AirPods alone. A walking head bobs once a step, so the acceleration the
// AirPods feel has a steady beat between about 80 and 150 steps a minute. Each four seconds of the stretch are
// asked: is there such a beat, and is it strong enough to be steps and not a nod. Pure.
export interface WalkRead {
  /** seconds of the stretch in which steps were felt */
  walkedS: number
  /** seconds of the stretch that could be read at all */
  ofS: number
  /** steps a minute while walking; null when no walking was felt */
  stepsPerMin: number | null
}

const WIN_MS = 4000
const HOP_MS = 2000
const F0 = 1.3
const F1 = 2.6
/** a walking head moves at least this much at the step beat, in g */
const MIN_G = 0.02
/** and that beat holds at least this share of the axis' movement */
const MIN_SHARE = 0.3

function beat(t: number[], x: number[]): { f: number; amp: number; share: number } | null {
  const n = x.length
  if (n < 24) return null
  const m = x.reduce((a, b) => a + b, 0) / n
  const v = x.reduce((a, b) => a + (b - m) ** 2, 0) / n
  if (!(v > 0)) return null
  let best = { f: 0, amp: 0, share: 0 }
  for (let f = F0; f <= F1 + 1e-9; f += 0.05) {
    let c = 0
    let s = 0
    for (let i = 0; i < n; i++) {
      const ph = 2 * Math.PI * f * (t[i] / 1000)
      c += (x[i] - m) * Math.cos(ph)
      s += (x[i] - m) * Math.sin(ph)
    }
    const amp = (2 / n) * Math.hypot(c, s)
    if (amp > best.amp) best = { f, amp, share: Math.min(1, (amp * amp) / 2 / v) }
  }
  return best
}

/** one four-second stretch, read: did it have a step beat, and at what pace */
export interface WalkWindow {
  /** where the stretch starts, on the rows' clock (ms); it covers a .. a + 4000 */
  a: number
  walked: boolean
  /** steps a second of the strongest beat; null when the stretch had too few samples to be read */
  f: number | null
}

/** Each four seconds from t0 to t1, two seconds apart, asked whether it was steps. Stretches with too few samples are left out. */
export function walkWindows(rows: number[][], t0: number, t1: number): WalkWindow[] {
  const part = rows.filter((r) => r[0] >= t0 && r[0] <= t1)
  if (part.some((r, i) => i > 0 && r[0] < part[i - 1][0])) part.sort((x, y) => x[0] - y[0])
  const out: WalkWindow[] = []
  let i0 = 0
  for (let a = t0; a + WIN_MS <= t1 + 1; a += HOP_MS) {
    while (i0 < part.length && part[i0][0] < a) i0++
    let i1 = i0
    while (i1 < part.length && part[i1][0] < a + WIN_MS) i1++
    const w = part.slice(i0, i1)
    if (w.length < 24) continue
    const t = w.map((r) => r[0])
    let top: { f: number; amp: number; share: number } | null = null
    for (const col of [4, 5, 6]) {
      const b = beat(t, w.map((r) => r[col]))
      if (b && (!top || b.amp > top.amp)) top = b
    }
    const walked = !!top && top.amp >= MIN_G && top.share >= MIN_SHARE
    out.push({ a, walked, f: top ? top.f : null })
  }
  return out
}

/** rows are [t, pitch, yaw, roll, ax, ay, az, ...] as in a teaching minute */
export function walkRead(rows: number[][], t0: number, t1: number): WalkRead {
  const wins = walkWindows(rows, t0, t1)
  const beats = wins.filter((w) => w.walked).map((w) => w.f as number).sort((x, y) => x - y)
  const walked = beats.length * HOP_MS
  const of = wins.length * HOP_MS
  return { walkedS: Math.round(walked / 1000), ofS: Math.round(of / 1000), stepsPerMin: beats.length ? Math.round(beats[beats.length >> 1] * 60) : null }
}
