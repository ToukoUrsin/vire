// The face as a glowing wireframe with the eight muscle groups of MUSCLES lit by their value.
// One canvas, one requestAnimationFrame loop, no per-frame allocation. Never draws the camera picture: only landmarks.
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { MUSCLES } from '@shared/types'
import { AspectTracker } from './model'
import { BROWS, EYES, LIPS, NEUTRAL, OVAL, TESS, TRIS } from './topology'
import './tune.css'

export interface MuscleMapProps {
  /** 478 x,y,z triples: image-normalised floats, or the x1000 ints of LiveMesh. null draws a built-in neutral face. */
  mesh: ArrayLike<number> | null
  /** MUSCLES order, 0..1 */
  muscles: number[] | null
  scale?: 1 | 1000
  mirrored?: boolean
  className?: string
  /** polled every animation frame instead of the `mesh` / `muscles` props, so a 30 Hz stream needs no React render */
  live?: () => { mesh: ArrayLike<number> | null; muscles: ArrayLike<number> | null }
  /** camera image width / height. Left out, it is worked out from the face itself (and snapped to 4:3, 3:4, 16:9, 9:16, 1:1). */
  aspect?: number
  /** name the working muscle groups beside the face */
  labels?: boolean
}

const N = 478
const NM = MUSCLES.length
const LEVELS = 3

/** plain names for the optional labels, MUSCLES order */
export const MUSCLE_NAMES = ['Smile', 'Cheeks', 'Brow lowering', 'Brow raising', 'Lip corners down', 'Jaw', 'Eyelids', 'Nose'] as const

// ------------------------------------------------------------------ regions, computed once from the neutral face

interface Blob {
  idx: Uint16Array
  w: Float32Array
  /** radius in face widths */
  r: number
}
interface Region {
  tris: Uint16Array[]
  edges: Uint16Array[]
  nodes: Uint16Array
  blobs: Blob[]
  /** 0 = amber (the smile channel), 1 = ember */
  hue: 0 | 1
  /** landmark the label points at, and the side it sits on: -1 = image left */
  tip: number
  side: -1 | 1
}

const np = (i: number): [number, number, number] => [NEUTRAL[i * 3], NEUTRAL[i * 3 + 1], NEUTRAL[i * 3 + 2]]

function nearest(x: number, y: number): number {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < 468; i++) {
    const d = (NEUTRAL[i * 3] - x) ** 2 + (NEUTRAL[i * 3 + 1] - y) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

const uniq = (list: readonly number[]) => Array.from(new Set(list))

/** [landmark on the person's right half or the midline, gain]; the other half is added by mirroring */
type Anchor = [number, number]
const off = (i: number, dx: number, dy: number, g: number): Anchor => {
  const p = np(i)
  return [nearest(p[0] + dx, p[1] + dy), g]
}

const SPEC: { anchors: Anchor[]; sigma: number; hue: 0 | 1; tip: number; side: -1 | 1 }[] = [
  // smile: zygomaticus major, from the lip corner up and out to the cheekbone
  { anchors: [[61, 1], [216, 1], [207, 0.95], [187, 0.85], [205, 0.6], [147, 0.6], [123, 0.4]], sigma: 52, hue: 0, tip: 427, side: 1 },
  // cheek: orbicularis oculi under the eye (AU6)
  { anchors: [[117, 1], [118, 1], [119, 1], [101, 0.9], [50, 0.9], [116, 0.6]], sigma: 46, hue: 0, tip: 117, side: -1 },
  // browDown: corrugator and procerus, between the brows (AU4)
  { anchors: [[9, 1], [8, 0.9], [107, 1], [55, 1], [66, 0.5], [65, 0.5], [168, 0.45]], sigma: 46, hue: 1, tip: 336, side: 1 },
  // browUp: frontalis, the forehead (AU1+2)
  { anchors: [[151, 1], [10, 0.6], off(105, 0, -95, 1), off(70, 20, -85, 0.8), off(107, 0, -100, 1), [105, 0.7], [66, 0.7], [63, 0.6]], sigma: 66, hue: 1, tip: 67, side: -1 },
  // frown: depressor anguli oris, from the lip corner down to the jaw (AU15)
  { anchors: [[202, 1], [204, 1], [210, 0.9], [32, 0.7], [61, 0.45]], sigma: 46, hue: 1, tip: 204, side: -1 },
  // jaw: the jaw line and chin
  { anchors: [[58, 0.9], [172, 1], [136, 1], [150, 1], [149, 1], [176, 1], [148, 1], [152, 1], [175, 0.6], [132, 0.5]], sigma: 40, hue: 1, tip: 365, side: 1 },
  // eyes: the lids
  { anchors: uniq(EYES).filter((i) => NEUTRAL[i * 3] < 0).map((i): Anchor => [i, 1]), sigma: 26, hue: 1, tip: 263, side: 1 },
  // nose: the nose wrinkler along the sides of the nose (AU9)
  { anchors: [[129, 1], [98, 0.7], off(133, 35, 70, 0.9), off(133, 45, 140, 1), [6, 0.6], [197, 0.6]], sigma: 40, hue: 1, tip: 129, side: -1 },
]

function buildRegions(): Region[] {
  const edgeCount = TESS.length / 2
  const triCount = TRIS.length / 3
  return SPEC.map((s) => {
    const all: Anchor[] = []
    for (const [i, g] of s.anchors) {
      all.push([i, g])
      const p = np(i)
      if (Math.abs(p[0]) > 12) all.push([nearest(-p[0], p[1]), g])
    }
    const w = new Float32Array(N)
    const k = 1 / (2 * s.sigma * s.sigma)
    for (let v = 0; v < 468; v++) {
      const p = np(v)
      let best = 0
      for (const [i, g] of all) {
        const a = np(i)
        const d2 = (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2
        const val = g * Math.exp(-d2 * k)
        if (val > best) best = val
      }
      w[v] = best
    }
    const level = (x: number) => (x >= 0.7 ? 2 : x >= 0.45 ? 1 : x >= 0.2 ? 0 : -1)
    const edges: number[][] = [[], [], []]
    for (let e = 0; e < edgeCount; e++) {
      const a = TESS[e * 2]
      const b = TESS[e * 2 + 1]
      const l = level((w[a] + w[b]) / 2)
      if (l >= 0) edges[l].push(a, b)
    }
    const tris: number[][] = [[], [], []]
    for (let t = 0; t < triCount; t++) {
      const a = TRIS[t * 3]
      const b = TRIS[t * 3 + 1]
      const c = TRIS[t * 3 + 2]
      const l = level((w[a] + w[b] + w[c]) / 3)
      if (l >= 0) tris[l].push(a, b, c)
    }
    const nodes: number[] = []
    const groups: number[][] = [[], [], []]
    for (let v = 0; v < 468; v++) {
      if (w[v] >= 0.62) nodes.push(v)
      if (w[v] >= 0.5) groups[NEUTRAL[v * 3] < -45 ? 0 : NEUTRAL[v * 3] > 45 ? 2 : 1].push(v)
    }
    const blobs: Blob[] = groups
      .filter((g) => g.length >= 3)
      .map((g) => ({ idx: Uint16Array.from(g), w: Float32Array.from(g.map((v) => w[v])), r: (s.sigma * 2.6) / 1000 }))
    return { tris: tris.map((t) => Uint16Array.from(t)), edges: edges.map((e) => Uint16Array.from(e)), nodes: Uint16Array.from(nodes), blobs, hue: s.hue, tip: s.tip, side: s.side }
  })
}

let regionsCache: Region[] | null = null
const regions = () => (regionsCache ??= buildRegions())

const TESS_A = Uint16Array.from(TESS)
const CONTOUR_STRONG = Uint16Array.from([...LIPS, ...EYES, ...BROWS])
const CONTOUR_OVAL = Uint16Array.from(OVAL)

/** face height over face width (landmarks 10-152 over 234-454) of the neutral face, used to work out the camera's aspect */
const NEUTRAL_RATIO = (() => {
  const d = (a: number, b: number) => Math.hypot(NEUTRAL[a * 3] - NEUTRAL[b * 3], NEUTRAL[a * 3 + 1] - NEUTRAL[b * 3 + 1], NEUTRAL[a * 3 + 2] - NEUTRAL[b * 3 + 2])
  return d(10, 152) / d(234, 454)
})()

// ------------------------------------------------------------------ how the built-in face moves when there is no mesh

/** per muscle: [landmarks on the person's right half or midline, dx (outwards), dy (down), reach] in face widths x1000 */
const POSE: { at: number[]; dx: number; dy: number; reach: number; below?: number }[][] = [
  [{ at: [61], dx: 34, dy: -30, reach: 70 }], // smile: corners out and up
  [{ at: [50, 117], dx: 0, dy: -16, reach: 60 }], // cheek: up towards the eye
  [{ at: [107, 55, 66], dx: -16, dy: 22, reach: 55 }], // brows down and in
  [{ at: [105, 66, 107, 70], dx: 0, dy: -34, reach: 60 }], // brows up
  [{ at: [61], dx: 6, dy: 26, reach: 55 }], // corners down
  [{ at: [152], dx: 0, dy: 62, reach: 300, below: 240 }], // jaw drops: everything under the mouth line
  [{ at: [159, 158, 160], dx: 0, dy: 30, reach: 26 }], // upper lids come down
  [{ at: [129], dx: 0, dy: -18, reach: 45 }], // nose wings up
]

interface PoseField {
  idx: Uint16Array
  dx: Float32Array
  dy: Float32Array
}
let poseCache: PoseField[] | null = null
function poseFields(): PoseField[] {
  if (poseCache) return poseCache
  poseCache = POSE.map((parts) => {
    const dx = new Float32Array(N)
    const dy = new Float32Array(N)
    for (const part of parts) {
      const k = 1 / (2 * part.reach * part.reach)
      for (let v = 0; v < 468; v++) {
        const x = NEUTRAL[v * 3]
        const y = NEUTRAL[v * 3 + 1]
        let best = 0
        let sign = 0
        if (part.below !== undefined) {
          const u = Math.max(0, Math.min(1, (y - part.below) / 24))
          dy[v] += u * u * (3 - 2 * u) * Math.exp(-x * x * k) * part.dy
          continue
        }
        for (const a of part.at) {
          const p = np(a)
          for (const m of p[0] < -12 ? [1, -1] : [0]) {
            const ax = m === -1 ? -p[0] : p[0]
            const g = Math.exp(-((x - ax) ** 2 + (y - p[1]) ** 2) * k)
            if (g > best) {
              best = g
              sign = m === 0 ? 0 : ax < 0 ? -1 : 1
            }
          }
        }
        if (best < 0.03) continue
        dx[v] += best * part.dx * sign
        dy[v] += best * part.dy
      }
    }
    const idx: number[] = []
    for (let v = 0; v < N; v++) if (dx[v] !== 0 || dy[v] !== 0) idx.push(v)
    return { idx: Uint16Array.from(idx), dx: Float32Array.from(idx.map((v) => dx[v])), dy: Float32Array.from(idx.map((v) => dy[v])) }
  })
  return poseCache
}

// ------------------------------------------------------------------ drawing

function rgbOf(el: Element, name: string, fallback: string): string {
  let v = ''
  try {
    v = getComputedStyle(el).getPropertyValue(name).trim()
  } catch {
    /* detached */
  }
  const m = /^#?([0-9a-f]{6})$/i.exec(v) ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

interface State {
  /** face-space positions being drawn and their targets: x right, y down, z away, face width = 1, centred on the face */
  cur: Float32Array
  tgt: Float32Array
  has: boolean
  mus: Float32Array
  lastMesh: ArrayLike<number> | null | undefined
  lastMeshAt: number
  interval: number
  morphUntil: number
  aspect: AspectTracker
  cx: number
  cy: number
  cz: number
  size: number
  sx: Float32Array
  sy: Float32Array
  lastT: number
}

function newState(): State {
  return {
    cur: new Float32Array(N * 3),
    tgt: new Float32Array(N * 3),
    has: false,
    mus: new Float32Array(NM),
    lastMesh: undefined,
    lastMeshAt: 0,
    interval: 33,
    morphUntil: 0,
    aspect: new AspectTracker(),
    cx: 0,
    cy: 0,
    cz: 0,
    size: 0,
    sx: new Float32Array(N),
    sy: new Float32Array(N),
    lastT: 0,
  }
}

function setTarget(st: State, mesh: ArrayLike<number> | null, muscles: ArrayLike<number> | null, unit: number, aspect: number | undefined, now: number): void {
  const t = st.tgt
  if (!mesh || mesh.length < 468 * 3) {
    // the built-in face: it sways a little so an idle screen is alive, and its features follow the muscle values
    const yaw = Math.sin(now / 2900) * 0.16
    const pitch = Math.sin(now / 4100 + 1) * 0.07
    const cyw = Math.cos(yaw)
    const syw = Math.sin(yaw)
    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    for (let i = 0; i < N * 3; i++) t[i] = NEUTRAL[i]
    if (muscles) {
      const fields = poseFields()
      for (let m = 0; m < NM; m++) {
        const v = Math.max(0, Math.min(1, +muscles[m] || 0))
        if (v < 0.01) continue
        const f = fields[m]
        for (let j = 0; j < f.idx.length; j++) {
          const i = f.idx[j] * 3
          t[i] += f.dx[j] * v
          t[i + 1] += f.dy[j] * v
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const x = t[i * 3] / 1000
      const y = t[i * 3 + 1] / 1000
      const z = t[i * 3 + 2] / 1000 + 0.35 // turn around a point inside the head
      const x1 = x * cyw + z * syw
      const z1 = -x * syw + z * cyw
      const y1 = y * cp - z1 * sp
      const z2 = y * sp + z1 * cp
      t[i * 3] = x1
      t[i * 3 + 1] = y1
      t[i * 3 + 2] = z2 - 0.35
    }
    return
  }
  const k = aspect && aspect > 0 ? 1 / aspect : st.aspect.update(mesh)
  const n = Math.min(N, Math.floor(mesh.length / 3))
  const px = (i: number) => mesh[i * 3] / unit
  const py = (i: number) => (mesh[i * 3 + 1] / unit) * k
  const pz = (i: number) => mesh[i * 3 + 2] / unit
  const w = Math.hypot(px(454) - px(234), py(454) - py(234), pz(454) - pz(234))
  if (!(w > 1e-6)) return
  const cx = (px(234) + px(454) + px(10) + px(152)) / 4
  const cy = (py(10) + py(152)) / 2
  const cz = (pz(234) + pz(454)) / 2
  // the face stays put in the frame and keeps its size; turning and tilting still show in the shape
  if (st.size === 0) {
    st.cx = cx
    st.cy = cy
    st.cz = cz
    st.size = w
  } else {
    st.cx += (cx - st.cx) * 0.5
    st.cy += (cy - st.cy) * 0.5
    st.cz += (cz - st.cz) * 0.5
    st.size += (w - st.size) * 0.15
  }
  const inv = 1 / st.size
  for (let i = 0; i < n; i++) {
    t[i * 3] = (px(i) - st.cx) * inv
    t[i * 3 + 1] = (py(i) - st.cy) * inv
    t[i * 3 + 2] = (pz(i) - st.cz) * inv
  }
  if (n < N) {
    // a 468-point mesh (no irises): park the iris points at the eye centres
    for (let i = n; i < N; i++) {
      const e = i < 473 ? [33, 133] : [362, 263]
      for (let c = 0; c < 3; c++) t[i * 3 + c] = (t[e[0] * 3 + c] + t[e[1] * 3 + c]) / 2
    }
  }
}

function strokePairs(ctx: CanvasRenderingContext2D, sx: Float32Array, sy: Float32Array, pairs: Uint16Array): void {
  ctx.beginPath()
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i]
    const b = pairs[i + 1]
    ctx.moveTo(sx[a], sy[a])
    ctx.lineTo(sx[b], sy[b])
  }
  ctx.stroke()
}

interface Paint {
  ink: string
  hues: [string, string]
  font: string
}

function draw(ctx: CanvasRenderingContext2D, st: State, W: number, H: number, mirrored: boolean, labels: boolean, paint: Paint): void {
  ctx.clearRect(0, 0, W, H)
  if (!st.has) return
  // face width = 1 in face space; the face is about 1.36 wide-units tall. Leave room for a turned head.
  const unit = Math.min(W * 0.74, (H * 0.8) / NEUTRAL_RATIO)
  const ox = W / 2
  const oy = H / 2
  const flip = mirrored ? -1 : 1
  const { cur, sx, sy } = st
  for (let i = 0; i < N; i++) {
    sx[i] = ox + cur[i * 3] * unit * flip
    sy[i] = oy + cur[i * 3 + 1] * unit
  }
  const lw = Math.max(0.55, unit / 460)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // soft light behind the face so the wire reads on any dark background
  ctx.globalCompositeOperation = 'source-over'
  // (it must fade out inside the canvas, or the canvas edge shows as a faint box)
  const hr = Math.min(unit * 0.95, W / 2, H / 2)
  const halo = ctx.createRadialGradient(ox, oy, hr * 0.1, ox, oy, hr)
  halo.addColorStop(0, `rgba(${paint.ink},0.07)`)
  halo.addColorStop(1, `rgba(${paint.ink},0)`)
  ctx.fillStyle = halo
  ctx.fillRect(ox - hr, oy - hr, hr * 2, hr * 2)

  // wire
  ctx.lineWidth = lw
  ctx.strokeStyle = `rgba(${paint.ink},0.17)`
  strokePairs(ctx, sx, sy, TESS_A)

  // muscles: additive light, so overlapping groups and the bloom burn towards white
  ctx.globalCompositeOperation = 'lighter'
  const regs = regions()
  for (let m = 0; m < NM; m++) {
    const v = st.mus[m]
    if (v < 0.03) continue
    const r = regs[m]
    const col = paint.hues[r.hue]
    const gain = Math.min(1, v)
    for (const b of r.blobs) {
      let bx = 0
      let by = 0
      let bw = 0
      for (let j = 0; j < b.idx.length; j++) {
        bx += sx[b.idx[j]] * b.w[j]
        by += sy[b.idx[j]] * b.w[j]
        bw += b.w[j]
      }
      bx /= bw
      by /= bw
      const rad = b.r * unit * (0.85 + 0.4 * gain)
      // one unreadable frame (a value that is not a number) must not throw and leave the face half drawn
      if (!Number.isFinite(bx + by + rad)) continue
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, rad)
      g.addColorStop(0, `rgba(${col},${(0.5 * gain).toFixed(3)})`)
      g.addColorStop(0.45, `rgba(${col},${(0.2 * gain).toFixed(3)})`)
      g.addColorStop(1, `rgba(${col},0)`)
      ctx.fillStyle = g
      ctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2)
    }
    for (let l = 0; l < LEVELS; l++) {
      const tr = r.tris[l]
      if (tr.length) {
        ctx.fillStyle = `rgba(${col},${((0.07 + 0.09 * l) * gain).toFixed(3)})`
        ctx.beginPath()
        for (let i = 0; i < tr.length; i += 3) {
          ctx.moveTo(sx[tr[i]], sy[tr[i]])
          ctx.lineTo(sx[tr[i + 1]], sy[tr[i + 1]])
          ctx.lineTo(sx[tr[i + 2]], sy[tr[i + 2]])
          ctx.closePath()
        }
        ctx.fill()
      }
      const ed = r.edges[l]
      if (ed.length) {
        ctx.strokeStyle = `rgba(${col},${((0.3 + 0.3 * l) * gain).toFixed(3)})`
        ctx.lineWidth = lw * (1.1 + 0.5 * l)
        strokePairs(ctx, sx, sy, ed)
      }
    }
    // hot nodes
    const nr = lw * (1.2 + 1.6 * gain)
    ctx.fillStyle = `rgba(255,244,224,${(0.75 * gain).toFixed(3)})`
    ctx.beginPath()
    for (let j = 0; j < r.nodes.length; j++) {
      const i = r.nodes[j]
      ctx.moveTo(sx[i] + nr, sy[i])
      ctx.arc(sx[i], sy[i], nr, 0, 6.2832)
    }
    ctx.fill()
  }

  // the lines that make it a face
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = `rgba(${paint.ink},0.5)`
  ctx.lineWidth = lw * 1.5
  strokePairs(ctx, sx, sy, CONTOUR_OVAL)
  ctx.strokeStyle = `rgba(${paint.ink},0.92)`
  ctx.lineWidth = lw * 1.9
  strokePairs(ctx, sx, sy, CONTOUR_STRONG)
  // irises as rings
  ctx.lineWidth = lw * 1.5
  ctx.strokeStyle = `rgba(${paint.ink},0.8)`
  for (const c of [468, 473]) {
    let rad = 0
    for (let j = 1; j <= 4; j++) rad += Math.hypot(sx[c + j] - sx[c], sy[c + j] - sy[c]) / 4
    if (!(rad > 0.5)) continue
    ctx.beginPath()
    ctx.arc(sx[c], sy[c], rad, 0, 6.2832)
    ctx.stroke()
  }
  // every landmark as a faint point
  ctx.fillStyle = `rgba(${paint.ink},0.5)`
  const d = Math.max(1, lw * 1.25)
  ctx.beginPath()
  for (let i = 0; i < 468; i++) ctx.rect(sx[i] - d / 2, sy[i] - d / 2, d, d)
  ctx.fill()

  if (labels) drawLabels(ctx, st, W, unit, ox, paint, regs, flip)
}

function drawLabels(ctx: CanvasRenderingContext2D, st: State, W: number, unit: number, ox: number, paint: Paint, regs: Region[], flip: number): void {
  const size = Math.max(11, Math.min(26, unit / 22))
  ctx.font = `500 ${size}px ${paint.font}`
  ctx.textBaseline = 'middle'
  for (let m = 0; m < NM; m++) {
    const v = st.mus[m]
    if (v < 0.25) continue
    const r = regs[m]
    const alpha = Math.min(1, (v - 0.25) / 0.2)
    const side = r.side * flip
    const tx = st.sx[r.tip]
    const ty = st.sy[r.tip]
    const edge = ox + side * Math.min(unit * 0.66, W / 2 - 8)
    const text = `${MUSCLE_NAMES[m]} ${Math.round(Math.min(1, v) * 100)}%`
    const col = paint.hues[r.hue]
    ctx.strokeStyle = `rgba(${col},${(0.7 * alpha).toFixed(3)})`
    ctx.lineWidth = Math.max(1, unit / 600)
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(edge - side * 6, ty)
    ctx.stroke()
    ctx.fillStyle = `rgba(${paint.ink},${alpha.toFixed(3)})`
    ctx.textAlign = 'left'
    const tw = ctx.measureText(text).width
    ctx.fillText(text, side < 0 ? Math.max(4, edge - 8 - tw) : Math.min(W - 4 - tw, edge + 8), side < 0 && edge - 8 - tw < 4 ? ty - size * 0.8 : side > 0 && edge + 8 + tw > W - 4 ? ty - size * 0.8 : ty)
  }
}

export function MuscleMap(props: MuscleMapProps): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const el = wrap.current
    const cv = canvas.current
    if (!el || !cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const st = newState()
    const paint: Paint = {
      ink: rgbOf(el, '--stage-ink', '#f3ece0'),
      hues: [rgbOf(el, '--ch-smile', '#e9a23b'), rgbOf(el, '--ember', '#e4572e')],
      font: getComputedStyle(el).getPropertyValue('--font-ui').trim() || 'Inter, system-ui, sans-serif',
    }
    let W = 0
    let H = 0
    let dpr = 1
    const fit = () => {
      const r = el.getBoundingClientRect()
      W = Math.max(1, r.width)
      H = Math.max(1, r.height)
      dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
    }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    let raf = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const p = latest.current
      const src = p.live ? p.live() : p
      const mesh = src.mesh && src.mesh.length >= 468 * 3 ? src.mesh : null
      const dt = st.lastT ? Math.min(100, now - st.lastT) : 16
      st.lastT = now
      if (mesh !== st.lastMesh) {
        if (st.lastMesh !== undefined && (mesh === null) !== (st.lastMesh === null)) {
          // built-in face <-> the person's own: morph across instead of jumping
          st.morphUntil = now + 450
          if (mesh) st.size = 0
        } else if (mesh && st.lastMeshAt) {
          st.interval += (Math.min(200, now - st.lastMeshAt) - st.interval) * 0.2
        }
        st.lastMesh = mesh
        st.lastMeshAt = now
      }
      setTarget(st, mesh, src.muscles, p.scale ?? 1, p.aspect, now)
      const tau = now < st.morphUntil ? 130 : mesh ? Math.max(30, Math.min(120, st.interval * 0.75)) : 60
      const a = st.has ? 1 - Math.exp(-dt / tau) : 1
      const cur = st.cur
      const tgt = st.tgt
      for (let i = 0; i < N * 3; i++) cur[i] += (tgt[i] - cur[i]) * a
      st.has = true
      const am = 1 - Math.exp(-dt / 70)
      for (let m = 0; m < NM; m++) {
        const want = src.muscles ? Math.max(0, Math.min(1.2, +src.muscles[m] || 0)) : 0
        st.mus[m] += (want - st.mus[m]) * am
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, st, W, H, !!p.mirrored, !!p.labels, paint)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [])

  return (
    <div ref={wrap} className={props.className ? `vt-map ${props.className}` : 'vt-map'}>
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  )
}
