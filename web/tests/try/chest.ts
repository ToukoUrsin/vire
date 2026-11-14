// A phone held against a chest, made up: what its accelerometer would give. Nothing here is a measurement. The
// tests use it to show that the page's own code (phoneMotion.ts, flow.ts, and Today's breath.ts and pace.ts) reads
// such motion the way it says it does.
import { MotionStream } from '../../src/try/phoneMotion'
import { afterBreath, newTry, planBreath } from '../../src/try/flow'
import type { TryState } from '../../src/try/flow'

const G = 9.81
const RAD = Math.PI / 180

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1_000_000) / 1_000_000 - 0.5
  }
}

export interface Chest {
  /** sensor samples a second, and how uneven they are (0.3: each gap up to 30 % off) */
  hz: number
  jitter: number
  /** tilt with each breath, degrees peak to trough; 0 for no breath */
  swingDeg: number
  /** the breath's own pace when it does not go with the sea; null: it goes with the sea */
  ownPace: number | null
  /** hand tremor and sensor noise, m/s2 */
  tremor: number
  /** slow drift of the hand, degrees over twenty seconds */
  driftDeg: number
  walking: boolean
  seed: number
}

export const chest = (over: Partial<Chest> = {}): Chest => ({ hz: 60, jitter: 0.3, swingDeg: 2, ownPace: null, tremor: 0.06, driftDeg: 0.6, walking: false, seed: 7, ...over })

/** A source of sensor samples whose breath is told, breath by breath, where the sea is. */
export function chestSensor(c: Chest) {
  const rand = rng(c.seed)
  let t = 0
  // the chest is fullest where the sea is highest: 40 % of the way through a breath
  let phase = -0.3 * Math.PI
  let drift = 0
  let trem = 0
  return {
    /** samples from the last one up to `until`, breathing at `perMin` (the sea's pace, unless the chest keeps its own) */
    run(until: number, perMin: number, push: (t: number, g: { x: number; y: number; z: number }) => void) {
      const pace = c.ownPace ?? perMin
      while (t < until) {
        const dt = (1000 / c.hz) * (1 + c.jitter * 2 * rand())
        t += dt
        phase += (2 * Math.PI * pace * dt) / 60_000
        drift += rand() * c.driftDeg * 0.07
        trem = trem * 0.6 + rand() * c.tremor * 2
        // upright against the chest: gravity runs along the phone, leaning back 14 degrees and 5 to one side
        let pitch = 14 + drift + (c.swingDeg / 2) * Math.sin(phase)
        let roll = 5 + drift * 0.4 + (c.swingDeg / 6) * Math.sin(phase + 0.5)
        let bounce = 0
        if (c.walking) {
          const s = (2 * Math.PI * 1.9 * t) / 1000
          pitch += 7 * Math.sin(s) + rand() * 6
          roll += 9 * Math.sin(s / 2) + rand() * 6
          bounce = 2.4 * Math.sin(s)
        }
        const x = G * Math.sin(roll * RAD) + trem + rand() * 0.04
        const z = G * Math.sin(pitch * RAD) + trem * 0.7 + rand() * 0.04
        const y = -G * Math.cos(pitch * RAD) * Math.cos(roll * RAD) + bounce + rand() * 0.04
        push(t, { x, y, z })
      }
    },
  }
}

/** The whole minute, with the page's own steps: the sea plays a breath, the chest moves, the stretch is read. */
export function runTry(c: Chest): { state: TryState; stream: MotionStream } {
  const state = newTry()
  const stream = new MotionStream()
  const sensor = chestSensor(c)
  let t = 0
  for (;;) {
    const b = planBreath(state, t)
    sensor.run(b.t1, b.perMin, (at, g) => stream.push(at, g))
    t = b.t1
    if (afterBreath(state, b, stream.rows, t).done) break
  }
  return { state, stream }
}
