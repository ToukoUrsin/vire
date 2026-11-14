// The personal face model: what a frame looks like to it, how it is trained, how it is checked.
// Pure maths (no DOM, no React) so `bun test tests/tune` can run all of it.
//
// What it measures: how far each muscle group moves against this person's own range. It does not read emotions:
// "sad" and "angry" are faces the person was asked to make, used to find the range of the lip-corner and brow muscles.
import { MUSCLES, TUNE_FACES } from '../../../shared/types'
import type { TuneFace } from '@shared/types'
import type { FaceCalibration, FaceFrame, HeadFrame } from '../sense/types'

// ------------------------------------------------------------------ the stored model

export interface MuscleRange {
  /** raw level of the measure on the resting face, and at this person's own biggest */
  rest: number
  max: number
  /** which measure is used for this muscle group (index into the candidate list) */
  src: number
  /** the asked-for face barely moved this measure, so a typical span stands in */
  weak?: boolean
}

export interface FaceClassifier {
  /** the faces it knows, as indices into TUNE_FACES */
  classes: number[]
  mean: number[]
  scale: number[]
  /** classes x (features + 1), row-major; the last column is the bias */
  w: number[]
  /** class centres and typical distance in standardised space: far from every posed face reads as "unsure" */
  cen: number[]
  rad: number[]
}

export interface EarModel {
  mean: number[]
  scale: number[]
  w: number[]
  b: number
  /** trained on the AirPods' rotation rate (shell v2); otherwise on the change of attitude */
  gyro: boolean
}

export interface PersonalModel {
  version: 1
  at: string
  calibration: FaceCalibration
  /** share of held-out frames whose face (of the five) was read right, 0..1 (mean over the faces) */
  accuracy: number
  /** held-out accuracy of the ear model (AirPods motion -> smiling or not), null when there is none or it is too poor to use */
  earAccuracy: number | null
  /** 'detail' = trained on all blendshapes + landmark geometry; 'basic' = only the five basic FaceFrame fields were there */
  kind?: 'detail' | 'basic'
  /** MUSCLES order */
  muscles?: MuscleRange[]
  /** landmark geometry of the resting face (see GEO below) */
  geoRest?: number[]
  /** image height / width the geometry was measured with */
  k?: number
  clf?: FaceClassifier | null
  /** held-out share read right, per face */
  perFace?: Partial<Record<TuneFace, number>>
  /** frames trained on / frames it was checked on */
  frames?: number
  heldOut?: number
  /** how the check was held out: 'lap' = a second take of each face made later, 'block' = the last part of a single take */
  holdout?: 'lap' | 'block' | 'none'
  ear?: EarModel | null
  /** the ear model's check, kept even when it failed, so the app can say so honestly */
  earCheck?: { accuracy: number; chance: number; windows: number; smiles: number } | null
  /** asked-for faces that never showed on this person's face (no clear change from rest): left out of the face read and of `accuracy` */
  missed?: TuneFace[]
  trainMs?: number
}

// ------------------------------------------------------------------ what a frame looks like to the model

/** blendshapes the model looks at; left/right pairs are averaged. Gaze (eyeLook*) is left out on purpose. */
const PAIRS: readonly (readonly [string, string?])[] = [
  ['browDownLeft', 'browDownRight'],
  ['browInnerUp'],
  ['browOuterUpLeft', 'browOuterUpRight'],
  ['eyeBlinkLeft', 'eyeBlinkRight'],
  ['eyeSquintLeft', 'eyeSquintRight'],
  ['eyeWideLeft', 'eyeWideRight'],
  ['jawOpen'],
  ['mouthSmileLeft', 'mouthSmileRight'],
  ['mouthFrownLeft', 'mouthFrownRight'],
  ['mouthPressLeft', 'mouthPressRight'],
  ['mouthStretchLeft', 'mouthStretchRight'],
  ['mouthDimpleLeft', 'mouthDimpleRight'],
  ['mouthUpperUpLeft', 'mouthUpperUpRight'],
  ['mouthLowerDownLeft', 'mouthLowerDownRight'],
  ['mouthShrugLower'],
  ['mouthShrugUpper'],
  ['mouthPucker'],
  ['mouthFunnel'],
  ['mouthRollLower'],
  ['mouthRollUpper'],
  ['noseSneerLeft', 'noseSneerRight'],
  ['cheekPuff'],
  ['mouthClose'],
]
const B_BROWDOWN = 0
const B_BROWINNER = 1
const B_BROWOUTER = 2
const B_BLINK = 3
const B_SQUINT = 4
const B_WIDE = 5
const B_JAW = 6
const B_SMILE = 7
const B_FROWN = 8
const B_PRESS = 9
const B_SHRUGLOW = 14
const B_SNEER = 20
const NB = PAIRS.length
/**
 * GEO: landmark geometry in the head's own frame (so turning or tilting the head does not change it), in eye-to-eye distances:
 * 0 lip corners above the mouth centre, 1-3 inner / middle / outer brow above the eye line, 4 gap between the brows,
 * 5 eye opening, 6 mouth width, 7 mouth opening, 8 chin to lower lip, 9 upper lip to nose.
 */
const NG = 10
const G = NB
const X_CHEEK = NB + NG
/** length of a full observation (frame with `detail`), and of a basic one (smile, cheek, brow, jawOpen, blink) */
export const ND = NB + NG + 1
export const NBASIC = 5

const FLOOR = (() => {
  const f = new Float32Array(ND).fill(0.03)
  for (let i = 0; i < NG; i++) f[G + i] = 0.006
  return f
})()
const FLOOR_BASIC = new Float32Array(NBASIC).fill(0.03)

/** face height over face width (landmarks 10-152 over 234-454) of MediaPipe's canonical face */
const FACE_RATIO = 1.1525
const COMMON_K = [9 / 16, 3 / 4, 1, 4 / 3, 16 / 9]

/**
 * Landmark x is in image widths and y in image heights, so the camera's shape is needed before any geometry.
 * This works it out from the face's own proportions and snaps it to a common camera shape. Returns image height / width.
 */
export class AspectTracker {
  private buf: number[] = []
  k: number
  constructor(prior = 0) {
    this.k = prior
  }
  /** unit = 1 for image-normalised floats, 1000 for LiveMesh ints */
  update(m: ArrayLike<number>): number {
    const dxA = m[454 * 3] - m[234 * 3]
    const dyA = m[454 * 3 + 1] - m[234 * 3 + 1]
    const dzA = m[454 * 3 + 2] - m[234 * 3 + 2]
    const dxB = m[152 * 3] - m[10 * 3]
    const dyB = m[152 * 3 + 1] - m[10 * 3 + 1]
    const dzB = m[152 * 3 + 2] - m[10 * 3 + 2]
    const r2 = FACE_RATIO * FACE_RATIO
    const den = dyB * dyB - r2 * dyA * dyA
    const num = r2 * (dxA * dxA + dzA * dzA) - (dxB * dxB + dzB * dzB)
    // only a roughly upright, roughly frontal face gives a clean reading
    if (den > 0 && num > 0 && Math.abs(dyA) < 0.35 * Math.abs(dxA) && Math.abs(dzA) < 0.5 * Math.abs(dxA)) {
      this.buf.push(Math.sqrt(num / den))
      if (this.buf.length > 31) this.buf.shift()
    }
    if (!this.buf.length) return this.k || 1
    // a prior (the model's own k) holds until there is enough evidence against it
    if (this.k && this.buf.length < 9) return this.k
    const sorted = this.buf.slice().sort((a, b) => a - b)
    const med = sorted[sorted.length >> 1]
    let best = med
    let bd = 0.17
    for (const c of COMMON_K) {
      const d = Math.abs(Math.log(med / c))
      if (d < bd) {
        bd = d
        best = c
      }
    }
    this.k = best
    return best
  }
}

function geometry(m: ArrayLike<number>, k: number, out: Float32Array, o: number): void {
  // head frame from points that facial muscles barely move: x along the eyes, y down the nose
  const X = (i: number) => m[i * 3]
  const Y = (i: number) => m[i * 3 + 1] * k
  const Z = (i: number) => m[i * 3 + 2]
  let ex0 = X(263) - X(33)
  let ex1 = Y(263) - Y(33)
  let ex2 = Z(263) - Z(33)
  const ref = Math.hypot(ex0, ex1, ex2) || 1e-6
  ex0 /= ref
  ex1 /= ref
  ex2 /= ref
  let ey0 = X(2) - X(168)
  let ey1 = Y(2) - Y(168)
  let ey2 = Z(2) - Z(168)
  const dot = ey0 * ex0 + ey1 * ex1 + ey2 * ex2
  ey0 -= dot * ex0
  ey1 -= dot * ex1
  ey2 -= dot * ex2
  const ln = Math.hypot(ey0, ey1, ey2) || 1e-6
  ey0 /= ln
  ey1 /= ln
  ey2 /= ln
  const hx = (i: number) => (X(i) * ex0 + Y(i) * ex1 + Z(i) * ex2) / ref
  const hy = (i: number) => (X(i) * ey0 + Y(i) * ey1 + Z(i) * ey2) / ref
  const eye = (hy(33) + hy(133) + hy(362) + hy(263)) / 4
  out[o] = (hy(13) + hy(14)) / 2 - (hy(61) + hy(291)) / 2
  out[o + 1] = eye - (hy(107) + hy(336)) / 2
  out[o + 2] = eye - (hy(105) + hy(334)) / 2
  out[o + 3] = eye - (hy(70) + hy(300)) / 2
  out[o + 4] = hx(336) - hx(107)
  out[o + 5] = (hy(145) - hy(159) + (hy(374) - hy(386))) / 2
  out[o + 6] = Math.hypot(X(291) - X(61), Y(291) - Y(61), Z(291) - Z(61)) / ref
  out[o + 7] = hy(14) - hy(13)
  out[o + 8] = hy(152) - hy(17)
  out[o + 9] = hy(0) - hy(2)
}

/** Turns FaceFrames into observations. Keeps the blendshape index map and the camera-shape estimate between frames. */
export class Observer {
  private names: readonly string[] | null = null
  private a = new Int16Array(NB).fill(-1)
  private b = new Int16Array(NB).fill(-1)
  private ok = false
  readonly aspect: AspectTracker
  private full = new Float32Array(ND)
  private basic = new Float32Array(NBASIC)

  constructor(kPrior = 0) {
    this.aspect = new AspectTracker(kPrior)
  }

  private map(names: readonly string[]): boolean {
    if (names !== this.names || (!this.ok && names.length)) {
      this.names = names
      const idx = new Map<string, number>()
      names.forEach((n, i) => idx.set(n, i))
      for (let i = 0; i < NB; i++) {
        this.a[i] = idx.get(PAIRS[i][0]) ?? -1
        const second = PAIRS[i][1]
        this.b[i] = second ? (idx.get(second) ?? -1) : -1
      }
      this.ok = this.a[B_SMILE] >= 0 && this.a[B_BROWDOWN] >= 0
    }
    return this.ok
  }

  /**
   * One frame as the model sees it: ND numbers when the frame carries `detail`, NBASIC otherwise; null without a face.
   * The returned array is reused on the next call: copy it to keep it.
   */
  observe(f: FaceFrame, blendNames: readonly string[]): Float32Array | null {
    if (!f.present) return null
    const d = f.detail
    if (d && d.mesh.length >= 468 * 3 && this.map(blendNames)) {
      const x = this.full
      const bl = d.blend
      for (let i = 0; i < NB; i++) {
        const a = this.a[i]
        const b = this.b[i]
        const va = a >= 0 ? bl[a] : 0
        x[i] = b >= 0 ? (va + bl[b]) / 2 : va
      }
      geometry(d.mesh, this.aspect.update(d.mesh), x, G)
      x[X_CHEEK] = f.cheek
      return x
    }
    const x = this.basic
    x[0] = f.smile
    x[1] = f.cheek
    x[2] = f.brow
    x[3] = f.jawOpen
    x[4] = f.blink
    return x
  }
}

// ------------------------------------------------------------------ muscles

/** candidate measures; each muscle group picks the one that separates its face from rest best for this person */
const NC = 11
/** MUSCLES order -> candidate indices */
const CANDS: readonly (readonly number[])[] = [[0], [1], [2], [3, 4], [5, 6, 7], [8], [9], [10]]
/** which asked-for face drives each muscle group's range (index into TUNE_FACES); -1 = none, the range comes from everything seen */
const DRIVER = [1, 1, 3, 4, 2, -1, -1, -1]
/** typical [rest, max] per candidate, used without a model and when a face barely moved its measure */
const POP: readonly (readonly [number, number])[] = [
  [0.02, 0.6],
  [0.02, 0.55],
  [0.03, 0.5],
  [0.03, 0.6],
  [0, 0.5],
  [0.02, 0.3],
  [0, 0.35],
  [0.03, 0.35],
  [0.02, 0.5],
  [0.12, 0.65],
  [0.02, 0.4],
]
const MIN_SPAN = 0.04
const GEO_GAIN = 12

/** all candidate measures of one observation. `rest` = resting geometry (GEO order) or null when unknown. */
export function candidates(x: ArrayLike<number>, rest: ArrayLike<number> | null, out: Float32Array): Float32Array {
  if (x.length < ND) {
    out.fill(0)
    out[0] = x[0]
    out[1] = x[1]
    out[2] = x[2]
    out[8] = x[3]
    out[9] = x[4]
    return out
  }
  out[0] = x[B_SMILE]
  out[1] = x[X_CHEEK]
  out[2] = x[B_BROWDOWN]
  out[3] = 0.5 * x[B_BROWINNER] + 0.5 * x[B_BROWOUTER]
  out[4] = rest ? ((x[G + 1] - rest[1] + (x[G + 2] - rest[2])) / 2) * GEO_GAIN : 0
  out[5] = x[B_FROWN]
  out[6] = rest ? -(x[G] - rest[0]) * GEO_GAIN : 0
  out[7] = 0.5 * x[B_FROWN] + 0.5 * x[B_SHRUGLOW]
  out[8] = x[B_JAW]
  out[9] = x[B_BLINK]
  out[10] = x[B_SNEER]
  return out
}

export function populationRanges(): MuscleRange[] {
  return CANDS.map((c) => ({ rest: POP[c[0]][0], max: POP[c[0]][1], src: c[0] }))
}

/** the typical maximum of the measure a range was taken on, for drawing a range next to a common scale */
export function typicalMax(r: MuscleRange): number {
  return POP[r.src]?.[1] ?? 0.5
}

/**
 * How clearly the asked-for face is on, before any model exists: 1 = clearly there. `r` is the resting observation.
 * Only used to decide when to start counting in the tune step. The thresholds were set on real posed faces
 * (tests/tune/clip-scan.mjs): a closed-mouth smile is only 0.15 on mouthSmile, a brow raise can leave browInnerUp at 0.
 */
export function poseScore(face: number, x: ArrayLike<number>, r: ArrayLike<number>): number {
  const d = (i: number) => x[i] - r[i]
  if (x.length < ND) {
    const smile = d(0) / 0.1
    const down = d(2) / 0.12
    const jaw = d(3) / 0.25
    if (face === 0) return 1 / Math.max(0.34, smile, down, jaw)
    if (face === 1) return smile
    if (face === 3) return down
    return face === 4 ? jaw : 0
  }
  const smile = Math.max(d(B_SMILE) / 0.1, d(G) / 0.045)
  const down = Math.max(d(B_BROWDOWN) / 0.12, -d(G + 1) / 0.03)
  const up = Math.max(d(B_BROWINNER) / 0.2, d(B_BROWOUTER) / 0.2, d(G + 2) / 0.035, d(B_WIDE) / 0.2)
  const change = faceChange(x, r) / 0.9
  switch (face) {
    case 0:
      // back at rest: nothing is clearly on
      return 1 / Math.max(0.34, smile, down, up, change)
    case 1:
      return smile
    case 2:
      // the model's mouthFrown stays near 0 on most faces: go by the corners moving down or the lower face changing at all,
      // as long as it is not the smile from the step before (a smile also presses the lips)
      return Math.max(d(B_FROWN) / 0.04, -d(G) / 0.035, d(B_SHRUGLOW) / 0.2, d(B_PRESS) / 0.25, change) - 1.5 * Math.max(0, smile)
    case 3:
      return down
    default:
      return Math.max(up, d(B_JAW) / 0.25)
  }
}

/**
 * How different two observations are: summed absolute blendshape change, blinks left out.
 * Used to tell that the face has gone back to rest.
 */
export function faceChange(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let s = 0
  if (x.length < ND) {
    for (let i = 0; i < 4; i++) s += Math.abs(x[i] - y[i])
    return s
  }
  for (let i = 0; i < NB; i++) if (i !== B_BLINK && i !== B_SQUINT) s += Math.abs(x[i] - y[i])
  return s
}

/** raw smile (mean mouthSmile) of an observation */
export function smileOf(x: ArrayLike<number>): number {
  return x.length < ND ? x[0] : x[B_SMILE]
}

// ------------------------------------------------------------------ small maths

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const round = (v: number, p = 1e5) => Math.round(v * p) / p
const roundAll = (a: ArrayLike<number>, p = 1e5) => Array.from(a, (v) => round(v, p))

export function quantile(values: ArrayLike<number>, q: number): number {
  const s = Array.from(values).sort((a, b) => a - b)
  if (!s.length) return 0
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.min(s.length - 1, lo + 1)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

function robustSd(values: number[], med: number): number {
  return 1.4826 * quantile(values.map((v) => Math.abs(v - med)), 0.5)
}

// ------------------------------------------------------------------ the five-face classifier

interface Fit {
  classes: number[]
  mean: Float64Array
  scale: Float64Array
  w: Float64Array
  d: number
}

export interface Sample {
  t: number
  /** observation (copy), ND or NBASIC long */
  x: Float32Array
  /** index into TUNE_FACES */
  face: number
  /** 0 = the first time this face was asked for, 1+ = later takes */
  lap: number
}

const FIT_MAX = 420
const FIT_ITERATIONS = 110

function fitSoftmax(samples: Sample[], d: number): Fit | null {
  const counts = new Map<number, number>()
  for (const s of samples) counts.set(s.face, (counts.get(s.face) ?? 0) + 1)
  const classes = Array.from(counts.keys())
    .filter((c) => counts.get(c)! >= 6)
    .sort((a, b) => a - b)
  if (classes.length < 2) return null
  const K = classes.length
  // neighbouring frames are near copies: every second or third one carries the same information at a fraction of the cost
  const kept = samples.filter((s) => classes.includes(s.face))
  const stride = Math.max(1, Math.floor(kept.length / FIT_MAX))
  const use = stride > 1 ? kept.filter((_, i) => i % stride === 0) : kept
  const n = use.length
  // centre on the resting face when there is one (everything is "relative to the person's rest"), else on the mean
  const rest = use.filter((s) => s.face === 0)
  const centre = rest.length >= 6 ? rest : use
  const mean = new Float64Array(d)
  for (const s of centre) for (let j = 0; j < d; j++) mean[j] += s.x[j] / centre.length
  const all = new Float64Array(d)
  for (const s of use) for (let j = 0; j < d; j++) all[j] += s.x[j] / n
  const scale = new Float64Array(d)
  for (const s of use) for (let j = 0; j < d; j++) scale[j] += (s.x[j] - all[j]) ** 2 / n
  const floor = d === ND ? FLOOR : FLOOR_BASIC
  for (let j = 0; j < d; j++) scale[j] = Math.max(Math.sqrt(scale[j]), floor[j])
  const Z = new Float64Array(n * d)
  const y = new Int32Array(n)
  const sw = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const s = use[i]
    for (let j = 0; j < d; j++) Z[i * d + j] = (s.x[j] - mean[j]) / scale[j]
    y[i] = classes.indexOf(s.face)
    sw[i] = 0
  }
  const per = new Float64Array(K)
  for (let i = 0; i < n; i++) per[y[i]]++
  for (let i = 0; i < n; i++) sw[i] = 1 / (K * per[y[i]])
  const D1 = d + 1
  const W = new Float64Array(K * D1)
  const V = new Float64Array(K * D1)
  const Gd = new Float64Array(K * D1)
  const p = new Float64Array(K)
  const LR = 0.15
  const MOM = 0.9
  const L2 = 0.01
  for (let it = 0; it < FIT_ITERATIONS; it++) {
    Gd.fill(0)
    for (let i = 0; i < n; i++) {
      const zi = i * d
      let mx = -Infinity
      for (let k = 0; k < K; k++) {
        const row = k * D1
        let s = W[row + d]
        for (let j = 0; j < d; j++) s += W[row + j] * Z[zi + j]
        p[k] = s
        if (s > mx) mx = s
      }
      let sum = 0
      for (let k = 0; k < K; k++) {
        p[k] = Math.exp(p[k] - mx)
        sum += p[k]
      }
      for (let k = 0; k < K; k++) {
        const g = (p[k] / sum - (y[i] === k ? 1 : 0)) * sw[i]
        const row = k * D1
        for (let j = 0; j < d; j++) Gd[row + j] += g * Z[zi + j]
        Gd[row + d] += g
      }
    }
    for (let k = 0; k < K; k++) {
      const row = k * D1
      for (let j = 0; j <= d; j++) {
        const g = Gd[row + j] + (j < d ? L2 * W[row + j] : 0)
        V[row + j] = MOM * V[row + j] - LR * g
        W[row + j] += V[row + j]
      }
    }
  }
  return { classes, mean, scale, w: W, d }
}

function predict(fit: Fit, x: ArrayLike<number>): number {
  const { classes, mean, scale, w, d } = fit
  let best = 0
  let bs = -Infinity
  for (let k = 0; k < classes.length; k++) {
    const row = k * (d + 1)
    let s = w[row + d]
    for (let j = 0; j < d; j++) s += (w[row + j] * (x[j] - mean[j])) / scale[j]
    if (s > bs) {
      bs = s
      best = k
    }
  }
  return classes[best]
}

function centres(fit: Fit, samples: Sample[]): { cen: number[]; rad: number[] } {
  const { classes, mean, scale, d } = fit
  const cen: number[] = []
  const rad: number[] = []
  for (const c of classes) {
    const own = samples.filter((s) => s.face === c)
    const m = new Float64Array(d)
    for (const s of own) for (let j = 0; j < d; j++) m[j] += (s.x[j] - mean[j]) / scale[j] / own.length
    const dist = own.map((s) => {
      let q = 0
      for (let j = 0; j < d; j++) q += ((s.x[j] - mean[j]) / scale[j] - m[j]) ** 2
      return Math.sqrt(q / d)
    })
    cen.push(...m)
    rad.push(Math.max(0.35, quantile(dist, 0.95)))
  }
  return { cen, rad }
}

/** train on the first take of each face, test on the later takes; falls back to the last part of a single take */
function holdOut(samples: Sample[], d: number): { accuracy: number; perFace: Partial<Record<TuneFace, number>>; heldOut: number; how: 'lap' | 'block' | 'none' } {
  const none = { accuracy: 0, perFace: {}, heldOut: 0, how: 'none' as const }
  let train = samples.filter((s) => s.lap === 0)
  let test = samples.filter((s) => s.lap > 0)
  let how: 'lap' | 'block' = 'lap'
  const testFaces = new Set(test.map((s) => s.face))
  if (testFaces.size < 2) {
    // no second takes: keep the last 40% of each take aside, with a gap so the two parts do not share neighbouring frames
    how = 'block'
    train = []
    test = []
    for (let c = 0; c < TUNE_FACES.length; c++) {
      const own = samples.filter((s) => s.face === c).sort((a, b) => a.t - b.t)
      const cut = Math.floor(own.length * 0.6)
      train.push(...own.slice(0, Math.max(0, cut - 4)))
      test.push(...own.slice(cut))
    }
  }
  const fit = fitSoftmax(train, d)
  if (!fit) return none
  const hit = new Map<number, [number, number]>()
  for (const s of test) {
    if (!fit.classes.includes(s.face)) continue
    const h = hit.get(s.face) ?? [0, 0]
    h[1]++
    if (predict(fit, s.x) === s.face) h[0]++
    hit.set(s.face, h)
  }
  const perFace: Partial<Record<TuneFace, number>> = {}
  let sum = 0
  let faces = 0
  let heldOut = 0
  for (const [c, [ok, n]] of hit) {
    if (n < 4) continue
    perFace[TUNE_FACES[c]] = round(ok / n, 1e3)
    sum += ok / n
    faces++
    heldOut += n
  }
  if (faces < 2) return none
  return { accuracy: round(sum / faces, 1e3), perFace, heldOut, how }
}

// ------------------------------------------------------------------ the ear model

/** samples per window: 0.64 s at the AirPods' 25 Hz */
export const EAR_WIN = 16
export const EAR_NF = 20
const EAR_CH = 9
const EAR_BASE_S = 5

/**
 * AirPods motion -> one feature vector per sample, over the last EAR_WIN samples.
 * Channels: attitude and acceleration with their slow drift removed (posture is not a smile), and rotation rate.
 * Features: mean and spread of each channel, plus the mean size of the rotation and of the acceleration.
 */
export class EarStream {
  private n = 0
  private lastT = 0
  private yaw = 0
  private prev = [0, 0, 0]
  private base = new Float64Array(6)
  private ring = new Float32Array(EAR_CH * EAR_WIN)
  private out = new Float32Array(EAR_NF)
  private gyro: boolean
  constructor(gyro: boolean) {
    this.gyro = gyro
  }

  reset(): void {
    this.n = 0
  }

  /** feature vector for the window ending at this sample (reused between calls), or null while the window fills */
  push(h: HeadFrame): Float32Array | null {
    let dt = (h.t - this.lastT) / 1000
    if (this.n > 0 && (dt > 0.6 || dt < -0.05)) this.n = 0
    if (this.n === 0) {
      this.yaw = h.yaw
      this.prev = [h.pitch, h.yaw, h.roll]
      this.base.set([h.pitch, h.yaw, h.roll, h.ax, h.ay, h.az])
      dt = 0.04
    }
    dt = Math.min(0.2, Math.max(0.01, dt))
    this.lastT = h.t
    // yaw wraps at +-180
    let dy = h.yaw - this.prev[1]
    if (dy > 180) dy -= 360
    else if (dy < -180) dy += 360
    this.yaw += dy
    const att = [h.pitch, this.yaw, h.roll]
    const acc = [h.ax, h.ay, h.az]
    const a = Math.min(1, dt / EAR_BASE_S)
    const slot = (this.n % EAR_WIN) * EAR_CH
    const r = this.ring
    for (let c = 0; c < 3; c++) {
      this.base[c] += (att[c] - this.base[c]) * a
      this.base[3 + c] += (acc[c] - this.base[3 + c]) * a
      r[slot + c] = att[c] - this.base[c]
      r[slot + 3 + c] = (acc[c] - this.base[3 + c]) * 100
    }
    if (this.gyro && h.rx !== undefined && h.ry !== undefined && h.rz !== undefined) {
      r[slot + 6] = h.rx
      r[slot + 7] = h.ry
      r[slot + 8] = h.rz
    } else {
      r[slot + 6] = (h.pitch - this.prev[0]) / dt
      r[slot + 7] = dy / dt
      r[slot + 8] = (h.roll - this.prev[2]) / dt
    }
    this.prev = [h.pitch, h.yaw, h.roll]
    this.n++
    if (this.n < EAR_WIN) return null
    const o = this.out
    let rot = 0
    let lin = 0
    for (let c = 0; c < EAR_CH; c++) {
      let s = 0
      let q = 0
      for (let i = 0; i < EAR_WIN; i++) {
        const v = r[i * EAR_CH + c]
        s += v
        q += v * v
      }
      const m = s / EAR_WIN
      o[c] = m
      o[EAR_CH + c] = Math.sqrt(Math.max(0, q / EAR_WIN - m * m))
    }
    for (let i = 0; i < EAR_WIN; i++) {
      const b = i * EAR_CH
      rot += Math.hypot(r[b + 6], r[b + 7], r[b + 8])
      lin += Math.hypot(r[b + 3], r[b + 4], r[b + 5])
    }
    o[18] = rot / EAR_WIN
    o[19] = lin / EAR_WIN
    return o
  }
}

function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  // Gaussian elimination with partial pivoting, in place
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[piv * n + c])) piv = r
    if (Math.abs(A[piv * n + c]) < 1e-12) return null
    if (piv !== c) {
      for (let j = 0; j < n; j++) {
        const t = A[c * n + j]
        A[c * n + j] = A[piv * n + j]
        A[piv * n + j] = t
      }
      const t = b[c]
      b[c] = b[piv]
      b[piv] = t
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c]
      if (f === 0) continue
      for (let j = c; j < n; j++) A[r * n + j] -= f * A[c * n + j]
      b[r] -= f * b[c]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let j = r + 1; j < n; j++) s -= A[r * n + j] * x[j]
    x[r] = s / A[r * n + r]
  }
  return x
}

interface Lda {
  mean: Float64Array
  scale: Float64Array
  w: Float64Array
  b: number
}

/** two-class linear discriminant with a shrunk covariance; `idx` = which windows to train on */
function fitLda(F: Float32Array[], y: Int8Array, idx: number[]): Lda | null {
  const d = EAR_NF
  const n = idx.length
  let n1 = 0
  for (const i of idx) if (y[i] === 1) n1++
  const n0 = n - n1
  if (n0 < 8 || n1 < 8) return null
  const mean = new Float64Array(d)
  const scale = new Float64Array(d)
  for (const i of idx) for (let j = 0; j < d; j++) mean[j] += F[i][j] / n
  for (const i of idx) for (let j = 0; j < d; j++) scale[j] += (F[i][j] - mean[j]) ** 2 / n
  for (let j = 0; j < d; j++) scale[j] = Math.sqrt(scale[j]) || 1
  const m0 = new Float64Array(d)
  const m1 = new Float64Array(d)
  for (const i of idx) {
    const m = y[i] === 1 ? m1 : m0
    const c = y[i] === 1 ? n1 : n0
    for (let j = 0; j < d; j++) m[j] += (F[i][j] - mean[j]) / scale[j] / c
  }
  const S = new Float64Array(d * d)
  const z = new Float64Array(d)
  for (const i of idx) {
    const m = y[i] === 1 ? m1 : m0
    for (let j = 0; j < d; j++) z[j] = (F[i][j] - mean[j]) / scale[j] - m[j]
    for (let j = 0; j < d; j++) for (let k = j; k < d; k++) S[j * d + k] += (z[j] * z[k]) / n
  }
  const SHRINK = 0.4
  for (let j = 0; j < d; j++) {
    for (let k = j + 1; k < d; k++) {
      S[j * d + k] *= 1 - SHRINK
      S[k * d + j] = S[j * d + k]
    }
    S[j * d + j] += 0.05
  }
  const diff = new Float64Array(d)
  for (let j = 0; j < d; j++) diff[j] = m1[j] - m0[j]
  const w = solve(S, diff, d)
  if (!w) return null
  let b = 0
  for (let j = 0; j < d; j++) b -= (w[j] * (m0[j] + m1[j])) / 2
  return { mean, scale, w, b }
}

function ldaScore(l: { mean: ArrayLike<number>; scale: ArrayLike<number>; w: ArrayLike<number>; b: number }, f: ArrayLike<number>): number {
  let s = l.b
  for (let j = 0; j < EAR_NF; j++) s += (l.w[j] * (f[j] - l.mean[j])) / l.scale[j]
  return s
}

/** runs of "smiling" windows, as [first, last + 1] */
function smileRuns(y: Int8Array): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  let last = -1
  for (let i = 0; i < y.length; i++) {
    if (y[i] !== 1) continue
    if (start >= 0 && i - last > 8) {
      if (last + 1 - start >= 6) runs.push([start, last + 1])
      start = -1
    }
    if (start < 0) start = i
    last = i
  }
  if (start >= 0 && last + 1 - start >= 6) runs.push([start, last + 1])
  return runs
}

/**
 * Honest check of the ear model: the timeline is cut into blocks with one smile each; every block after the first
 * is predicted by a model trained only on what came before it (with a window-length gap, since windows overlap).
 * Returns the balanced accuracy over all those later blocks, or null when there are not two smiles to work with.
 */
function forwardAccuracy(F: Float32Array[], y: Int8Array): { accuracy: number; windows: number; smiles: number } | null {
  const runs = smileRuns(y)
  if (runs.length < 2) return null
  const bounds = [0]
  for (let i = 1; i < runs.length; i++) bounds.push((runs[i - 1][1] + runs[i][0]) >> 1)
  bounds.push(y.length)
  let tp = 0
  let fn = 0
  let tn = 0
  let fp = 0
  for (let b = 1; b < runs.length; b++) {
    const train: number[] = []
    for (let i = 0; i < bounds[b] - EAR_WIN; i++) if (y[i] >= 0) train.push(i)
    const fit = fitLda(F, y, train)
    if (!fit) continue
    for (let i = bounds[b]; i < bounds[b + 1]; i++) {
      if (y[i] < 0) continue
      const pos = ldaScore(fit, F[i]) > 0
      if (y[i] === 1) {
        if (pos) tp++
        else fn++
      } else if (pos) fp++
      else tn++
    }
  }
  if (tp + fn < 8 || tn + fp < 8) return null
  return { accuracy: (tp / (tp + fn) + tn / (tn + fp)) / 2, windows: tp + fn + tn + fp, smiles: runs.length }
}

/** smiling above this share of the person's own biggest smile, not smiling below the other; in between is left out */
const EAR_ON = 0.5
const EAR_OFF = 0.2
/** the camera's smile is read this long before the end of the motion window */
const EAR_LAG_MS = 150
export const EAR_MIN_ACCURACY = 0.7

export interface EarTraining {
  model: EarModel | null
  check: { accuracy: number; chance: number; windows: number; smiles: number } | null
}

/**
 * Teacher: the camera's smile as a share of the person's own range (`own`, sampled at `t`).
 * Student: AirPods motion. Returns the model only when its held-out accuracy is clearly better than chance.
 */
export function trainEar(head: HeadFrame[], t: ArrayLike<number>, own: ArrayLike<number>): EarTraining {
  const air = head.filter((h) => h.source === 'airpods')
  if (air.length < 200 || t.length < 50) return { model: null, check: null }
  let withGyro = 0
  for (const h of air) if (h.rx !== undefined) withGyro++
  const gyro = withGyro > 0.9 * air.length
  const stream = new EarStream(gyro)
  const F: Float32Array[] = []
  const labels: number[] = []
  let j = 0
  for (const h of air) {
    const f = stream.push(h)
    if (!f) continue
    const at = h.t - EAR_LAG_MS
    while (j + 1 < t.length && t[j + 1] <= at) j++
    let label = -1
    if (t[j] <= at && j + 1 < t.length && t[j + 1] - t[j] < 400) {
      const u = (at - t[j]) / Math.max(1, t[j + 1] - t[j])
      const v = own[j] + (own[j + 1] - own[j]) * u
      label = v > EAR_ON ? 1 : v < EAR_OFF ? 0 : -1
    }
    F.push(Float32Array.from(f))
    labels.push(label)
  }
  const y = Int8Array.from(labels)
  const real = forwardAccuracy(F, y)
  if (!real) return { model: null, check: null }
  // what the same procedure scores when the smiles are slid along the motion: the level chance reaches on this recording
  const n = y.length
  const nulls: number[] = []
  const shifted = new Int8Array(n)
  const SHIFTS = 24
  for (let s = 1; s <= SHIFTS; s++) {
    const off = Math.round(n * (0.1 + (0.8 * s) / (SHIFTS + 1)))
    for (let i = 0; i < n; i++) shifted[(i + off) % n] = y[i]
    const r = forwardAccuracy(F, shifted)
    if (r) nulls.push(r.accuracy)
  }
  // "clearly better than chance": above a fixed bar, and above every one of the slid versions
  const chance = nulls.length ? Math.max(...nulls) : 0.5
  const check = { accuracy: round(real.accuracy, 1e3), chance: round(chance, 1e3), windows: real.windows, smiles: real.smiles }
  if (real.accuracy < EAR_MIN_ACCURACY || real.accuracy <= chance || nulls.length < SHIFTS / 2) return { model: null, check }
  const all: number[] = []
  for (let i = 0; i < n; i++) if (y[i] >= 0) all.push(i)
  const fit = fitLda(F, y, all)
  if (!fit) return { model: null, check }
  return { model: { mean: roundAll(fit.mean), scale: roundAll(fit.scale), w: roundAll(fit.w), b: round(fit.b), gyro }, check }
}

// ------------------------------------------------------------------ training

export interface TuneRecording {
  /** frames kept from the holds */
  samples: Sample[]
  /** every face frame of the step: time and raw smile (mean mouthSmile), for the ear model's teacher */
  smile: { t: number[]; v: number[] }
  /** head frames of the step (only AirPods ones are used) */
  head: HeadFrame[]
  /** image height / width the observer settled on */
  k?: number
}

interface Ranges {
  kind: 'detail' | 'basic'
  samples: Sample[]
  muscles: MuscleRange[]
  geoRest: Float32Array | null
  calibration: FaceCalibration
}

/** (a) each muscle group's own range: rest level = median on the resting face, own max = 90th percentile on the face that drives it */
function fitRanges(all: Sample[]): Ranges {
  const detail = all.filter((s) => s.x.length === ND)
  const kind: 'detail' | 'basic' = detail.length > 0 && detail.length >= all.length / 2 ? 'detail' : 'basic'
  const d = kind === 'detail' ? ND : NBASIC
  const samples = all.filter((s) => s.x.length === d)
  const by = (face: number) => samples.filter((s) => s.face === face)
  const rest = by(0)
  const anchor = rest.length >= 5 ? rest : samples
  const geoRest = kind === 'detail' && anchor.length ? new Float32Array(NG) : null
  if (geoRest) for (let g = 0; g < NG; g++) geoRest[g] = quantile(anchor.map((s) => s.x[G + g]), 0.5)
  const scratch = new Float32Array(NC)
  const cand = (list: Sample[], c: number) => list.map((s) => candidates(s.x, geoRest, scratch)[c])
  const restLevel = (c: number) => (anchor.length ? quantile(cand(anchor, c), 0.5) : POP[c][0])
  const muscles: MuscleRange[] = CANDS.map((options, m) => {
    const driver = DRIVER[m]
    const posed = driver >= 0 ? by(driver) : []
    let best: MuscleRange | null = null
    let bestScore = -Infinity
    for (const c of options) {
      if (kind === 'basic' && ![0, 1, 2, 8, 9].includes(c)) continue
      if (!geoRest && (c === 4 || c === 6)) continue
      const r = restLevel(c)
      const span = POP[c][1] - POP[c][0]
      let range: MuscleRange
      let score: number
      if (posed.length >= 5) {
        const top = quantile(cand(posed, c), 0.9)
        score = (top - r) / (robustSd(cand(anchor, c), r) + 0.01)
        range = top - r >= MIN_SPAN ? { rest: round(r), max: round(top), src: c } : { rest: round(r), max: round(r + span), src: c, weak: true }
        if (range.weak) score -= 1000
      } else if (driver < 0 && samples.length) {
        // no face of its own: the range is what was seen across all faces, but never less than most of a typical one
        const top = quantile(cand(samples, c), 0.97)
        score = 0
        range = { rest: round(r), max: round(Math.max(top, r + span * 0.7)), src: c }
      } else {
        score = -2000
        range = { rest: round(r), max: round(r + span), src: c, weak: true }
      }
      if (score > bestScore) {
        bestScore = score
        best = range
      }
    }
    return best ?? { rest: POP[options[0]][0], max: POP[options[0]][1], src: options[0], weak: true }
  })
  const rawRange = (c: number, face: number): [number, number] => {
    const r = restLevel(c)
    const posed = by(face)
    const top = posed.length >= 5 ? quantile(cand(posed, c), 0.9) : r
    return top - r >= MIN_SPAN ? [round(r), round(top)] : [round(r), round(r + (POP[c][1] - POP[c][0]))]
  }
  return { kind, samples, muscles, geoRest, calibration: { smile: rawRange(0, 1), brow: rawRange(2, 3) } }
}

/**
 * The ranges alone, from whatever has been recorded so far: no classifier, no ear model, no checks.
 * The tune step uses it to draw the muscles against the person's own rest while the faces are still coming in.
 */
export function provisionalModel(samples: Sample[], k?: number): PersonalModel {
  const r = fitRanges(samples)
  return { version: 1, at: '', calibration: r.calibration, accuracy: 0, earAccuracy: null, kind: r.kind, muscles: r.muscles, geoRest: r.geoRest ? roundAll(r.geoRest) : undefined, k, clf: null }
}

/** a face counts as made when its first take sits at least this clearly away from rest (poseScore) */
const SEEN_MIN = 0.6

/**
 * Asked-for faces that never showed: the first take of the face looks like the resting face to the camera.
 * Decided on first takes only, so the check on later takes stays honest.
 */
function missedFaces(samples: Sample[], d: number): number[] {
  const firstLap = (list: Sample[]) => {
    let lap = Infinity
    for (const s of list) if (s.lap < lap) lap = s.lap
    return list.filter((s) => s.lap === lap)
  }
  const rest = firstLap(samples.filter((s) => s.face === 0))
  if (rest.length < 5) return []
  const r = new Float32Array(d)
  for (let j = 0; j < d; j++) r[j] = quantile(rest.map((s) => s.x[j]), 0.5)
  const out: number[] = []
  for (let c = 1; c < TUNE_FACES.length; c++) {
    const mine = firstLap(samples.filter((s) => s.face === c))
    if (mine.length >= 5 && quantile(mine.map((s) => poseScore(c, s.x, r)), 0.5) < SEEN_MIN) out.push(c)
  }
  return out
}

export function trainModel(rec: TuneRecording, now: Date = new Date()): PersonalModel {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  const { kind, samples: all, muscles, geoRest, calibration } = fitRanges(rec.samples)
  const d = kind === 'detail' ? ND : NBASIC

  // (b) which of the five faces: checked on takes it has not seen, then trained on everything.
  // A face that never showed is left out rather than learned as a second name for the resting face.
  const missed = missedFaces(all, d)
  const samples = missed.length ? all.filter((s) => !missed.includes(s.face)) : all
  const check = holdOut(samples, d)
  const fit = fitSoftmax(samples, d)
  const clf: FaceClassifier | null = fit ? { classes: fit.classes, mean: roundAll(fit.mean), scale: roundAll(fit.scale), w: roundAll(fit.w, 1e4), ...roundCentres(centres(fit, samples)) } : null

  // (c) the ear model, when the AirPods were streaming
  const span = calibration.smile[1] - calibration.smile[0]
  const own = rec.smile.v.map((v) => (v - calibration.smile[0]) / span)
  const ear = trainEar(rec.head, rec.smile.t, own)

  return {
    version: 1,
    at: now.toISOString(),
    calibration,
    accuracy: check.accuracy,
    earAccuracy: ear.model && ear.check ? ear.check.accuracy : null,
    kind,
    muscles,
    geoRest: geoRest ? roundAll(geoRest) : undefined,
    k: rec.k ? round(rec.k) : undefined,
    clf,
    perFace: check.perFace,
    frames: all.length,
    heldOut: check.heldOut,
    holdout: check.how,
    ear: ear.model,
    earCheck: ear.check,
    missed: missed.length ? missed.map((c) => TUNE_FACES[c]) : undefined,
    trainMs: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : undefined,
  }
}

function roundCentres(c: { cen: number[]; rad: number[] }): { cen: number[]; rad: number[] } {
  return { cen: roundAll(c.cen, 1e3), rad: roundAll(c.rad, 1e3) }
}

// ------------------------------------------------------------------ the live reader

export interface Reader {
  /** muscles in MUSCLES order, each 0..1 of the person's own range; works without `f.detail` (basic fields only) */
  face(f: FaceFrame, blendNames: string[]): { muscles: number[]; face: { label: TuneFace; p: number } | null }
  /** the ear model's smile, 0..1; null when there is no usable ear model */
  head(h: HeadFrame): number | null
}

export interface ReaderOptions {
  /**
   * Frames without `detail` only carry `smile` and `brow` as sense delivers them. With a model, the app has given its
   * calibration to sense (`sense.setCalibration(model.calibration)`), so those two already are shares of the person's
   * own range: that is the default. Pass false when sense was left uncalibrated.
   */
  calibrated?: boolean
}

const FACE_MIN_P = 0.5
const FACE_FAR = 3
/**
 * A read has to be backed by the muscle group that face is for (MUSCLES index by TUNE_FACES index, -1: none), moved
 * at least this share of the person's own range. Without it a face that was left out of the model (say raised brows)
 * comes out as the nearest face that was learned, with the smile group flat at zero.
 */
const FACE_BACKING: readonly number[] = [-1, 0, -1, 2, 3]
const FACE_NEEDS = 0.15
/**
 * The cheek measure comes from the cheek rising towards a narrowing eye, and lowered brows narrow the eye too.
 * So the cheek group only lights with a smile under it: this much on its own, and more per share of smile.
 */
const CHEEK_ALONE = 0.12
const CHEEK_PER_SMILE = 1.5

export function createReader(model: PersonalModel | null, opts: ReaderOptions = {}): Reader {
  const usable = model && model.version === 1 && Array.isArray(model.muscles) && model.muscles.length === MUSCLES.length ? model : null
  const ranges = usable?.muscles ?? populationRanges()
  const kind = usable?.kind ?? 'detail'
  const geoRest = usable && kind === 'detail' && usable.geoRest ? usable.geoRest : null
  const clf = usable?.clf && usable.clf.classes.length >= 2 ? usable.clf : null
  const clfD = clf ? clf.mean.length : 0
  const calibrated = usable ? opts.calibrated !== false : false
  const cal = usable?.calibration ?? null
  const observer = new Observer(usable?.k ?? 0)
  const cands = new Float32Array(NC)
  const basicX = new Float32Array(NBASIC)
  const probs = clf ? new Float64Array(clf.classes.length) : null
  const logits = clf ? new Float64Array(clf.classes.length) : null
  let lastFaceT = -Infinity // the first frame is taken as it is, whatever its time
  const earModel = usable?.ear && usable.earAccuracy !== null ? usable.ear : null
  const ear = earModel ? new EarStream(earModel.gyro) : null
  let earP = -1

  const uncal = (v: number, range: [number, number] | undefined) => {
    if (!calibrated || !range) return v
    const span = range[1] - range[0]
    return span > 0.03 ? range[0] + v * span : v
  }

  function classify(x: ArrayLike<number>, t: number): { label: TuneFace; p: number } | null {
    if (!clf || !probs || !logits || x.length !== clfD) return null
    const K = clf.classes.length
    const D1 = clfD + 1
    let mx = -Infinity
    for (let k = 0; k < K; k++) {
      let s = clf.w[k * D1 + clfD]
      for (let j = 0; j < clfD; j++) s += (clf.w[k * D1 + j] * (x[j] - clf.mean[j])) / clf.scale[j]
      logits[k] = s
      if (s > mx) mx = s
    }
    let sum = 0
    for (let k = 0; k < K; k++) {
      logits[k] = Math.exp(logits[k] - mx)
      sum += logits[k]
    }
    // a little smoothing over time so the label does not flicker between frames
    const fresh = t - lastFaceT > 500 || t < lastFaceT
    const a = fresh ? 1 : 0.4
    lastFaceT = t
    let best = 0
    for (let k = 0; k < K; k++) {
      probs[k] += (logits[k] / sum - probs[k]) * a
      if (probs[k] > probs[best]) best = k
    }
    if (probs[best] < FACE_MIN_P) return null
    let q = 0
    for (let j = 0; j < clfD; j++) q += ((x[j] - clf.mean[j]) / clf.scale[j] - clf.cen[best * clfD + j]) ** 2
    if (Math.sqrt(q / clfD) > FACE_FAR * clf.rad[best]) return null
    return { label: TUNE_FACES[clf.classes[best]], p: Math.round(probs[best] * 1000) / 1000 }
  }

  return {
    face(f, blendNames) {
      const muscles: number[] = new Array(MUSCLES.length).fill(0)
      const x = observer.observe(f, blendNames)
      if (!x) return { muscles, face: null }
      const full = x.length === ND
      if (full) {
        candidates(x, geoRest, cands)
        for (let m = 0; m < muscles.length; m++) {
          const r = ranges[m]
          // a geometry measure needs the resting geometry; without it fall back to the group's blendshape measure
          const src = !geoRest && (r.src === 4 || r.src === 6) ? CANDS[m][0] : r.src
          const range = src === r.src ? r : { rest: POP[src][0], max: POP[src][1] }
          muscles[m] = clamp01((cands[src] - range.rest) / (range.max - range.rest || 1))
        }
        muscles[1] = Math.min(muscles[1], CHEEK_ALONE + CHEEK_PER_SMILE * muscles[0])
        if (kind === 'detail') {
          const read = classify(x, f.t)
          const m = read ? FACE_BACKING[TUNE_FACES.indexOf(read.label)] : -1
          return { muscles, face: m >= 0 && !ranges[m].weak && muscles[m] < FACE_NEEDS ? null : read }
        }
        basicX[0] = x[B_SMILE]
        basicX[1] = x[X_CHEEK]
        basicX[2] = x[B_BROWDOWN]
        basicX[3] = x[B_JAW]
        basicX[4] = x[B_BLINK]
        return { muscles, face: classify(basicX, f.t) }
      }
      // basic fields only: smile, cheek, brow, jaw and blink are all there is
      const share = (m: number, raw: number) => clamp01((raw - ranges[m].rest) / (ranges[m].max - ranges[m].rest || 1))
      muscles[0] = calibrated ? clamp01(x[0]) : share(0, x[0])
      muscles[1] = share(1, x[1])
      muscles[2] = calibrated ? clamp01(x[2]) : share(2, x[2])
      muscles[1] = Math.min(muscles[1], CHEEK_ALONE + CHEEK_PER_SMILE * muscles[0])
      muscles[5] = share(5, x[3])
      muscles[6] = share(6, x[4])
      if (kind !== 'basic') return { muscles, face: null }
      basicX[0] = uncal(x[0], cal?.smile)
      basicX[1] = x[1]
      basicX[2] = uncal(x[2], cal?.brow)
      basicX[3] = x[3]
      basicX[4] = x[4]
      return { muscles, face: classify(basicX, f.t) }
    },
    head(h) {
      if (!ear || !earModel || h.source !== 'airpods') return null
      const feat = ear.push(h)
      if (!feat) return earP < 0 ? null : earP
      const p = 1 / (1 + Math.exp(-ldaScore(earModel, feat)))
      earP = earP < 0 ? p : earP + (p - earP) * 0.3
      return Math.round(earP * 1000) / 1000
    },
  }
}
