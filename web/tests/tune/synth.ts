// Synthetic faces and AirPods motion with known answers, for the tune tests.
import type { FaceFrame, HeadFrame } from '../../src/sense/types'
import { NEUTRAL } from '../../src/tune/topology'

export function rng(seed: number) {
  let a = seed >>> 0
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u())
  return { u, gauss }
}

/** MediaPipe FaceLandmarker blendshape names, in the model's order */
export const BLEND_NAMES = [
  '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
  'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight',
]
const IDX = new Map(BLEND_NAMES.map((n, i) => [n, i]))

/** what each face does to this made-up person: blendshapes (both sides), cheek raise, and landmark moves in face widths */
interface Pose {
  blend: Record<string, number>
  cheek: number
  /** [landmarks, dx outwards, dy down] */
  moves: [number[], number, number][]
}
const POSES: Pose[] = [
  { blend: {}, cheek: 0, moves: [] },
  // a closed-mouth smiler: only 0.22 on mouthSmile, which is why per-person ranges matter
  { blend: { mouthSmile: 0.22, mouthDimple: 0.12, eyeSquint: 0.2 }, cheek: 0.45, moves: [[[61, 291], 0.02, -0.03]] },
  { blend: { mouthFrown: 0.1, mouthShrugLower: 0.3, mouthPress: 0.2, browInnerUp: 0.15 }, cheek: 0, moves: [[[61, 291], 0.004, 0.022]] },
  { blend: { browDown: 0.45, noseSneer: 0.12, eyeSquint: 0.3 }, cheek: 0.05, moves: [[[107, 336, 105, 334, 70, 300], -0.008, 0.02]] },
  { blend: { browInnerUp: 0.6, browOuterUp: 0.5, eyeWide: 0.4, jawOpen: 0.2 }, cheek: 0, moves: [[[107, 336, 105, 334, 70, 300], 0, -0.035], [[14, 17, 152], 0, 0.03]] },
]

export interface SynthOpts {
  /** image height / width */
  k?: number
  /** how strongly each face is made, per face index (1 = full) */
  strength?: number[]
  noise?: number
  detail?: boolean
  /** head turn in degrees, to check the geometry does not care */
  yawDeg?: number
}

/** a stateful face: `frame(t, face, amount)` gives the FaceFrame sense would deliver */
export function synthFace(seed: number, opts: SynthOpts = {}) {
  const r = rng(seed)
  const k = opts.k ?? 4 / 3
  const noise = opts.noise ?? 0.015
  const S = 0.34
  // slow noise per blendshape, so neighbouring frames are near copies (as on a real camera)
  const slow = new Float32Array(BLEND_NAMES.length)
  let cheekNoise = 0
  return {
    frame(t: number, face: number, amount = 1): FaceFrame {
      const pose = POSES[face]
      const a = amount * (opts.strength?.[face] ?? 1)
      const blend = new Float32Array(BLEND_NAMES.length)
      for (let i = 0; i < blend.length; i++) {
        slow[i] = 0.9 * slow[i] + 0.44 * r.gauss() * noise
        blend[i] = 0.02 + slow[i]
      }
      for (const [name, v] of Object.entries(pose.blend)) {
        for (const n of IDX.has(name) ? [name] : [name + 'Left', name + 'Right']) blend[IDX.get(n)!] += v * a
      }
      for (let i = 0; i < blend.length; i++) blend[i] = Math.max(0, Math.min(1, blend[i]))
      const mesh = new Float32Array(478 * 3)
      const yaw = ((opts.yawDeg ?? 0) * Math.PI) / 180
      const pts = Float32Array.from(NEUTRAL, (v) => v / 1000)
      for (const [ids, dx, dy] of pose.moves) {
        for (const i of ids) {
          pts[i * 3] += Math.sign(pts[i * 3]) * dx * a
          pts[i * 3 + 1] += dy * a
        }
      }
      for (let i = 0; i < 478; i++) {
        const x = pts[i * 3] + r.gauss() * 0.0008
        const y = pts[i * 3 + 1] + r.gauss() * 0.0008
        const z = pts[i * 3 + 2]
        const xr = x * Math.cos(yaw) + z * Math.sin(yaw)
        const zr = -x * Math.sin(yaw) + z * Math.cos(yaw)
        mesh[i * 3] = 0.5 + xr * S
        mesh[i * 3 + 1] = 0.5 + (y * S) / k
        mesh[i * 3 + 2] = zr * S
      }
      cheekNoise = 0.9 * cheekNoise + 0.44 * r.gauss() * noise
      const s = (n: string) => (blend[IDX.get(n + 'Left')!] + blend[IDX.get(n + 'Right')!]) / 2
      const f: FaceFrame = {
        t,
        present: true,
        smile: s('mouthSmile'),
        cheek: Math.max(0, pose.cheek * a + cheekNoise),
        brow: s('browDown'),
        jawOpen: blend[IDX.get('jawOpen')!],
        blink: s('eyeBlink'),
        pitch: 0,
        yaw: opts.yawDeg ?? 0,
        roll: 0,
      }
      if (opts.detail !== false) f.detail = { blend, mesh }
      return f
    },
  }
}

/** the tune step's timeline: [face, lap, from ms, to ms]. Smile comes three times, the other faces twice. */
export const TIMELINE: [number, number, number, number][] = [
  [0, 0, 1000, 4000],
  [1, 0, 5500, 8000],
  [2, 0, 9500, 12000],
  [3, 0, 13500, 16000],
  [4, 0, 17500, 20000],
  [0, 1, 21500, 23500],
  [1, 1, 24700, 26700],
  [2, 1, 27900, 29900],
  [3, 1, 31100, 33100],
  [4, 1, 34300, 36300],
  [1, 2, 37800, 40000],
]
export const TIMELINE_END = 40500

/** how much of which face is on at time t: ramps up over 400 ms before each hold and down over 400 ms after */
export function faceAt(t: number): { face: number; lap: number; amount: number; hold: boolean } {
  for (const [face, lap, from, to] of TIMELINE) {
    if (t >= from - 400 && t <= to + 400) {
      const amount = t < from ? (t - (from - 400)) / 400 : t > to ? 1 - (t - to) / 400 : 1
      return { face, lap, amount, hold: t >= from && t <= to }
    }
  }
  return { face: 0, lap: 0, amount: 1, hold: false }
}

export interface ImuOpts {
  /** size of the smile-locked signal: 1 = an earbud tilting 0.6 degrees with the cheek and a little tremor while smiling; 0 = none */
  smile: number
  gyro?: boolean
  source?: 'airpods' | 'camera'
}

/** 25 Hz head frames over the tune timeline: slow drift, sensor noise, a few nods, and (optionally) a smile-locked signal */
export function synthImu(seed: number, opts: ImuOpts): HeadFrame[] {
  const r = rng(seed)
  const out: HeadFrame[] = []
  let pitch = 2
  let yaw = -5
  let roll = 1
  let tilt = 0
  const prev = { pitch, yaw, roll }
  const nods = [3000 + r.u() * 2000, 15000 + r.u() * 3000, 30000 + r.u() * 3000]
  for (let t = 0; t <= TIMELINE_END; t += 40) {
    pitch += r.gauss() * 0.03
    yaw += r.gauss() * 0.05
    roll += r.gauss() * 0.03
    let nod = 0
    for (const n of nods) if (t >= n && t < n + 800) nod += 4 * Math.sin(((t - n) / 800) * Math.PI * 2)
    const f = faceAt(t)
    const smiling = f.face === 1 ? f.amount : 0
    tilt += (smiling * 0.6 * opts.smile - tilt) * 0.5
    const tremor = smiling * opts.smile
    const p = pitch + nod + tilt * 0.5 + r.gauss() * 0.02
    const y = yaw + r.gauss() * 0.02
    const ro = roll + tilt + r.gauss() * 0.02
    const h: HeadFrame = {
      t,
      pitch: p,
      yaw: y,
      roll: ro,
      ax: r.gauss() * 0.003 + tremor * r.gauss() * 0.004,
      ay: r.gauss() * 0.003 + tremor * 0.004,
      az: r.gauss() * 0.003,
      source: opts.source ?? 'airpods',
    }
    if (opts.gyro !== false) {
      h.rx = (p - prev.pitch) / 0.04 + r.gauss() * 0.3 + tremor * r.gauss() * 1.2
      h.ry = (y - prev.yaw) / 0.04 + r.gauss() * 0.3
      h.rz = (ro - prev.roll) / 0.04 + r.gauss() * 0.3 + tremor * r.gauss() * 1.2
    }
    prev.pitch = p
    prev.yaw = y
    prev.roll = ro
    out.push(h)
  }
  return out
}
