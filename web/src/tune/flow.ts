// The tune step without its screen: which face is asked for, when the count starts, what is recorded.
// No DOM, so tests can drive it with synthetic faces.
import { TUNE_FACES } from '../../../shared/types'
import type { TuneFace } from '@shared/types'
import type { FaceFrame, HeadFrame } from '../sense/types'
import { ND, Observer, createReader, poseScore, provisionalModel, quantile, smileOf, trainModel } from './model'
import type { PersonalModel, Reader, TuneRecording } from './model'

export interface FlowStep {
  face: TuneFace
  /** 0 = first take, 1 and up = later takes (what the model is checked on) */
  lap: number
  holdMs: number
}

/**
 * Every face twice, so the check runs on takes the model has not seen; the optional smile third take trains the ear model.
 */
export const FLOW_STEPS: FlowStep[] = [
  { face: 'rest', lap: 0, holdMs: 1500 },
  { face: 'smile', lap: 0, holdMs: 1500 },
  { face: 'sad', lap: 0, holdMs: 1500 },
  { face: 'angry', lap: 0, holdMs: 1500 },
  { face: 'surprised', lap: 0, holdMs: 1500 },
  { face: 'rest', lap: 1, holdMs: 700 },
  { face: 'smile', lap: 1, holdMs: 700 },
  { face: 'sad', lap: 1, holdMs: 700 },
  { face: 'angry', lap: 1, holdMs: 700 },
  { face: 'surprised', lap: 1, holdMs: 700 },
  // A third smile is useful only when AirPods motion can train the ear model.
  { face: 'smile', lap: 2, holdMs: 700 },
]

/** 'look' = no face in view, 'wait' = waiting for the asked-for face, 'hold' = counting */
export type FlowState = 'idle' | 'look' | 'wait' | 'hold' | 'done'

/** nobody reads a prompt and moves their face faster than this */
const REACT_MS = 600
/** the count starts anyway after this long with a face in view, so nobody gets stuck */
const WAIT_MAX_MS = 3500
/** a pose that slips away pauses the count; after this long it carries on regardless */
const PAUSE_MAX_MS = 1500
const MAX_HEAD = 4000
/** the muscle groups each face is for (MUSCLES order), by TUNE_FACES index */
const DRIVEN: readonly (readonly number[])[] = [[], [0, 1], [4], [2], [3]]
/** a first take is drawn against its own biggest so far, but never against less than this share of a typical range */
const PEAK_FLOOR = 0.2

export class TuneRun {
  readonly steps: FlowStep[]
  readonly rec: TuneRecording = { samples: [], smile: { t: [], v: [] }, head: [] }
  index = -1
  state: FlowState = 'idle'
  /** steps where the asked-for face was never seen and the count started on the timeout */
  readonly late: boolean[] = []
  onStep: ((index: number, step: FlowStep) => void) | null = null
  onEnd: (() => void) | null = null

  private observer = new Observer()
  private reader: Reader = createReader(null)
  private rest: Float32Array | null = null
  private held = 0
  private inStep = 0
  private paused = 0
  private forced = false
  private score = 0
  private lastT = 0
  private now: number[] = []
  private peak: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  private airpods = false

  constructor(steps: FlowStep[] = FLOW_STEPS) {
    this.steps = steps
  }

  begin(): void {
    this.index = 0
    this.state = 'look'
    this.resetStep()
    this.onStep?.(0, this.steps[0])
  }

  get step(): FlowStep | null {
    return this.index >= 0 && this.index < this.steps.length ? this.steps[this.index] : null
  }

  /** 0..1 of the current hold */
  get progress(): number {
    const s = this.step
    return s ? Math.min(1, this.held / s.holdMs) : this.state === 'done' ? 1 : 0
  }

  /** MUSCLES order, against the person's own rest as soon as it is known (typical ranges before that); empty without a face */
  get muscles(): number[] {
    return this.now
  }

  /** AirPods motion has been arriving */
  get hasAirpods(): boolean {
    return this.airpods
  }

  private resetStep(): void {
    this.held = 0
    this.inStep = 0
    this.paused = 0
    this.forced = false
    this.score = 0
    this.peak.fill(0)
  }

  face(f: FaceFrame, names: readonly string[]): void {
    // a slow phone delivers frames further apart: they still count for their full time, up to a fifth of a second
    const dt = this.lastT ? Math.max(0, Math.min(200, f.t - this.lastT)) : 33
    this.lastT = f.t
    const x = this.observer.observe(f, names)
    if (!x) {
      this.now = []
      if (this.state === 'wait' || this.state === 'hold') this.state = 'look'
      return
    }
    this.now = this.reader.face(f, names as string[]).muscles
    const step = this.step
    if (!step || this.state === 'idle' || this.state === 'done') return
    if (step.lap === 0) {
      // the first take of a face: its own range is not known yet, so the groups it is for are drawn against the
      // biggest seen in this step. A small smile lights up fully at its own biggest, as it will once the model exists.
      for (const m of DRIVEN[TUNE_FACES.indexOf(step.face)]) {
        const v = this.now[m]
        if (v > this.peak[m]) this.peak[m] = v
        this.now[m] = Math.min(1, v / Math.max(this.peak[m], PEAK_FLOOR))
      }
    }
    this.rec.smile.t.push(f.t)
    this.rec.smile.v.push(smileOf(x))
    if (this.state === 'look') this.state = this.held > 0 ? 'hold' : 'wait'
    this.inStep += dt

    const fi = TUNE_FACES.indexOf(step.face)
    let s: number
    if (!this.rest || this.rest.length !== x.length) s = 3 // the first rest: nothing to compare with yet
    else if (x.length < ND && fi === 2) s = this.inStep > 1200 ? 3 : 0 // the basic fields cannot see this face: go by time
    else s = poseScore(fi, x, this.rest)
    this.score += (Math.max(-1, Math.min(3, s)) - this.score) * 0.5

    if (this.state === 'wait') {
      if (this.inStep >= REACT_MS && this.score >= 1) this.state = 'hold'
      else if (this.inStep >= WAIT_MAX_MS) {
        this.state = 'hold'
        this.forced = true
        this.late[this.index] = true
      }
    }
    if (this.state !== 'hold') return
    if (this.forced || this.score >= 0.55) {
      this.held += dt
      this.paused = 0
      this.rec.samples.push({ t: f.t, x: Float32Array.from(x), face: fi, lap: step.lap })
    } else {
      this.paused += dt
      if (this.paused > PAUSE_MAX_MS) this.forced = true
    }
    if (this.held >= step.holdMs) this.next()
  }

  head(h: HeadFrame): void {
    if (h.source !== 'airpods' || this.state === 'idle' || this.state === 'done') return
    this.airpods = true
    if (this.rec.head.length < MAX_HEAD) this.rec.head.push(h)
  }

  private next(): void {
    const samples = this.rec.samples
    if (!this.rest) {
      const d = samples[samples.length - 1].x.length
      const own = samples.filter((s) => s.x.length === d)
      this.rest = new Float32Array(d)
      for (let j = 0; j < d; j++) this.rest[j] = quantile(own.map((s) => s.x[j]), 0.5)
    }
    // from here on the muscles are drawn against this person's own rest, and against each range as soon as it is known
    this.reader = createReader(provisionalModel(samples, this.observer.aspect.k || undefined), { calibrated: false })
    this.index++
    this.resetStep()
    if (this.index >= this.steps.length) {
      this.state = 'done'
      this.onEnd?.()
      return
    }
    this.state = 'wait'
    this.onStep?.(this.index, this.steps[this.index])
  }

  train(): PersonalModel {
    this.rec.k = this.observer.aspect.k || undefined
    return trainModel(this.rec)
  }
}
