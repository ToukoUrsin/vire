// MediaPipe FaceLandmarker wrapper: blendshapes, head pose from the facial transformation matrix,
// and mean skin colour over forehead + cheeks for the camera pulse.
//
// Measured on real video (tests/sense): this model's cheekSquintLeft/Right outputs are always 0.0000,
// so `cheek` (AU6, the Duchenne marker) is computed from the landmarks instead: see CheekRaise below.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type FaceDelegate = 'GPU' | 'CPU'

export interface FaceReading {
  present: boolean
  smile: number
  cheek: number
  brow: number
  jawOpen: number
  blink: number
  pitch: number
  yaw: number
  roll: number
  /** mean skin RGB (0..255) over forehead + both cheeks; null when the face is missing or out of frame */
  rgb: [number, number, number] | null
  /** nose position in face widths, for translation gating */
  nx: number
  ny: number
  /**
   * Independent head angles from landmark depth (deg), same sign convention as pitch / yaw.
   * Only for checking the matrix-based pose in the lab; noisier and biased.
   */
  lmPitch: number
  lmYaw: number
  /** all blendshape scores / the 478-point mesh (x,y,z), only when `detail` is on */
  blend: Float32Array | null
  mesh: Float32Array | null
  /** face width (cheek to cheek) in camera pixels, and the nose position as a fraction of the frame; 0 when no face */
  faceW: number
  cx: number
  cy: number
}

const RAD = 180 / Math.PI
/** a GPU delegate slower than this per frame is assumed to be software rendering */
const SLOW_GPU_MS = 70
const EMPTY: FaceReading = { present: false, smile: 0, cheek: 0, brow: 0, jawOpen: 0, blink: 0, pitch: 0, yaw: 0, roll: 0, rgb: null, nx: 0, ny: 0, lmPitch: 0, lmYaw: 0, blend: null, mesh: null, faceW: 0, cx: 0, cy: 0 }

/**
 * AU6 "cheek raiser and lid compressor" from geometry, relative to this person's own resting face:
 *   raise  = how much the cheek apex has moved towards the outer eye corner (3D distance / eye-to-eye distance)
 *   narrow = how much the eye opening has closed (lid gap / eye width), median over 9 frames so blinks drop out
 * cheek = 0.6 * raise / 0.18 + 0.4 * narrow / 0.6, clamped to 0..1: a clear closed-mouth smile with
 * raised cheeks reads about 0.5 on real video, a resting face 0.
 * The resting values follow the face slowly (3 s) and only while it is not smiling.
 */
class CheekRaise {
  private rest = 0
  private restEar = 0
  private seeded = false
  private lastT = 0
  private recent: number[] = []

  reset(): void {
    this.seeded = false
    this.recent = []
  }

  update(p: NormalizedLandmark[], aspect: number, tMs: number, smile: number): number {
    // x and z share a scale (image width); y is in image heights
    const d = (a: number, b: number) => Math.hypot(p[a].x - p[b].x, (p[a].y - p[b].y) * aspect, p[a].z - p[b].z)
    const eyes = d(33, 263)
    const wR = d(33, 133)
    const wL = d(263, 362)
    if (!(eyes > 0 && wR > 0 && wL > 0)) return 0
    const ratio = (d(33, 50) + d(263, 280)) / 2 / eyes
    const ear = (d(159, 145) / wR + d(386, 374) / wL) / 2
    const dt = this.seeded ? Math.min(0.5, Math.max(0, (tMs - this.lastT) / 1000)) : 0
    this.lastT = tMs
    if (!this.seeded) {
      this.seeded = true
      this.rest = ratio
      this.restEar = ear
    }
    if (smile < 0.08) {
      const a = Math.min(1, dt / 3)
      this.rest += (ratio - this.rest) * a
      if (ear > 0.8 * this.restEar) this.restEar += (ear - this.restEar) * a // not mid-blink
    }
    const raise = 1 - ratio / this.rest
    this.recent.push(1 - ear / this.restEar)
    if (this.recent.length > 9) this.recent.shift()
    const sorted = this.recent.slice().sort((x, y) => x - y)
    const narrow = sorted[sorted.length >> 1]
    return Math.max(0, Math.min(1, (0.6 * raise) / 0.18 + (0.4 * narrow) / 0.6))
  }
}

/**
 * The face library posts its own usage log to Google (odml.pa.googleapis.com). Vire says only numbers leave the phone,
 * and means it: that request is answered here and never goes out.
 */
let logKeptHome = false
function keepLogHome() {
  if (logKeptHome || typeof window === 'undefined') return
  logKeptHome = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return url.startsWith('https://odml.pa.googleapis.com/') ? Promise.resolve(new Response('', { status: 200 })) : real(input, init)
  }
}

async function create(delegate: FaceDelegate): Promise<FaceLandmarker> {
  keepLogHome()
  const wasm =new URL('wasm', document.baseURI).toString().replace(/\/$/, '')
  const model = new URL('models/face_landmarker.task', document.baseURI).toString()
  const fileset = await FilesetResolver.forVisionTasks(wasm)
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  })
}

/** ?delegate=cpu (in the URL or the hash) or localStorage.vireDelegate = 'cpu' forces the CPU path for debugging */
function forcedDelegate(): FaceDelegate | null {
  try {
    const m = /[?&]delegate=(cpu|gpu)/i.exec(location.href)
    const v = (m ? m[1] : localStorage.getItem('vireDelegate')) ?? ''
    if (/^cpu$/i.test(v)) return 'CPU'
    if (/^gpu$/i.test(v)) return 'GPU'
  } catch {
    /* no storage */
  }
  return null
}

export class FaceTracker {
  delegate: FaceDelegate = 'GPU'
  private lm: FaceLandmarker | null = null
  private lastTs = 0
  private idx: Record<string, number> | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private okFrames = 0
  private cheekRaise = new CheekRaise()
  private hadFace = false
  /** when true, readings carry every blendshape and the mesh (for the personal model and the mesh view) */
  detail = false
  /** blendshape names in model order; filled on the first face */
  names: string[] = []
  /** ms spent in the model / in skin sampling on the last frame */
  modelMs = 0
  skinMs = 0
  // delegate choice by measurement: a GPU delegate on software GL (no real GPU) is many times slower than the CPU one
  private timing: number[] = []
  private gpuMedianMs = 0
  private settled = forcedDelegate() !== null

  async load(): Promise<void> {
    if (this.lm) return
    const forced = forcedDelegate()
    if (forced !== 'CPU') {
      try {
        this.lm = await create('GPU')
        this.delegate = 'GPU'
        return
      } catch (err) {
        if (forced === 'GPU') throw err
        console.warn('[sense] face model: GPU delegate failed, using CPU', err)
      }
    }
    this.lm = await create('CPU')
    this.delegate = 'CPU'
  }

  private async rebuild(delegate: FaceDelegate): Promise<void> {
    const old = this.lm
    this.lm = null
    try {
      old?.close()
    } catch {
      /* ignore */
    }
    this.lm = await create(delegate)
    this.delegate = delegate
    this.okFrames = 0
  }

  /** run the model on the current video frame. tMs must be on a monotonic clock. */
  async detect(video: HTMLVideoElement, tMs: number): Promise<FaceReading> {
    const lm = this.lm
    if (!lm || video.readyState < 2 || video.videoWidth === 0) return EMPTY
    const ts = Math.max(this.lastTs + 1, Math.round(tMs))
    this.lastTs = ts
    let res
    const t0 = performance.now()
    try {
      res = lm.detectForVideo(video, ts)
      this.modelMs = performance.now() - t0
      this.okFrames++
    } catch (err) {
      // a GPU graph that dies on its first frames (some WebViews): rebuild once on the CPU
      if (this.delegate === 'GPU' && this.okFrames < 5) {
        console.warn('[sense] face model: GPU inference failed, rebuilding on CPU', err)
        this.settled = true
        await this.rebuild('CPU')
        return EMPTY
      }
      throw err
    }
    if (!this.settled) {
      this.timing.push(this.modelMs)
      if (this.timing.length >= 24) {
        const warm = this.timing.slice(4).sort((x, y) => x - y)
        const med = warm[warm.length >> 1]
        this.timing = []
        if (this.delegate === 'GPU' && med > SLOW_GPU_MS) {
          console.warn(`[sense] face model: GPU delegate is slow (${med.toFixed(0)} ms per frame), trying CPU`)
          this.gpuMedianMs = med
          await this.rebuild('CPU')
          return EMPTY
        }
        this.settled = true
        if (this.delegate === 'CPU' && this.gpuMedianMs > 0 && med > this.gpuMedianMs) {
          console.warn(`[sense] face model: CPU is slower still (${med.toFixed(0)} ms), back to GPU`)
          await this.rebuild('GPU')
          return EMPTY
        }
      }
    }
    const pts = res.faceLandmarks?.[0]
    if (!pts || pts.length < 468) {
      this.hadFace = false
      return EMPTY
    }
    if (!this.hadFace) this.cheekRaise.reset() // possibly another person: relearn the resting face
    this.hadFace = true
    const cats = res.faceBlendshapes?.[0]?.categories
    let smile = 0
    let cheek = 0
    let brow = 0
    let jawOpen = 0
    let blink = 0
    if (cats && cats.length) {
      if (!this.idx) {
        this.idx = {}
        cats.forEach((c, i) => {
          this.idx![c.categoryName] = i
        })
        this.names = cats.map((c) => c.categoryName)
      }
      const s = (name: string) => {
        const i = this.idx![name]
        return i === undefined ? 0 : cats[i].score
      }
      smile = (s('mouthSmileLeft') + s('mouthSmileRight')) / 2
      brow = (s('browDownLeft') + s('browDownRight')) / 2
      jawOpen = s('jawOpen')
      blink = (s('eyeBlinkLeft') + s('eyeBlinkRight')) / 2
    }
    let pitch = 0
    let yaw = 0
    let roll = 0
    const m = res.facialTransformationMatrixes?.[0]?.data
    if (m && m.length >= 16) {
      // column-major 4x4, canonical face -> camera. Camera: x right in the image, y up, z towards the camera.
      // Third column = where the nose points; first column = the face's x axis.
      const nx = m[8]
      const ny = m[9]
      const nz = m[10]
      const nl = Math.hypot(nx, ny, nz) || 1
      pitch = Math.asin(Math.max(-1, Math.min(1, ny / nl))) * RAD // + chin up
      yaw = Math.atan2(nx, nz) * RAD // + nose towards image right = the person's left
      roll = Math.atan2(m[1], m[0]) * RAD
    }
    const vw = video.videoWidth
    const vh = video.videoHeight
    cheek = this.cheekRaise.update(pts, vh / vw, tMs, smile)
    const fw = Math.hypot((pts[454].x - pts[234].x) * vw, (pts[454].y - pts[234].y) * vh) || 1
    const t1 = performance.now()
    const rgb = this.sampleSkin(video, pts, vw, vh, fw)
    this.skinMs = performance.now() - t1
    // landmark z: smaller = closer to the camera, in the same scale as x.
    // Turning to the person's left pushes their left cheek (454, image right) away; chin up brings the chin (152) closer than the forehead (10).
    const lmYaw = Math.atan2((pts[454].z - pts[234].z) * vw, (pts[454].x - pts[234].x) * vw) * RAD
    const lmPitch = Math.atan2((pts[10].z - pts[152].z) * vw, (pts[152].y - pts[10].y) * vh) * RAD
    let blend: Float32Array | null = null
    let mesh: Float32Array | null = null
    if (this.detail) {
      blend = new Float32Array(cats?.length ?? 0)
      if (cats) for (let i = 0; i < cats.length; i++) blend[i] = cats[i].score
      mesh = new Float32Array(pts.length * 3)
      for (let i = 0; i < pts.length; i++) {
        mesh[i * 3] = pts[i].x
        mesh[i * 3 + 1] = pts[i].y
        mesh[i * 3 + 2] = pts[i].z
      }
    }
    return { present: true, smile, cheek, brow, jawOpen, blink, pitch, yaw, roll, rgb, nx: (pts[1].x * vw) / fw, ny: (pts[1].y * vh) / fw, lmPitch, lmYaw, blend, mesh, faceW: fw, cx: pts[1].x, cy: pts[1].y }
  }

  /**
   * Mean RGB over three skin patches. Each patch is drawn scaled down into a tiny canvas
   * (the browser does the averaging), then read back in one getImageData.
   */
  private sampleSkin(video: HTMLVideoElement, p: NormalizedLandmark[], vw: number, vh: number, fw: number): [number, number, number] | null {
    const P = 16
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.canvas.width = P * 3
      this.canvas.height = P
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
      if (this.ctx) this.ctx.imageSmoothingQuality = 'medium'
    }
    const ctx = this.ctx
    if (!ctx) return null
    const px = (i: number) => p[i].x * vw
    const py = (i: number) => p[i].y * vh
    // forehead: between the brows' upper edge and the upper forehead, centre strip
    const fx0 = px(69)
    const fx1 = px(299)
    const fy0 = (py(10) + py(151)) / 2
    const fy1 = py(151) * 0.4 + py(9) * 0.6
    const h = 0.085 * fw
    // cheeks: squares centred below the eyes (landmarks 205 / 425 are the cheek centres)
    const rects: [number, number, number, number][] = [
      [Math.min(fx0, fx1), Math.min(fy0, fy1), Math.abs(fx1 - fx0), Math.abs(fy1 - fy0)],
      [px(205) - h, py(205) - h, 2 * h, 2 * h],
      [px(425) - h, py(425) - h, 2 * h, 2 * h],
    ]
    let used = 0
    for (let k = 0; k < 3; k++) {
      const [x, y, w, hh] = rects[k]
      if (w < 4 || hh < 4 || x < 0 || y < 0 || x + w > vw || y + hh > vh) continue
      try {
        ctx.drawImage(video, x, y, w, hh, used * P, 0, P, P)
      } catch {
        return null
      }
      used++
    }
    if (used === 0) return null
    let data: Uint8ClampedArray
    try {
      data = ctx.getImageData(0, 0, used * P, P).data
    } catch {
      return null
    }
    let r = 0
    let g = 0
    let b = 0
    const n = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
    }
    return [r / n, g / n, b / n]
  }
}

let shared: FaceTracker | null = null
let sharedLoad: Promise<FaceTracker> | null = null

/** one model instance per page: loading costs seconds, so start/stop cycles reuse it */
export function loadFaceTracker(): Promise<FaceTracker> {
  if (!sharedLoad) {
    shared = new FaceTracker()
    const t = shared
    sharedLoad = t.load().then(
      () => t,
      (err) => {
        sharedLoad = null
        throw err
      },
    )
  }
  return sharedLoad
}
