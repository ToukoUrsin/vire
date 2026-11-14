// Scripted AirPods rows for the passive tests: [t epoch ms, pitch, yaw, roll, ax, ay, az]. Never a result.
import { SLOTS } from '../../../shared/earpassive'
import type { PassiveBin, PassiveShell, Run } from '../../../shared/earpassive'

export const T0 = Date.UTC(2026, 10, 10, 8, 0, 0)

export interface Stretch {
  /** seconds */
  s: number
  pitch?: number
  walk?: boolean
  /** degrees of yaw sway, at 0.7 Hz: a restless head */
  sway?: number
  hz?: number
}

/** rows from t0 on, one stretch after another */
export function rows(t0: number, stretches: Stretch[]): number[][] {
  const out: number[][] = []
  let t = t0
  for (const st of stretches) {
    const hz = st.hz ?? 50
    const n = Math.round(st.s * hz)
    for (let i = 0; i < n; i++) {
      const tt = t + (i * 1000) / hz
      const s = tt / 1000
      const pitch = (st.pitch ?? 0) + 0.5 * Math.sin(s * 0.9)
      const yaw = (st.sway ?? 0) * Math.sin(2 * Math.PI * 0.7 * s)
      const ay = st.walk ? 0.09 * Math.sin(2 * Math.PI * 1.8 * s) : 0.003 * Math.sin(s * 23)
      out.push([Math.round(tt), pitch + (st.walk ? 2 * Math.sin(2 * Math.PI * 1.8 * s) : 0), yaw, 0.3 * Math.sin(s * 0.4), 0.002 * Math.sin(s * 31), ay, 0.002 * Math.cos(s * 17)])
    }
    t += st.s * 1000
  }
  return out
}

/** a whole minute bin made directly, for the day and offer rules */
export function bin(at: number, o: Partial<PassiveBin> & { down?: number; pitchAll?: number; walkS?: number } = {}, shell: PassiveShell = 'ios'): PassiveBin {
  const { down = 0, pitchAll: up = 0, walkS, ...rest } = o
  const pitch = Array.from({ length: SLOTS }, (_, i) => (i < down ? up - 30 : up))
  const walk: Run[] = walkS ? [[0, walkS]] : []
  return {
    v: 1, at, ms: 60_000, day: '2026-11-10', shell, samples: 3000, wornS: SLOTS, pitch, walk, stepsPerMin: walkS ? 108 : null,
    call: [], practice: [], moveDegS: 3, nods: null, smiles: null, hr: null, hrN: 0, ...rest,
  } as PassiveBin
}
