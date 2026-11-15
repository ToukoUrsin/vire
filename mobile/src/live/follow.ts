// What is happening right now: nod, head shake, smile. A person's own model answers where it passed its check;
// where it did not (or there is no model yet), a plain rule on the head angles answers for nods and head shakes,
// and the camera, when it is on, answers for the smile. Every answer carries where it came from.
import type { EarModel2 } from '@shared/ear'
import type { HeadFrame } from '@web/sense/types'
import { createEarReader, type EarReader } from '@web/tune/ear'

export type Seen = 'nod' | 'shake' | 'smile'
export const SEEN: Seen[] = ['nod', 'shake', 'smile']
export type By = 'model' | 'rule' | 'camera' | 'none'
export interface Now {
  p: Record<Seen, number>
  on: Record<Seen, boolean>
  counts: Record<Seen, number>
  by: Record<Seen, By>
  /** the newest thing seen and when (performance.now) */
  last: { e: Seen; t: number } | null
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** a back-and-forth swing in one angle over the last second or so: rows of [t, pitch, yaw unwrapped] */
function swing(buf: number[][], col: number, other: number, min: number): { on: boolean; p: number } {
  if (buf.length < 12) return { on: false, p: 0 }
  const span = (c: number) => {
    let lo = Infinity
    let hi = -Infinity
    for (const r of buf) {
      if (r[c] < lo) lo = r[c]
      if (r[c] > hi) hi = r[c]
    }
    return hi - lo
  }
  const size = span(col)
  const soft = clamp01(size / (min * 2)) * 0.6
  if (size < min || size < span(other)) return { on: false, p: Math.min(soft, 0.45) }
  const mean = buf.reduce((a, r) => a + r[col], 0) / buf.length
  let flips = 0
  let sign = 0
  for (const r of buf) {
    const d = r[col] - mean
    const now = d > size * 0.15 ? 1 : d < -size * 0.15 ? -1 : 0
    if (now && now !== sign) {
      if (sign) flips++
      sign = now
    }
  }
  return flips >= 2 ? { on: true, p: clamp01(0.7 + size / (min * 8)) } : { on: false, p: Math.min(soft, 0.45) }
}

export class Follow {
  private reader: EarReader | null = null
  private model: EarModel2 | null = null
  private buf: number[][] = []
  private yaw = 0
  private lastYaw: number | null = null
  private until: Partial<Record<Seen, number>> = {}
  private cameraSmile = false
  now: Now = { p: { nod: 0, shake: 0, smile: 0 }, on: { nod: false, shake: false, smile: false }, counts: { nod: 0, shake: 0, smile: 0 }, by: { nod: 'rule', shake: 'rule', smile: 'none' }, last: null }

  constructor(model: EarModel2 | null) {
    this.use(model)
  }

  use(model: EarModel2 | null): void {
    this.model = model
    try {
      this.reader = model ? createEarReader(model) : null
    } catch {
      this.reader = null
    }
    for (const e of ['nod', 'shake'] as const) this.now.by[e] = model?.events[e]?.score.ok ? 'model' : 'rule'
    this.now.by.smile = model?.events.smile?.score.ok ? 'model' : this.cameraSmile ? 'camera' : 'none'
  }

  private rise(e: Seen, on: boolean, t: number): void {
    if (on && !this.now.on[e]) {
      this.now.counts[e]++
      this.now.last = { e, t: performance.now() }
    }
    if (on) this.until[e] = t + 600
    if (on || t > (this.until[e] ?? 0)) this.now.on[e] = on
  }

  /** one head sample: from the AirPods (the model reads it), or a head pose from the camera (rule only) */
  head(h: HeadFrame | { t: number; pitch: number; yaw: number }, fromAirPods = true): void {
    let d = this.lastYaw == null ? 0 : h.yaw - this.lastYaw
    if (d > 180) d -= 360
    else if (d < -180) d += 360
    this.yaw += d
    this.lastYaw = h.yaw
    this.buf.push([h.t, h.pitch, this.yaw])
    while (this.buf.length && h.t - this.buf[0][0] > 1300) this.buf.shift()
    const ruled = (['nod', 'shake'] as const).filter((e) => !fromAirPods || this.now.by[e] !== 'model')
    for (const e of ruled) {
      const r = e === 'nod' ? swing(this.buf, 1, 2, 6) : swing(this.buf, 2, 1, 9)
      this.now.p[e] = r.p
      this.rise(e, r.on, h.t)
    }
    if (fromAirPods && this.reader) {
      try {
        const n = this.reader.push(h as HeadFrame)
        if (n) {
          for (const e of SEEN) {
            if (this.now.by[e] !== 'model') continue
            this.now.p[e] = n.p[e] ?? 0
            this.rise(e, n.on.includes(e), h.t)
          }
        }
      } catch (err) {
        console.error('[live] reader failed', err)
        this.reader = null
        for (const e of ['nod', 'shake'] as const) this.now.by[e] = 'rule'
      }
    }
  }

  /** the camera's smile, 0 to 1. Used whenever the AirPods alone did not pass their check for smiles. */
  camera(smile: number, present: boolean, t: number): void {
    this.cameraSmile = true
    if (this.now.by.smile === 'model') return
    this.now.by.smile = 'camera'
    const v = present ? clamp01(smile) : 0
    this.now.p.smile = v
    this.rise('smile', this.now.on.smile ? v > 0.32 : v > 0.5, t)
  }

  cameraOff(): void {
    this.cameraSmile = false
    if (this.now.by.smile === 'camera') {
      this.now.by.smile = 'none'
      this.now.p.smile = 0
      this.now.on.smile = false
    }
  }

  /** nothing has come for a while: let go of what was on */
  idle(): void {
    for (const e of ['nod', 'shake'] as const) {
      this.now.on[e] = false
      this.now.p[e] = 0
    }
  }

  snapshot(): Now {
    return { p: { ...this.now.p }, on: { ...this.now.on }, counts: { ...this.now.counts }, by: { ...this.now.by }, last: this.now.last }
  }

  clear(): void {
    this.now.counts = { nod: 0, shake: 0, smile: 0 }
    this.now.last = null
  }
}
