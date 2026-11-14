// Camera pulse (rPPG): mean skin RGB per frame -> uniform 30 Hz -> POS -> band 0.7-3 Hz -> spectral bpm + quality.
// Pure (no DOM): the caller samples the skin colour and passes it in.

import { BiquadState, PosStream, biquadHighpass, biquadLowpass, clamp, smoothstep, snrToQuality, spectralPeak } from './dsp'

export const PULSE_FS = 30
export const PULSE_LO_HZ = 0.7
export const PULSE_HI_HZ = 3.0
/** seconds of pulse wave in the bpm estimate */
const BPM_WINDOW_S = 10
/** no bpm before this much signal exists */
const BPM_MIN_S = 6
/**
 * A gap this long between frames (face lost, tab hidden) restarts the pipeline; shorter gaps are bridged by
 * interpolation. Was 400 ms: on a busy device single stalls of 0.4-1 s are common, and every restart costs
 * 7.6 s without a bpm. Measured on UBFC-rPPG (validation/README.md): 1000 ms gives more coverage at the same
 * error; bridging 2 s or more lets wrong peaks through.
 */
const GAP_RESET_MS = 1000
const KEEP_S = 180

export interface PulseState {
  /** filtered pulse sample, roughly -1..1 */
  wave: number
  bpm: number | null
  /** 0..1 from the spectral SNR alone (before motion gating) */
  snrQuality: number
  snrDb: number | null
}

export class CameraPulse {
  private readonly fs = PULSE_FS
  private readonly dt = 1000 / PULSE_FS
  private pos = new PosStream(PULSE_FS)
  private hp = new BiquadState(biquadHighpass(PULSE_LO_HZ, PULSE_FS))
  private lp = new BiquadState(biquadLowpass(PULSE_HI_HZ, PULSE_FS))
  // resampler state
  private havePrev = false
  private pt = 0
  private pr = 0
  private pg = 0
  private pb = 0
  private nextT = 0
  /** uniform samples pushed into POS since the last reset */
  private pushed = 0
  private segStartT = 0
  // finished POS output (time of the sample it describes, value)
  private outT: number[] = []
  private outV: number[] = []
  /** index in outT where the current contiguous run starts */
  private runStart = 0
  private sinceEstimate = 0
  private env = 0
  private state: PulseState = { wave: 0, bpm: null, snrQuality: 0, snrDb: null }

  reset(): void {
    this.pos.reset()
    this.hp.reset()
    this.lp.reset()
    this.havePrev = false
    this.pushed = 0
    this.runStart = this.outT.length
    this.sinceEstimate = 0
    this.env = 0
    this.state = { wave: 0, bpm: null, snrQuality: 0, snrDb: null }
  }

  peek(): PulseState {
    return this.state
  }

  /** feed one camera frame: t in ms, mean skin RGB (any scale). Returns the current pulse state. */
  push(t: number, r: number, g: number, b: number): PulseState {
    if (!(r > 0 && g > 0 && b > 0) || !Number.isFinite(t)) return this.state
    if (this.havePrev && t <= this.pt) return this.state
    if (this.havePrev && t - this.pt > GAP_RESET_MS) this.reset()
    if (!this.havePrev) {
      this.havePrev = true
      this.pt = t
      this.pr = r
      this.pg = g
      this.pb = b
      this.nextT = t
      this.segStartT = t
      return this.state
    }
    while (this.nextT <= t) {
      const u = (this.nextT - this.pt) / (t - this.pt)
      this.sample(this.pr + (r - this.pr) * u, this.pg + (g - this.pg) * u, this.pb + (b - this.pb) * u)
      this.nextT += this.dt
    }
    this.pt = t
    this.pr = r
    this.pg = g
    this.pb = b
    return this.state
  }

  private sample(r: number, g: number, b: number): void {
    const y = this.pos.push(r, g, b)
    this.pushed++
    if (y === null) return
    const tOut = this.segStartT + (this.pushed - 1 - this.pos.delay) * this.dt
    this.outT.push(tOut)
    this.outV.push(y)
    const max = KEEP_S * this.fs
    if (this.outT.length > max + 600) {
      const drop = this.outT.length - max
      this.outT.splice(0, drop)
      this.outV.splice(0, drop)
      this.runStart = Math.max(0, this.runStart - drop)
    }
    const f = this.lp.step(this.hp.step(y))
    const a = Math.abs(f)
    // envelope follower: fast attack, ~4 s release, so the wave stays near -1..1
    this.env = a > this.env ? this.env + (a - this.env) * 0.2 : this.env + (a - this.env) * (1 / (4 * this.fs))
    this.state.wave = this.env > 1e-9 ? clamp(f / (1.2 * this.env), -1.5, 1.5) : 0
    if (++this.sinceEstimate >= 10) {
      this.sinceEstimate = 0
      this.estimate()
    }
  }

  private estimate(): void {
    const have = this.outT.length - this.runStart
    if (have < BPM_MIN_S * this.fs) {
      this.state.bpm = null
      this.state.snrQuality = 0
      this.state.snrDb = null
      return
    }
    const n = Math.min(have, BPM_WINDOW_S * this.fs)
    const seg = this.outV.slice(this.outV.length - n)
    const pk = spectralPeak(seg, this.fs, PULSE_LO_HZ, PULSE_HI_HZ)
    if (!pk) {
      this.state.bpm = null
      this.state.snrQuality = 0
      this.state.snrDb = null
      return
    }
    const q = snrToQuality(pk.snrDb)
    this.state.snrDb = pk.snrDb
    this.state.snrQuality = q
    // honest: no number when the peak does not stand out of the noise
    this.state.bpm = q >= 0.15 ? pk.freq * 60 : null
  }

  /**
   * POS output between two times (ms), oldest first, including the provisional newest ~1.6 s.
   * Feed this to the offline heart features.
   */
  series(t0: number, t1: number): { t: number[]; v: number[] } {
    const t: number[] = []
    const v: number[] = []
    for (let i = 0; i < this.outT.length; i++) {
      if (this.outT[i] >= t0 && this.outT[i] <= t1) {
        t.push(this.outT[i])
        v.push(this.outV[i])
      }
    }
    if (this.outT.length > this.runStart) {
      const tail = this.pos.tail()
      let tt = this.outT[this.outT.length - 1]
      // the last few provisional samples rest on too few windows to trust
      for (let i = 0; i < tail.length - 6; i++) {
        tt += this.dt
        if (tt >= t0 && tt <= t1) {
          t.push(tt)
          v.push(tail[i])
        }
      }
    }
    return { t, v }
  }
}

/**
 * 0..1: how much to trust the camera pulse right now (still head, quiet face). Multiplies the spectral quality.
 * Pure: fed once per camera frame with the head pose, the nose position in face widths, jaw opening and smile.
 */
export class MotionGate {
  private prev: { t: number; pitch: number; yaw: number; roll: number; nx: number; ny: number; jaw: number } | null = null
  private motion2 = 0
  private jawAct = 0
  value = 1

  /** the face left the frame: the next frame starts a new motion measurement */
  lost(): void {
    this.prev = null
  }

  /** voicedEma: 0..1 share of recent mic frames that were voiced (0 without a mic) */
  update(t: number, pitch: number, yaw: number, roll: number, nx: number, ny: number, jaw: number, smile: number, voicedEma: number): number {
    const p = this.prev
    this.prev = { t, pitch, yaw, roll, nx, ny, jaw }
    if (!p) return this.value
    const dt = (t - p.t) / 1000
    if (!(dt > 0.005 && dt < 0.5)) return this.value
    const rot = Math.hypot(pitch - p.pitch, yaw - p.yaw, roll - p.roll) / dt // deg/s
    const shift = Math.hypot(nx - p.nx, ny - p.ny) / dt // face widths / s
    const m = rot + 60 * shift
    const a = Math.min(1, dt / 1.0)
    this.motion2 += (m * m - this.motion2) * a
    this.jawAct += (Math.abs(jaw - p.jaw) / dt - this.jawAct) * a
    const move = smoothstep(10, 30, Math.sqrt(this.motion2))
    // Sound alone must not gate the pulse (the app's own audio reaches the mic): a voiced mic only makes
    // the jaw test twice as sensitive.
    const talk = smoothstep(0.5, 1.5, this.jawAct * (1 + smoothstep(0.25, 0.6, voicedEma)))
    const grin = smoothstep(0.4, 0.75, smile)
    this.value = (1 - move) * (1 - 0.6 * talk) * (1 - 0.6 * grin)
    return this.value
  }
}
