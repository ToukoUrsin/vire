// Records the teaching minute. No DOM: tests drive it with made-up frames.
import type { EarAsk, EarRecording, EarStep } from '@shared/ear'
import type { FaceFrame, HeadFrame, VoiceFrame } from '../../sense/types'

export interface TeachStep {
  ask: EarAsk
  ms: number
  /** the word on screen */
  say: string
  /** the line under it */
  hint: string
}

/** how many times the same round is done; the check teaches on all but one and asks about the one left out */
export const TEACH_ROUNDS = 3
/** stillness between two rounds: a little longer than the ear model looks back, so nothing felt in one round reaches into the next */
const BETWEEN_MS = 3800

const round = (n: number, last: boolean): TeachStep[] => [
  { ask: 'smile', ms: 2500, say: 'Smile', hint: 'A real one if you can.' },
  { ask: 'relax', ms: 2500, say: 'Let it go', hint: 'Face at rest.' },
  { ask: 'smile', ms: 2500, say: 'Smile', hint: 'Once more.' },
  { ask: 'relax', ms: 2500, say: 'Let it go', hint: 'Face at rest.' },
  { ask: 'nod', ms: 3000, say: 'Nod yes', hint: 'A few times, your own way.' },
  { ask: 'rest', ms: 1500, say: 'Still', hint: 'Head at rest.' },
  { ask: 'shake', ms: 3000, say: 'Shake no', hint: 'A few times.' },
  { ask: 'rest', ms: last ? 2000 : BETWEEN_MS, say: 'Still', hint: last ? 'That was it.' : `Round ${n + 2} of ${TEACH_ROUNDS} next.` },
]

/**
 * About a minute: the same round three times. Smile twice, nod, shake no, with stillness between.
 * Three rounds so the check can teach on two and ask about a whole round the model never saw.
 */
export const TEACH_STEPS: TeachStep[] = [
  { ask: 'rest', ms: 3000, say: 'Sit still', hint: 'Face at rest, eyes on the screen.' },
  ...Array.from({ length: TEACH_ROUNDS }, (_, n) => round(n, n === TEACH_ROUNDS - 1)).flat(),
]

export const TEACH_MS = TEACH_STEPS.reduce((s, x) => s + x.ms, 0)

const r3 = (v: number) => Math.round(v * 1000) / 1000
const VOICE_MS = 40
const MAX_ROWS = 6000

export class EarRecorder {
  private t0 = 0
  private on = false
  private head_: number[][] = []
  private face_: number[][] = []
  private voice_: number[][] = []
  private steps_: EarStep[] = []
  private gyro = 0
  private vSlot = -1
  private vMax = -120
  private vVoiced = 0
  private at = ''

  /** `t` is on the frames' own clock (performance.now) */
  begin(t: number, at: Date = new Date()): void {
    this.t0 = t
    this.on = true
    this.at = at.toISOString()
    this.head_ = []
    this.face_ = []
    this.voice_ = []
    this.steps_ = []
    this.gyro = 0
    this.vSlot = -1
  }

  get running(): boolean {
    return this.on
  }

  get headRows(): number {
    return this.head_.length
  }

  step(ask: EarAsk, t0: number, t1: number): void {
    if (this.on) this.steps_.push({ ask, t0: Math.round(t0 - this.t0), t1: Math.round(t1 - this.t0) })
  }

  head(h: HeadFrame): void {
    if (!this.on || h.source !== 'airpods' || this.head_.length >= MAX_ROWS) return
    const t = h.t - this.t0
    if (t < 0) return
    if (h.rx !== undefined) this.gyro++
    this.head_.push([Math.round(t), r3(h.pitch), r3(h.yaw), r3(h.roll), r3(h.ax), r3(h.ay), r3(h.az), r3(h.rx ?? 0), r3(h.ry ?? 0), r3(h.rz ?? 0)])
  }

  face(f: FaceFrame): void {
    if (!this.on || this.face_.length >= MAX_ROWS) return
    const t = f.t - this.t0
    if (t < 0) return
    this.face_.push(f.present ? [Math.round(t), 1, r3(f.smile), r3(f.cheek), r3(f.jawOpen), r3(f.brow), r3(f.pitch), r3(f.yaw), r3(f.roll)] : [Math.round(t), 0, 0, 0, 0, 0, 0, 0, 0])
  }

  /** ~50 a second in; 25 a second kept: the loudest of each 40 ms, voiced if any of it was */
  voice(v: VoiceFrame): void {
    if (!this.on || this.voice_.length >= MAX_ROWS) return
    const t = v.t - this.t0
    if (t < 0) return
    const slot = Math.floor(t / VOICE_MS)
    if (slot !== this.vSlot) {
      this.flushVoice()
      this.vSlot = slot
      this.vMax = -120
      this.vVoiced = 0
    }
    if (v.rms > this.vMax) this.vMax = v.rms
    if (v.voiced) this.vVoiced = 1
  }

  private flushVoice(): void {
    if (this.vSlot >= 0) this.voice_.push([this.vSlot * VOICE_MS, Math.round(this.vMax * 10) / 10, this.vVoiced])
  }

  end(meta: { userId: string | null; shell: 'mac' | 'ios' | 'sim'; ua: string }): EarRecording {
    this.flushVoice()
    this.on = false
    const h = this.head_
    const span = h.length > 1 ? (h[h.length - 1][0] - h[0][0]) / 1000 : 0
    return {
      v: 1,
      at: this.at,
      userId: meta.userId,
      device: { shell: meta.shell, gyro: this.gyro > 0.9 * h.length && h.length > 0, hz: span > 0 ? Math.round(((h.length - 1) / span) * 10) / 10 : 0, ua: meta.ua.slice(0, 200) },
      head: h,
      face: this.face_,
      voice: this.voice_,
      steps: this.steps_,
    }
  }
}
