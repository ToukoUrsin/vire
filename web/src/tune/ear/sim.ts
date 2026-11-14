import type { EarRecording, EarStep } from '@shared/ear'
import { TEACH_STEPS, TEACH_MS } from './record'

export interface SimTeachOptions {
  seed?: number
  smileSize?: number
  /** alias used by a few demo scripts */
  smile?: number
  noise?: number
  hz?: number
  at?: string
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
const hash = (x: number) => {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453
  return s - Math.floor(s)
}
const env = (x: number, length: number) => Math.sin(Math.PI * clamp(x / Math.max(1, length))) ** 0.55

/** A deterministic teaching minute with plausible head swings and sensor noise. */
export function simulateTeach(opts: SimTeachOptions = {}): EarRecording {
  const seed = opts.seed ?? 1; const size = Math.max(0, opts.smileSize ?? opts.smile ?? 1); const noise = Math.max(0, opts.noise ?? 0.035); const hz = Math.max(10, Math.round(opts.hz ?? 25)); const dt = 1000 / hz
  const steps: EarStep[] = []; let at = 0
  for (const s of TEACH_STEPS) { steps.push({ ask: s.ask, t0: at, t1: at + s.ms }); at += s.ms }
  const stepAt = (t: number) => steps.find(s => t >= s.t0 && t < s.t1)
  const head: number[][] = []; const face: number[][] = []; const voice: number[][] = []
  const total = TEACH_MS
  const n = Math.floor(total / dt)
  for (let i = 0; i <= n; i++) {
    const t = i * dt; const s = stepAt(t); const ask = s?.ask ?? 'rest'; const local = s ? t - s.t0 : 0
    const nse = (k: number, scale = 1) => (hash(seed * 97 + i * 0.73 + k * 31.7) - 0.5) * scale
    let pitch = 0.8 * Math.sin(t * 0.0017) + nse(1, noise * 2.5)
    let yaw = 0.7 * Math.cos(t * 0.0013) + nse(2, noise * 2.5)
    let roll = 0.4 * Math.sin(t * 0.0009) + nse(3, noise * 1.8)
    let ax = nse(4, noise); let ay = nse(5, noise); let az = 1 + nse(6, noise)
    let smile = 0.07 + nse(7, noise * 0.5); let cheek = 0.03 + nse(8, noise * 0.35); let jaw = 0.03 + nse(9, noise * 0.5)
    if (ask === 'smile') {
      const e = env(local, s?.t1 ? s.t1 - s.t0 : 2500); const pulse = 0.96 + 0.04 * Math.sin(local * 0.012)
      smile += size * 0.82 * e * pulse; cheek += size * 0.45 * e; roll += size * 1.8 * e; ax += size * 0.018 * e * Math.sin(local * 0.018); ay += size * 0.012 * e
    } else if (ask === 'nod') {
      const e = env(local, 6000); pitch += 8.5 * e * Math.sin(local * 0.0092) + 2.2 * e * Math.sin(local * 0.019); ax += 0.07 * e * Math.sin(local * 0.0092)
    } else if (ask === 'shake') {
      const e = env(local, 5000); yaw += 9.0 * e * Math.sin(local * 0.0084) + 1.6 * e * Math.sin(local * 0.017); ay += 0.075 * e * Math.sin(local * 0.0084)
    } else if (ask === 'laugh') {
      const e = env(local, 8000); const burst = Math.max(0, Math.sin(local * 0.031)) ** 3; pitch += 2.5 * e * burst * Math.sin(local * 0.033); roll += 1.4 * e * burst; ax += 0.09 * e * burst * Math.sin(local * 0.033); jaw += 0.22 * e * burst; smile += 0.32 * e * burst
    } else if (ask === 'talk') {
      const e = env(local, 7000); const syll = 0.5 + 0.5 * Math.sin(local * 0.012); jaw += 0.09 * e * syll; pitch += 0.7 * e * Math.sin(local * 0.052); ax += 0.012 * e * Math.sin(local * 0.052)
    }
    head.push([Math.round(t), pitch, yaw, roll, ax, ay, az, 0, 0, 0])
    face.push([Math.round(t), 1, clamp(smile), clamp(cheek), clamp(jaw), 0.04, pitch, yaw, roll])
  }
  for (let t = 0; t <= total; t += 40) {
    const s = stepAt(t); const ask = s?.ask ?? 'rest'; const local = s ? t - s.t0 : 0
    let loud = -74 + (hash(seed * 17 + t * 0.013) - 0.5) * 4; let voiced = 0
    if (ask === 'laugh') { const b = Math.max(0, Math.sin(local * 0.031)) ** 3; voiced = b > 0.1 ? 1 : 0; loud = voiced ? -25 : -65 }
    if (ask === 'talk') { const b = 0.5 + 0.5 * Math.sin(local * 0.012); voiced = b > 0.2 ? 1 : 0; loud = voiced ? -31 : -65 }
    voice.push([t, loud, voiced])
  }
  return { v: 1, at: opts.at ?? '2026-01-01T00:00:00.000Z', userId: null, device: { shell: 'sim', gyro: false, hz, ua: 'vire-ear-sim' }, head, face, voice, steps }
}
