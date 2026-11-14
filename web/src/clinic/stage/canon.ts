// A posable neutral face for the stage: the canonical 478-point mesh, bent a little by the eight muscle groups and
// turned by head angles, written out in the wire format of LiveMesh (image-normalised x1000).
// Two users: the idle / old-phone face on the big screen, and the fake sensor (bun). No DOM, no dependencies.
import { CANON } from './canonData'

export const MESH_POINTS = 478
export const MESH_LEN = MESH_POINTS * 3

/** degrees. pitch: + chin up. yaw: + nose towards image right (the person's left). roll: + clockwise on screen. */
export interface Pose {
  pitch: number
  yaw: number
  roll: number
}

export interface PoseOpts {
  /** face width as a share of the image width */
  size?: number
  /** face centre in the image, 0..1 */
  cx?: number
  cy?: number
  /** image width / height; the phone's front camera in portrait is 3:4 */
  aspect?: number
  /** 1000 for the wire (integers), 1 for image-normalised floats */
  scale?: 1 | 1000
}

const gauss = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-((dx * dx) / (2 * sx * sx) + (dy * dy) / (2 * sy * sy)))
const sstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

// per-landmark weights of each deformer, computed once from the neutral face
interface Weights {
  corner: Float32Array // mouth corners, signed by side (-1 image left, +1 image right)
  cornerAbs: Float32Array
  cheek: Float32Array
  brow: Float32Array
  browSide: Float32Array
  jaw: Float32Array
  eye: Float32Array
  eyeY: Float32Array // the lid line each eye point closes onto
  nose: Float32Array
}
let W: Weights | null = null
function weights(): Weights {
  if (W) return W
  const n = MESH_POINTS
  const w: Weights = {
    corner: new Float32Array(n),
    cornerAbs: new Float32Array(n),
    cheek: new Float32Array(n),
    brow: new Float32Array(n),
    browSide: new Float32Array(n),
    jaw: new Float32Array(n),
    eye: new Float32Array(n),
    eyeY: new Float32Array(n),
    nose: new Float32Array(n),
  }
  for (let i = 0; i < n; i++) {
    const x = CANON[i * 3]
    const y = CANON[i * 3 + 1]
    const side = x < 0 ? -1 : 1
    const ax = Math.abs(x)
    const c = gauss(ax - 160, y - 246, 105, 80)
    w.corner[i] = c * side
    w.cornerAbs[i] = c
    w.cheek[i] = gauss(ax - 300, y - 40, 150, 120)
    w.brow[i] = gauss(ax - 190, y + 380, 170, 85)
    w.browSide[i] = side
    w.jaw[i] = sstep(236, 310, y) * (1 - 0.55 * sstep(330, 505, ax))
    w.eye[i] = i >= 468 ? 0 : gauss(ax - 207, y + 209, 78, 26)
    w.eyeY[i] = -192
    w.nose[i] = gauss(ax - 95, y + 40, 80, 90)
  }
  W = w
  return w
}

/**
 * The neutral face with muscles (MUSCLES order: smile, cheek, browDown, browUp, frown, jaw, eyes, nose; each 0..1)
 * and a head pose applied, as 478 x,y,z triples in the image-normalised convention of the phone.
 * Writes into `out` (length 1434) and returns it.
 */
export function poseFace<T extends { [i: number]: number; length: number }>(out: T, pose: Pose, muscles: ArrayLike<number> | null, opts: PoseOpts = {}): T {
  const w = weights()
  const size = opts.size ?? 0.46
  const cx = opts.cx ?? 0.5
  const cy = opts.cy ?? 0.5
  const aspect = opts.aspect ?? 0.75
  const scale = opts.scale ?? 1000
  const m = (k: number) => (muscles ? Math.min(1, Math.max(0, muscles[k] ?? 0)) : 0)
  const smile = m(0)
  const cheek = m(1)
  const browDown = m(2)
  const browUp = m(3)
  const frown = m(4)
  const jaw = m(5)
  const eyes = m(6)
  const nose = m(7)

  const a = (-pose.pitch * Math.PI) / 180
  const b = (-pose.yaw * Math.PI) / 180
  const c = (pose.roll * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const cc = Math.cos(c)
  const sc = Math.sin(c)
  const PIVOT_Z = 90 // the head turns about a point a little behind the ears
  const FOCAL = 3600
  const int = scale === 1000

  for (let i = 0; i < MESH_POINTS; i++) {
    let x = CANON[i * 3]
    let y = CANON[i * 3 + 1]
    let z = CANON[i * 3 + 2]
    // muscles, in the face's own frame
    const cs = w.corner[i]
    const ca0 = w.cornerAbs[i]
    x += cs * (58 * smile - 14 * frown)
    y += ca0 * (-62 * smile + 44 * frown)
    z += ca0 * 22 * smile
    const ck = w.cheek[i]
    y -= ck * (30 * cheek + 10 * smile)
    z -= ck * 16 * cheek
    const br = w.brow[i]
    y += br * (34 * browDown - 52 * browUp)
    x -= br * w.browSide[i] * 16 * browDown
    y += w.jaw[i] * 120 * jaw
    const ey = w.eye[i]
    if (ey > 0.01) y += (w.eyeY[i] - y) * Math.min(1, ey * 1.25) * 0.86 * Math.max(eyes, 0.35 * cheek)
    y -= w.nose[i] * 22 * nose
    // pose: pitch about x, yaw about y, roll about z
    z += PIVOT_Z
    const y1 = y * ca - z * sa
    const z1 = y * sa + z * ca
    const x2 = x * cb + z1 * sb
    const z2 = -x * sb + z1 * cb
    const x3 = x2 * cc - y1 * sc
    const y3 = x2 * sc + y1 * cc
    const p = FOCAL / (FOCAL + z2)
    const k = size / 1000
    const ox = (cx + x3 * p * k) * scale
    const oy = (cy + y3 * p * k * aspect) * scale
    const oz = (z2 - PIVOT_Z) * k * scale
    out[i * 3] = int ? Math.round(ox) : ox
    out[i * 3 + 1] = int ? Math.round(oy) : oy
    out[i * 3 + 2] = int ? Math.round(oz) : oz
  }
  return out
}
