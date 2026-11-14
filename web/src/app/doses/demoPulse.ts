// Demo signals for the breathing dose: a heart that swings with the paced breath, and the pulse wave a camera
// would see of it. Pure (the clock is passed in), so the demo's own reading runs in tests.
import { smooth } from './num'
import { breathAt } from './paces'
import type { PaceSlot, WaveSeries } from './paces'

const REST_BPM = 66
/** the scripted person's own pace, and how wide the swing is there */
const OWN_PACE = 5.5
const OWN_SWING_BPM = 13
/** the swing takes this long to grow into a new pace */
const EASE_MS = 1500
const SAMPLE_MS = 1000 / 30
/** the wave starts this long before the dose, as a pulse that was already being followed would */
const LEAD_MS = 3000

const swingAt = (pace: number) => OWN_SWING_BPM * Math.exp(-((pace - OWN_PACE) ** 2))

/** beats a minute at `t` on the pulse clock, for a dose that began at `t0` */
export function scriptedHeart(slots: PaceSlot[], t0: number) {
  return (t: number) => {
    const at = breathAt(slots, t - t0)
    if (!at) return REST_BPM
    const slot = slots[at.slot]!
    const before = slots[at.slot - 1]
    const ease = smooth((t - t0 - slot.startMs) / EASE_MS)
    const from = before ? swingAt(before.pace) : 0
    const swing = from + (swingAt(slot.pace) - from) * ease
    return REST_BPM - (swing / 2) * Math.cos(2 * Math.PI * at.u) + 0.5 * Math.sin(t / 4700)
  }
}

/** one beat of the wave: the pulse peak, then the smaller echo that follows it */
function beatShape(phase: number): number {
  const p = phase % 1
  return Math.exp(-((p - 0.18) ** 2) / 0.006) + 0.32 * Math.exp(-((p - 0.46) ** 2) / 0.012) - 0.35
}

/**
 * The pulse wave of a scripted heart on the camera's even 30-a-second grid. The demo sensor samples its wave
 * once per browser tick, so a slow browser stretches its beats; this one is laid down by the clock alone.
 */
export function createDemoWave(heart: (t: number) => number, t0: number) {
  const t: number[] = []
  const v: number[] = []
  let phase = 0
  let next = t0 - LEAD_MS

  const extendTo = (until: number) => {
    while (next <= until) {
      phase += heart(next) / 60 / (1000 / SAMPLE_MS)
      t.push(next)
      v.push(beatShape(phase))
      next += SAMPLE_MS
    }
  }

  return (from: number, to: number, now: number): WaveSeries => {
    extendTo(now)
    const out: WaveSeries = { t: [], v: [] }
    for (let i = 0; i < t.length; i++) {
      if (t[i]! < from || t[i]! > to) continue
      out.t.push(t[i]!)
      out.v.push(v[i]!)
    }
    return out
  }
}
