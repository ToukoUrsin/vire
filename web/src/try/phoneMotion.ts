// The phone's own motion sensor, standing in for the AirPods on /#/try. A phone held flat against the chest tilts a
// degree or two with each breath. The tilt is read from gravity alone (`accelerationIncludingGravity`): it needs no
// compass and does not drift. Hand tremor and sensor noise are smoothed away above about 1 Hz, and the samples (60 a
// second on an iPhone, 100 or more on some Androids, never quite even) are put on a steady 50 a second, in the same
// rows the AirPods give: [tMs, angle, angle, angle, gx, gy, gz, 0, 0, 0]. The turn rates stay zero on purpose, so
// that "still" is judged from the same smoothed tilt as the breath; the gyroscope is kept beside them, as it came.
export const OUT_HZ = 50
/**
 * A phone's browser now and then hands over nothing for a moment. A chest moves slowly, so up to a second is
 * joined with a straight line (and counted); above this the stretch has a hole and cannot be read.
 */
export const MAX_JOIN_MS = 1000
const CUT_HZ = 1.2
const DEG = 180 / Math.PI

export interface Vec3 {
  x: number
  y: number
  z: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const r = (v: number, p: number) => Math.round(v * p) / p

/**
 * Gravity as the phone feels it, to three tilt angles in degrees: how far each of the phone's own axes (across the
 * screen, along it, out of it) points above or below level. Whichever way the phone is held, two of the three move
 * with a small tilt. Null when there is no gravity to read (free fall, or a sensor that gives nothing).
 */
export function tiltOf(g: Vec3): [number, number, number] | null {
  if (!finite(g.x) || !finite(g.y) || !finite(g.z)) return null
  const n = Math.hypot(g.x, g.y, g.z)
  if (n < 1) return null
  const a = (v: number) => Math.asin(Math.max(-1, Math.min(1, v / n))) * DEG
  return [a(g.x), a(g.y), a(g.z)]
}

/** Uneven sensor samples in, steady smoothed rows out. Times are in ms on whatever clock the caller keeps. */
export class MotionStream {
  /** rows for breath.ts: [t, tiltX, tiltY, tiltZ, gx, gy, gz, 0, 0, 0], gravity as a share of itself */
  readonly rows: number[][] = []
  /** the gyroscope as it came, on the same steady times: [t, degrees a second about x, y, z] */
  readonly gyro: number[][] = []
  /** samples the sensor gave */
  count = 0
  /** holes longer than MAX_JOIN_MS */
  holes = 0
  /** pauses of 0.3 to 1 second that were joined */
  joined = 0
  private readonly stepMs: number
  private first = 0
  private lastT = 0
  private prev: { t: number; g: number[]; rot: number[] | null } | null = null
  /** two smoothing stages, one after the other */
  private s1: number[] = [0, 0, 0]
  private s2: number[] = [0, 0, 0]
  private nextT = 0

  constructor(outHz = OUT_HZ) {
    this.stepMs = 1000 / outHz
  }

  /** samples a second the sensor has been giving */
  get inHz(): number {
    return this.count > 1 && this.lastT > this.first ? ((this.count - 1) * 1000) / (this.lastT - this.first) : 0
  }

  /** one sensor sample; the rows it completed are returned (and kept in `rows`) */
  push(tMs: number, gravity: Vec3 | null | undefined, rotation?: { alpha: number | null; beta: number | null; gamma: number | null } | null): number[][] {
    if (!gravity || !finite(tMs) || !finite(gravity.x) || !finite(gravity.y) || !finite(gravity.z)) return []
    const raw = [gravity.x, gravity.y, gravity.z]
    if (Math.hypot(raw[0]!, raw[1]!, raw[2]!) < 1) return []
    const rot = rotation && finite(rotation.alpha) && finite(rotation.beta) && finite(rotation.gamma) ? [rotation.alpha, rotation.beta, rotation.gamma] : null
    if (!this.count) this.first = tMs
    this.count++
    const prev = this.prev
    // samples handed over in one batch share a time: keep their order, a millisecond apart
    const t = prev ? Math.max(tMs, prev.t + 1) : tMs
    this.lastT = t
    if (!prev || t - prev.t > MAX_JOIN_MS) {
      if (prev) this.holes++
      this.s1 = raw.slice()
      this.s2 = raw.slice()
      this.prev = { t, g: raw.slice(), rot }
      this.nextT = prev ? Math.ceil(t / this.stepMs) * this.stepMs : t
      return []
    }
    if (t - prev.t > 300) this.joined++
    const k = 1 - Math.exp((-2 * Math.PI * CUT_HZ * (t - prev.t)) / 1000)
    for (let i = 0; i < 3; i++) {
      this.s1[i] = this.s1[i]! + (raw[i]! - this.s1[i]!) * k
      this.s2[i] = this.s2[i]! + (this.s1[i]! - this.s2[i]!) * k
    }
    const now = { t, g: this.s2.slice(), rot }
    const out: number[][] = []
    while (this.nextT <= t) {
      const u = (this.nextT - prev.t) / (t - prev.t)
      const g = { x: prev.g[0]! + (now.g[0]! - prev.g[0]!) * u, y: prev.g[1]! + (now.g[1]! - prev.g[1]!) * u, z: prev.g[2]! + (now.g[2]! - prev.g[2]!) * u }
      const tilt = tiltOf(g)
      if (tilt) {
        const n = Math.hypot(g.x, g.y, g.z)
        const row = [Math.round(this.nextT), r(tilt[0], 1000), r(tilt[1], 1000), r(tilt[2], 1000), r(g.x / n, 10000), r(g.y / n, 10000), r(g.z / n, 10000), 0, 0, 0]
        this.rows.push(row)
        out.push(row)
        const gr = rot ?? prev.rot
        if (gr) this.gyro.push([row[0]!, r(gr[0]!, 100), r(gr[1]!, 100), r(gr[2]!, 100)])
      }
      this.nextT += this.stepMs
    }
    this.prev = now
    return out
  }
}

type MotionEventLike = { accelerationIncludingGravity?: Partial<Vec3> | null; rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null } | null }
type Asking = { requestPermission?: () => Promise<string> }

/**
 * Ask for the motion sensor. Call inside a tap, before anything is awaited: an iPhone only shows its question
 * from one. Phones that do not ask (Android) answer 'granted' at once.
 */
export function askMotion(): Promise<'granted' | 'denied'> {
  const D = (globalThis as unknown as { DeviceMotionEvent?: Asking }).DeviceMotionEvent
  if (!D || typeof D.requestPermission !== 'function') return Promise.resolve('granted')
  try {
    return D.requestPermission().then(
      (v) => (v === 'granted' ? 'granted' : 'denied'),
      () => 'denied' as const,
    )
  } catch {
    return Promise.resolve('denied')
  }
}

/** Feed the stream from the phone's sensor. `now` is the page's own clock in ms. Returns how to stop. */
export function listenMotion(stream: MotionStream, now: () => number, onRows?: (rows: number[][]) => void): () => void {
  const on = (e: Event) => {
    const m = e as unknown as MotionEventLike
    const g = m.accelerationIncludingGravity
    if (!g || !finite(g.x) || !finite(g.y) || !finite(g.z)) return
    const rows = stream.push(now(), { x: g.x, y: g.y, z: g.z }, m.rotationRate)
    if (rows.length && onRows) onRows(rows)
  }
  window.addEventListener('devicemotion', on)
  return () => window.removeEventListener('devicemotion', on)
}
