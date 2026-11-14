// The stage's live state: everything that arrives over the room socket, kept outside React so painters can read it
// 60 times a second. React sees only the slow things (mode, phase, echo, tune step) through `useStage`.
import { useEffect, useRef, useState } from 'react'
import { PING_PHASES } from '@shared/types'
import type { Echo, HeartSource, LiveFrame, LiveMessage, MoveSource, PhaseKey, StepReading, TuneFace } from '@shared/types'
import type { EarEvent, EarModel2 } from '@shared/ear'
import { api, apiUrl, wsUrl } from '../../shared/api'
import { isMock } from '../data'
import { createShow, synthSwitch, TUNE_POSE } from '../dev/synth'
import type { PingPlayer } from '../dev/synth'
import { MESH_LEN, poseFace } from './canon'
import { onFrame } from './loop'

export type Phase = PhaseKey | 'idle' | 'dose'
/** what the screen is showing: one thing at a time */
export type Mode = 'attract' | 'ready' | 'tune' | 'teach' | 'search' | 'ping' | 'reading' | 'dose' | 'again' | 'echo'
export type Conn = 'connecting' | 'open' | 'closed' | 'simulated'

const FULL_MS = Object.fromEntries(PING_PHASES.map((p) => [p.key, p.ms])) as Record<PhaseKey, number>
const MINI_MS: Partial<Record<PhaseKey, number>> = { laugh: 8000, breathe: 10000 }
const ORDER: PhaseKey[] = PING_PHASES.map((p) => p.key)
const isPing = (p: Phase): p is PhaseKey => p !== 'idle' && p !== 'dose'
/** the laughter starts this long after the laugh phase does (CONTRACT.md) */
export const LAUGH_ONSET_MS = 1000
const KEEP_MS = 80_000
const NM = 8

export interface Sample {
  /** performance.now() clock, placed by the sender's own timestamps so traces do not jitter with the network */
  at: number
  phase: Phase
  smile: number
  cheek: number
  /** degrees from this person's resting pose */
  pitch: number
  yaw: number
  roll: number
  bpm: number | null
  wave: number
  /** voice level, linear 0..1 */
  level: number
  f0: number | null
  ear: number | null
  mus: number[] | null
}

export interface RunPhase {
  key: PhaseKey
  at: number
  end: number | null
  ms: number
  /** false when the mirror opened in the middle of this phase: its start is a guess */
  known: boolean
}

/** what the mirror itself reads off the stream while the ping runs. The echo proper comes from the server. */
export interface Measures {
  restSmile: number | null
  restBpm: number | null
  nodDeg: number | null
  nodVel: number | null
  /** when the nod was fastest, for the marker on the trace */
  nodAt: number | null
  /** ms from the start of the laughter to the smile; null while there is none */
  smileMs: number | null
  smileAt: number | null
  smilePeak: number | null
  smileAuc: number | null
  earAuc: number | null
  pitchSd: number | null
  speech: number | null
  swing: number | null
  bpmLo: number | null
  bpmHi: number | null
  bpmLoAt: number | null
  bpmHiAt: number | null
}
const noMeasures = (): Measures => ({
  restSmile: null,
  restBpm: null,
  nodDeg: null,
  nodVel: null,
  nodAt: null,
  smileMs: null,
  smileAt: null,
  smilePeak: null,
  smileAuc: null,
  earAuc: null,
  pitchSd: null,
  speech: null,
  swing: null,
  bpmLo: null,
  bpmHi: null,
  bpmLoAt: null,
  bpmHiAt: null,
})

/** one phase's signal, kept after the live buffer has moved on: ms from the phase start, and the value */
export interface Trace {
  t: number[]
  v: number[]
}

export interface Run {
  kind: 'full' | 'mini'
  cold: boolean
  phases: RunPhase[]
  endedAt: number | null
  m: Measures
  /** finished readings supplied by the phone for this run; never inferred from the stream */
  readings: Partial<Record<PhaseKey, StepReading>>
  /** the smile through the laughter and the heart rate through the breath, for the before / after */
  tr: { laugh?: Trace; breathe?: Trace }
}

export interface Shot {
  /** frozen wireframe, x1000 like LiveMesh; null = the phone sent no mesh for this face */
  mesh: Float32Array
  mus: number[]
  score: number
  /** true when this is the person's own face, false when it is the standard face posed by the numbers */
  own: boolean
}

export interface Smooth {
  pitch: number
  yaw: number
  roll: number
  smile: number
  cheek: number
  ear: number
  level: number
  mus: Float32Array
}

/** slow state, for React */
export interface View {
  mode: Mode
  phase: Phase
  name: string
  conn: Conn
  present: boolean
  echo: Echo | null
  /** the full ping's echo, when `echo` is the one measured after a dose */
  before: Echo | null
  /** the full ping's echo, kept through the dose and the measure again */
  first: Echo | null
  runKind: 'full' | 'mini' | null
  cold: boolean
  /** phases of the current run that have ended, as a string key so React re-renders when one does */
  done: string
  tuneStep: TuneFace | 'training' | 'done' | null
  tuneAccuracy: number | null
  tuneShots: string
  headSource: MoveSource | null
  heartSource: HeartSource | null
  ownMesh: boolean
  ownMuscles: boolean
  hasEar: boolean
  faceRead: TuneFace | null
  doseSeen: boolean
  /** frames are arriving right now */
  streaming: boolean
  phoneReadings: Partial<Record<PhaseKey, StepReading>>
  camera: boolean | null
  earOn: EarTaught[]
  ear: Partial<Record<EarTaught, number>>
  rate: number | null
  earCounts: Partial<Record<EarTaught, number>>
  teach: { state: 'step' | 'training' | 'done'; ask: string | null; say: string | null; index: number; of: number; model: EarModel2 | null } | null
}

/** what the AirPods are taught to read: the teaching minute asks for nothing else */
export const EAR_TAUGHT = ['smile', 'nod', 'shake'] as const satisfies readonly EarEvent[]
export type EarTaught = (typeof EAR_TAUGHT)[number]
const isTaught = (v: unknown): v is EarTaught => (EAR_TAUGHT as readonly unknown[]).includes(v)

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const median = (a: number[]) => {
  if (!a.length) return 0
  const s = a.slice().sort((x, y) => x - y)
  return s[s.length >> 1]
}
/** the phone sends voice level in dBFS (negative), the simulator a linear 0..1 */
const linear = (rms: number) => (rms === 0 ? 0 : rms < 0 ? Math.pow(10, rms / 20) : rms)

type Wrapped = { room: string; name?: string; msg: LiveMessage }

export class Stage {
  frames: Sample[] = []
  last: Sample | null = null
  phase: Phase = 'idle'
  phaseStart = 0
  run: Run | null = null
  /** the full ping before the current re-measure, for the before / after */
  firstRun: Run | null = null
  doseStart = 0
  doseEnd = 0
  doseSeen = false
  echo: Echo | null = null
  echoAt = 0
  before: Echo | null = null
  private fullEcho: Echo | null = null
  name = ''
  conn: Conn = 'connecting'
  present = false
  lastFrameAt = 0
  lastMeshAt = 0
  lastMsgAt = 0
  headSource: MoveSource | null = null
  heartSource: HeartSource | null = null
  ownMuscles = false
  hasEar = false
  faceRead: { label: TuneFace; p: number } | null = null
  frameMs = 66
  /** finished values sent by the phone; estimates are replaced as soon as these arrive */
  phoneReadings: Partial<Record<PhaseKey, StepReading>> = {}
  camera: boolean | null = null
  earOn: EarTaught[] = []
  ear: Partial<Record<EarTaught, number>> = {}
  rate: number | null = null
  earCounts: Partial<Record<EarTaught, number>> = {}
  private lastEarOn: EarTaught[] = []
  teach: View['teach'] = null
  teachAt = 0

  tune: {
    step: TuneFace | 'training' | 'done' | null
    at: number
    stepAt: number
    accuracy: number | null
    shots: Partial<Record<TuneFace, Shot>>
    cand: Shot | null
  } = { step: null, at: 0, stepAt: 0, accuracy: null, shots: {}, cand: null }

  /** values eased towards the stream, updated once per animation frame */
  sm: Smooth = { pitch: 0, yaw: 0, roll: 0, smile: 0, cheek: 0, ear: 0, level: 0, mus: new Float32Array(NM) }

  // mesh interpolation: the last two frames, played back one interval late
  private ma = new Float32Array(MESH_LEN)
  private mb = new Float32Array(MESH_LEN)
  private mOut = new Float32Array(MESH_LEN)
  private mSynth = new Float32Array(MESH_LEN)
  private mta = 0
  private mtb = 0
  private mCount = 0
  meshMs = 100

  private base = { set: false, p: 0, y: 0, r: 0, at: 0 }
  private clockOff: number | null = null
  private follow: string | null = null
  private lastMeasure = 0
  private listeners = new Set<() => void>()
  /** messages per second by type, for ?debug=1 */
  rates: Record<string, number> = {}
  private counts: Record<string, number> = {}
  private countsAt = 0
  bytes = 0
  private byteCount = 0

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private changed() {
    for (const f of this.listeners) f()
  }
  /** something slow changed from outside (connection state, the room list) */
  touch() {
    this.changed()
  }

  reset() {
    this.frames = []
    this.last = null
    this.phase = 'idle'
    this.phaseStart = 0
    this.run = null
    this.firstRun = null
    this.doseSeen = false
    this.echo = null
    this.before = null
    this.fullEcho = null
    this.name = ''
    this.present = false
    this.lastFrameAt = 0
    this.lastMeshAt = 0
    this.mCount = 0
    this.base.set = false
    this.clockOff = null
    this.follow = null
    this.headSource = null
    this.heartSource = null
    this.ownMuscles = false
    this.hasEar = false
    this.faceRead = null
    this.phoneReadings = {}
    this.camera = null
    this.earOn = []
    this.ear = {}
    this.rate = null
    this.earCounts = {}
    this.lastEarOn = []
    this.teach = null
    this.teachAt = 0
    this.tune = { step: null, at: 0, stepAt: 0, accuracy: null, shots: {}, cand: null }
    this.changed()
  }

  // ------------------------------------------------------------------ messages in

  /** `now` can be given to replay a recorded stretch (the simulator's fast-forward) */
  ingest(input: LiveMessage | Wrapped, now = performance.now(), size = 0): void {
    if (!input || typeof input !== 'object') return
    let m: LiveMessage
    if ('msg' in input) {
      // room `*` gets every room: follow the one that started something most recently
      m = input.msg
      if (!m || typeof m !== 'object') return
      const starts = m.type === 'hello' || m.type === 'tune' || (m.type === 'phase' && m.phase !== 'idle')
      if (this.follow === null || (this.follow !== input.room && starts && now - this.lastFrameAt > 1500)) {
        this.follow = input.room
        if (input.name) this.name = input.name
        this.changed()
      }
      if (input.room !== this.follow) return
    } else m = input
    this.lastMsgAt = now
    this.counts[m.type] = (this.counts[m.type] ?? 0) + 1
    this.byteCount += size
    switch (m.type) {
      case 'hello':
        if (m.role === 'sensor') {
          this.present = true
          if (m.name) this.name = m.name
          this.changed()
        }
        break
      case 'phase':
        this.go(m.phase, now, true)
        break
      case 'frame':
        this.onFrameMsg(m, now)
        break
      case 'teach':
        this.teach = {
          state: m.state,
          ask: m.ask ?? null,
          say: m.say ?? null,
          index: typeof m.index === 'number' ? m.index : 0,
          of: typeof m.of === 'number' ? m.of : 0,
          model: m.model ?? null,
        }
        this.teachAt = now
        this.present = true
        this.changed()
        break
      case 'reading':
        this.phoneReadings = { ...this.phoneReadings, ...m.readings }
        if (this.run) this.run.readings = { ...this.run.readings, ...m.readings }
        this.changed()
        break
      case 'mesh':
        this.onMesh(m.pts, now)
        break
      case 'tune':
        this.onTune(m, now)
        break
      case 'echo':
        if (m.echo && Array.isArray(m.echo.components)) {
          const after = this.run?.kind === 'mini' && this.fullEcho
          this.before = after ? this.fullEcho : null
          if (!after) this.fullEcho = m.echo
          this.echo = m.echo
          this.echoAt = now
          this.changed()
        }
        break
    }
  }

  /** `exact`: the phone announced the boundary. Otherwise it is read off a frame: the mirror opened mid-phase. */
  private go(p: Phase, now: number, exact: boolean) {
    if (p !== 'idle' && p !== 'dose' && !ORDER.includes(p)) return
    if (p === this.phase) return
    const cold = !exact
    const prev = this.phase
    this.phase = p
    this.phaseStart = now
    if (prev === 'dose') this.doseEnd = now
    let run = this.run
    if (isPing(p)) {
      this.tune.step = null
      const lastKey = run && run.endedAt === null && run.phases.length ? run.phases[run.phases.length - 1].key : null
      if (!run || lastKey === null || ORDER.indexOf(p) <= ORDER.indexOf(lastKey)) {
        if (run) this.closeRun(run, now)
        const kind: Run['kind'] = p === 'laugh' && !cold ? 'mini' : 'full'
        if (kind === 'mini') {
          if (run?.kind === 'full') this.firstRun = run
        } else {
          this.firstRun = null
          this.fullEcho = null
          this.doseSeen = false
          this.phoneReadings = {}
        }
        run = { kind, cold, phases: [], endedAt: null, m: noMeasures(), tr: {}, readings: {} }
        this.run = run
        this.echo = null
        this.before = null
      } else {
        const lp = run.phases[run.phases.length - 1]
        lp.end = now
        // the mirror opened during the laugh of a re-measure: only now can it tell
        if (run.kind === 'full' && run.cold && run.phases.length === 1 && lp.key === 'laugh' && p === 'breathe') {
          run.kind = 'mini'
          lp.ms = MINI_MS.laugh ?? lp.ms
        }
        this.measure(run, now, true)
      }
      run.phases.push({ key: p, at: now, end: null, ms: (run.kind === 'mini' ? MINI_MS[p] : undefined) ?? FULL_MS[p], known: exact })
    } else {
      if (run && run.endedAt === null) this.closeRun(run, now)
      if (p === 'dose') {
        this.doseStart = now
        this.doseEnd = now
        this.doseSeen = true
        this.echo = null
        this.tune.step = null
      }
    }
    this.changed()
  }

  private closeRun(run: Run, now: number) {
    if (run.endedAt !== null) return
    const lp = run.phases[run.phases.length - 1]
    if (lp && lp.end === null) lp.end = now
    this.measure(run, now, true)
    run.endedAt = now
  }

  private onFrameMsg(f: LiveFrame, now: number) {
    this.go(f.phase, now, false)
    // place the sample on the sender's clock, so a burst of late packets does not bunch up on the trace
    let at = now
    const t = num(f.t, NaN)
    if (Number.isFinite(t)) {
      const raw = now - t
      if (this.clockOff === null || Math.abs(raw - this.clockOff) > 800) this.clockOff = raw
      else if (raw < this.clockOff) this.clockOff = raw
      else this.clockOff += (raw - this.clockOff) * 0.02
      at = Math.min(now, t + this.clockOff)
    }
    const prev = this.last
    if (prev && at <= prev.at) at = prev.at + 1
    const pitch = num(f.pitch)
    const yaw = num(f.yaw)
    const roll = num(f.roll)
    const b = this.base
    if (!b.set || at - b.at > 6000) {
      b.set = true
      b.p = pitch
      b.y = yaw
      b.r = roll
    } else {
      const dt = (at - b.at) / 1000
      b.p += wrap(pitch - b.p) * (1 - Math.exp(-dt / 14))
      b.y += wrap(yaw - b.y) * (1 - Math.exp(-dt / 25))
      b.r += wrap(roll - b.r) * (1 - Math.exp(-dt / 14))
    }
    b.at = at
    const mus = Array.isArray(f.muscles) && f.muscles.length >= NM ? f.muscles : null
    const ear = typeof f.earSmile === 'number' && Number.isFinite(f.earSmile) ? clamp(f.earSmile, 0, 1) : null
    const s: Sample = {
      at,
      phase: this.phase,
      smile: clamp(num(f.smile), 0, 1.5),
      cheek: clamp(num(f.cheek), 0, 1.5),
      pitch: wrap(pitch - b.p),
      yaw: wrap(yaw - b.y),
      roll: wrap(roll - b.r),
      bpm: typeof f.bpm === 'number' && f.bpm > 25 && f.bpm < 230 ? f.bpm : null,
      wave: num(f.wave),
      level: clamp(linear(num(f.rms, -90)), 0, 1),
      f0: typeof f.f0 === 'number' && f.f0 > 40 ? f.f0 : null,
      ear,
      mus,
    }
    if (prev) this.frameMs += (clamp(at - prev.at, 15, 400) - this.frameMs) * 0.1
    this.frames.push(s)
    this.last = s
    const cut = at - KEEP_MS
    if (this.frames.length > 64 && this.frames[0].at < cut) {
      let i = 0
      while (i < this.frames.length && this.frames[i].at < cut) i++
      this.frames.splice(0, i)
    }
    this.lastFrameAt = now
    this.present = true
    const hs = f.headSource === 'airpods' || f.headSource === 'camera' ? f.headSource : null
    const ps = f.heartSource === 'airpods' || f.heartSource === 'camera' || f.heartSource === 'none' ? f.heartSource : null
    const read = f.face && typeof f.face.label === 'string' ? f.face : null
    const camera = f.camera === false ? false : true
    const earOn = Array.isArray(f.earOn) ? f.earOn.filter(isTaught) : []
    const earMap: Partial<Record<EarTaught, number>> = {}
    if (f.ear && typeof f.ear === 'object') {
      for (const key of EAR_TAUGHT) {
        const value = f.ear[key]
        if (typeof value === 'number' && Number.isFinite(value)) earMap[key] = clamp(value, 0, 1)
      }
    }
    const cameraChanged = camera !== this.camera
    this.camera = camera
    this.earOn = earOn
    for (const event of earOn) if (!this.lastEarOn.includes(event)) this.earCounts[event] = (this.earCounts[event] ?? 0) + 1
    this.lastEarOn = earOn
    this.ear = earMap
    this.rate = typeof f.rate === 'number' && Number.isFinite(f.rate) ? f.rate : null
    if (hs !== this.headSource || ps !== this.heartSource || !!mus !== this.ownMuscles || (ear !== null) !== this.hasEar || (read?.label ?? null) !== (this.faceRead?.label ?? null) || cameraChanged) {
      this.headSource = hs
      this.heartSource = ps
      this.ownMuscles = !!mus
      this.hasEar = ear !== null
      this.faceRead = read
      this.changed()
    } else this.faceRead = read
    const run = this.run
    if (run && run.endedAt === null && now - this.lastMeasure > 160) {
      this.lastMeasure = now
      this.measure(run, now, false)
    }
    // a face being held for the tune step, when the phone sends no mesh: keep the frame with the muscles at their best
    if (this.tune.step && this.tune.step !== 'training' && this.tune.step !== 'done' && now - this.lastMeshAt > 1500 && mus) this.candidate(this.tune.step, null, mus, now)
  }

  private onMesh(pts: unknown, now: number) {
    if (!Array.isArray(pts) || pts.length < 468 * 3) return
    const a = this.ma
    this.ma = this.mb
    this.mb = a
    const n = Math.min(MESH_LEN, pts.length)
    for (let i = 0; i < n; i++) a[i] = num(pts[i])
    if (n < MESH_LEN) {
      // 468 points, no irises: park them at the eye centres
      for (let i = 468; i < 478; i++) {
        const e = i < 473 ? [33, 133] : [362, 263]
        for (let c = 0; c < 3; c++) a[i * 3 + c] = (a[e[0] * 3 + c] + a[e[1] * 3 + c]) / 2
      }
    }
    if (this.mCount && now - this.mtb < 600) this.meshMs += (clamp(now - this.mtb, 20, 400) - this.meshMs) * 0.15
    this.mta = this.mCount && now - this.mtb < 600 ? this.mtb : now - this.meshMs
    if (!this.mCount || now - this.mtb >= 600) this.ma.set(a)
    this.mtb = now
    this.mCount++
    const first = now - this.lastMeshAt > 2500
    this.lastMeshAt = now
    this.present = true
    if (first) this.changed()
    const st = this.tune.step
    if (st && st !== 'training' && st !== 'done') this.candidate(st, a, this.last && now - this.lastFrameAt < 600 ? this.last.mus : null, now)
  }

  /** the face to draw right now: the person's own mesh between its last two frames, or null when none is arriving */
  ownMesh(now: number): Float32Array | null {
    if (!this.mCount || now - this.mtb > 2500) return null
    const span = this.mtb - this.mta
    const u = span > 1 ? clamp((now - this.meshMs - this.mta) / span, 0, 1) : 1
    const a = this.ma
    const b = this.mb
    const o = this.mOut
    for (let i = 0; i < MESH_LEN; i++) o[i] = a[i] + (b[i] - a[i]) * u
    return o
  }

  /** the standard face, turned and bent by the numbers that did arrive (an older phone build sends no mesh) */
  posedMesh(): Float32Array {
    const s = this.sm
    return poseFace(this.mSynth, { pitch: clamp(s.pitch, -40, 40), yaw: clamp(s.yaw, -50, 50), roll: clamp(s.roll, -35, 35) }, s.mus, { size: 0.5, aspect: 0.75, scale: 1000 })
  }

  private onTune(m: Extract<LiveMessage, { type: 'tune' }>, now: number) {
    const t = this.tune
    const step = m.step
    if (step !== 'training' && step !== 'done' && !(step in TUNE_POSE)) return
    if (isPing(this.phase) && now - this.lastFrameAt < 3000) return // a ping is running: it wins
    // a fresh start clears the row
    if (step === 'rest' && (t.step === null || t.step === 'done' || now - t.at > 30000)) t.shots = {}
    if (step !== t.step) {
      this.commitShot(now)
      t.step = step
      t.stepAt = now
      t.cand = null
    }
    t.at = now
    if (step === 'done') {
      t.accuracy = typeof m.accuracy === 'number' && Number.isFinite(m.accuracy) ? clamp(m.accuracy, 0, 1) : null
    }
    this.present = true
    this.changed()
  }

  private candidate(face: TuneFace, mesh: Float32Array | null, mus: number[] | null, now: number) {
    const t = this.tune
    const el = now - t.stepAt
    let score: number
    if (mus) score = face === 'rest' ? 1 - Math.max(mus[0], mus[2], mus[3], mus[4], mus[5]) - Math.abs(el - 1600) / 20000 : mus[face === 'smile' ? 0 : face === 'sad' ? 4 : face === 'angry' ? 2 : 3]
    else if (mesh) score = shapeScore(face, mesh, el)
    else return
    if (el < 350) return // still the previous face
    const best = t.cand ?? t.shots[face] ?? null
    if (best && best.score >= score) return
    const own = !!mesh
    const copy = own ? Float32Array.from(mesh!) : poseFace(new Float32Array(MESH_LEN), { pitch: 0, yaw: 0, roll: 0 }, mus, { size: 0.5, aspect: 0.75, scale: 1000 })
    t.cand = { mesh: copy, mus: mus ? mus.slice(0, NM) : TUNE_POSE[face].slice(), score, own }
  }

  private commitShot(now: number) {
    const t = this.tune
    const face = t.step
    if (!face || face === 'training' || face === 'done') return
    if (now - t.stepAt < 500 && !t.cand) return
    const shot = t.cand ?? t.shots[face] ?? { mesh: poseFace(new Float32Array(MESH_LEN), { pitch: 0, yaw: 0, roll: 0 }, TUNE_POSE[face], { size: 0.5, aspect: 0.75, scale: 1000 }), mus: TUNE_POSE[face].slice(), score: -1, own: false }
    t.shots[face] = shot
    t.cand = null
  }

  // ------------------------------------------------------------------ what the mirror reads off the stream

  phaseOf(run: Run | null, key: PhaseKey): RunPhase | null {
    return run?.phases.find((p) => p.key === key) ?? null
  }

  /** samples inside one phase of a run */
  slice(ph: RunPhase | null, until = Infinity): Sample[] {
    if (!ph) return []
    const end = Math.min(ph.end ?? Infinity, until)
    const fr = this.frames
    // frames are in time order: find the start from the back, phases are near the end of the buffer
    let i = fr.length
    while (i > 0 && fr[i - 1].at >= ph.at) i--
    let j = i
    while (j < fr.length && fr[j].at <= end) j++
    return fr.slice(i, j)
  }

  /** samples with t0 <= at <= t1 */
  between(t0: number, t1: number): Sample[] {
    const fr = this.frames
    let j = fr.length
    while (j > 0 && fr[j - 1].at > t1) j--
    let i = j
    while (i > 0 && fr[i - 1].at >= t0) i--
    return fr.slice(i, j)
  }

  private measure(run: Run, _now: number, final: boolean) {
    const m = run.m
    const cur = run.phases[run.phases.length - 1]
    if (!cur) return
    const list = final ? run.phases : [cur]
    for (const ph of list) {
      const xs = this.slice(ph)
      if (xs.length < 3) continue
      if (ph.key === 'settle') {
        m.restSmile = median(xs.map((s) => s.smile))
        const bp = xs.map((s) => s.bpm).filter((v): v is number => v !== null)
        m.restBpm = bp.length >= 3 ? median(bp) : null
      } else if (ph.key === 'nod') {
        // three-point smoothing, then a central difference: the nod's size and its fastest moment
        const p = xs.map((s, i) => (xs[Math.max(0, i - 1)].pitch + s.pitch + xs[Math.min(xs.length - 1, i + 1)].pitch) / 3)
        let lo = Infinity
        let hi = -Infinity
        let vel = 0
        let velAt = 0
        for (let i = 0; i < p.length; i++) {
          lo = Math.min(lo, p[i])
          hi = Math.max(hi, p[i])
          if (i > 0 && i < p.length - 1) {
            const dt = (xs[i + 1].at - xs[i - 1].at) / 1000
            if (dt > 0.04) {
              const v = Math.abs(p[i + 1] - p[i - 1]) / dt
              if (v > vel) {
                vel = v
                velAt = xs[i].at
              }
            }
          }
        }
        m.nodDeg = hi - lo
        m.nodVel = vel
        m.nodAt = velAt || null
      } else if (ph.key === 'laugh') {
        const base = m.restSmile ?? median(xs.slice(0, Math.max(3, Math.round(700 / this.frameMs))).map((s) => s.smile))
        if (m.restSmile === null) m.restSmile = base
        const onset = ph.at + LAUGH_ONSET_MS
        let auc = 0
        let earAuc = 0
        let peak = 0
        let at: number | null = null
        let anyEar = false
        for (let i = 1; i < xs.length; i++) {
          const dt = Math.min(0.4, (xs[i].at - xs[i - 1].at) / 1000)
          const v = Math.max(0, xs[i].smile - base)
          auc += v * dt
          peak = Math.max(peak, v)
          if (xs[i].ear !== null) {
            anyEar = true
            earAuc += Math.max(0, (xs[i].ear as number) - 0.08) * dt
          }
          if (at === null && xs[i].at >= onset && v > 0.15) at = xs[i].at
        }
        m.smileAuc = auc
        m.smilePeak = peak
        // a laugh the mirror joined half way has no known start: the delay cannot be read
        m.smileAt = ph.known ? at : null
        m.smileMs = at === null || !ph.known ? null : Math.max(0, at - onset)
        m.earAuc = anyEar ? earAuc : null
        if (final) {
          // a frame of the next phase can land on the boundary: keep it out of the kept trace
          const own = xs.filter((q) => q.at < (ph.end ?? Infinity) - 120)
          run.tr.laugh = { t: own.map((q) => q.at - ph.at), v: own.map((q) => q.smile) }
        }
      } else if (ph.key === 'speak') {
        const f = xs.map((s) => s.f0).filter((v): v is number => v !== null)
        m.speech = f.length / xs.length
        if (f.length >= 8) {
          const med = Math.log2(median(f))
          const st = f.map((v) => 12 * (Math.log2(v) - med)).filter((v) => Math.abs(v) < 14)
          const mean = st.reduce((a, c) => a + c, 0) / st.length
          m.pitchSd = Math.sqrt(st.reduce((a, c) => a + (c - mean) * (c - mean), 0) / st.length)
        }
      } else if (ph.key === 'breathe') {
        let lo = Infinity
        let hi = -Infinity
        let loAt = 0
        let hiAt = 0
        let n = 0
        for (let i = 1; i < xs.length - 1; i++) {
          const a = xs[i - 1].bpm
          const b = xs[i].bpm
          const c = xs[i + 1].bpm
          if (a === null || b === null || c === null || xs[i].at < ph.at + 1200) continue
          const v = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)) // median of three
          n++
          if (v < lo) {
            lo = v
            loAt = xs[i].at
          }
          if (v > hi) {
            hi = v
            hiAt = xs[i].at
          }
        }
        if (final) {
          const ok = xs.filter((q) => q.bpm !== null && q.at < (ph.end ?? Infinity) - 120)
          run.tr.breathe = { t: ok.map((q) => q.at - ph.at), v: ok.map((q) => q.bpm as number) }
        }
        if (n >= 8) {
          m.bpmLo = lo
          m.bpmHi = hi
          m.bpmLoAt = loAt
          m.bpmHiAt = hiAt
          m.swing = hi - lo
        }
      }
    }
  }

  // ------------------------------------------------------------------ once per animation frame

  frame(now: number, dt: number) {
    const s = this.sm
    const fr = this.frames
    const n = fr.length
    const fresh = now - this.lastFrameAt < 2500
    const k = 1 - Math.exp(-dt / 45)
    if (fresh && n) {
      // between the last two samples, one frame interval behind: smooth at any frame rate
      const b = fr[n - 1]
      const a = n > 1 ? fr[n - 2] : b
      const span = b.at - a.at
      const u = span > 1 ? clamp((now - this.frameMs - a.at) / span, 0, 1) : 1
      const mix = (x: number, y: number) => x + (y - x) * u
      s.pitch += (mix(a.pitch, b.pitch) - s.pitch) * k
      s.yaw += (mix(a.yaw, b.yaw) - s.yaw) * k
      s.roll += (mix(a.roll, b.roll) - s.roll) * k
      s.smile += (mix(a.smile, b.smile) - s.smile) * k
      s.cheek += (mix(a.cheek, b.cheek) - s.cheek) * k
      s.level += (mix(a.level, b.level) - s.level) * k
      s.ear += (mix(a.ear ?? 0, b.ear ?? 0) - s.ear) * k
      for (let i = 0; i < NM; i++) {
        const va = a.mus ? num(a.mus[i]) : i === 0 ? a.smile : i === 1 ? a.cheek : 0
        const vb = b.mus ? num(b.mus[i]) : i === 0 ? b.smile : i === 1 ? b.cheek : 0
        s.mus[i] += (clamp(mix(va, vb), 0, 1.2) - s.mus[i]) * k
      }
    } else {
      const slow = 1 - Math.exp(-dt / 320)
      s.pitch += (0 - s.pitch) * slow
      s.yaw += (0 - s.yaw) * slow
      s.roll += (0 - s.roll) * slow
      s.level += (0 - s.level) * slow
      s.smile += (0 - s.smile) * slow
      s.cheek += (0 - s.cheek) * slow
      s.ear += (0 - s.ear) * slow
      const t = this.tune
      const tuning = t.step !== null && now - t.at < 45000
      const asked = tuning && t.step && t.step !== 'training' && t.step !== 'done' ? TUNE_POSE[t.step] : null
      for (let i = 0; i < NM; i++) {
        let want = 0
        if (asked) want = asked[i]
        else if (!tuning && !this.present) {
          // nobody here: the model face works through its muscle groups, one slow breath each
          const cycle = 5200
          const which = Math.floor(now / cycle) % 5
          const ph = (now % cycle) / cycle
          const bump = Math.pow(Math.sin(Math.PI * clamp((ph - 0.12) / 0.76, 0, 1)), 2)
          const demo = [TUNE_POSE.smile, TUNE_POSE.surprised, TUNE_POSE.smile, TUNE_POSE.angry, TUNE_POSE.sad][which]
          want = demo[i] * bump * 0.8
        }
        s.mus[i] += (want - s.mus[i]) * slow
      }
    }
    if (now - this.countsAt > 1000) {
      const span = (now - this.countsAt) / 1000
      const r: Record<string, number> = {}
      for (const key of Object.keys(this.counts)) r[key] = this.counts[key] / span
      this.rates = this.countsAt ? r : {}
      this.bytes = this.countsAt ? this.byteCount / span : 0
      this.counts = {}
      this.byteCount = 0
      this.countsAt = now
    }
  }

  // ------------------------------------------------------------------ slow state

  mode(now: number): Mode {
    const held = now - this.lastFrameAt < 12000 && this.lastFrameAt > 0
    const t = this.tune
    if (this.teach && now - this.teachAt < 90_000 && (this.teach.state === 'step' || this.teach.state === 'training' || (this.teach.state === 'done' && this.camera !== false))) return 'teach'
    if (t.step && now - t.at < (t.step === 'done' ? 45000 : 30000)) return 'tune'
    if (isPing(this.phase) && held) return 'ping'
    if (this.phase === 'dose' && (held || now - this.phaseStart < 8000)) return 'dose'
    if (this.echo && now - this.echoAt < 240000) return 'echo'
    const run = this.run
    if (run && run.endedAt !== null && run.phases.length) {
      const since = now - run.endedAt
      if (run.kind === 'mini' && since < 75000) return 'again'
      if (run.kind === 'full' && since < 12000) return 'reading'
    }
    return this.present ? 'ready' : 'attract'
  }

  view(now: number): View {
    const run = this.run
    const t = this.tune
    return {
      mode: this.mode(now),
      phase: this.phase,
      name: this.name,
      conn: this.conn,
      present: this.present,
      echo: this.echo,
      before: this.before,
      first: this.fullEcho,
      runKind: run ? run.kind : null,
      cold: !!run?.cold,
      done: run ? run.phases.map((p) => `${p.key}${p.end === null ? '' : '.'}`).join(' ') + (run.endedAt === null ? '' : ' end') : '',
      tuneStep: t.step,
      tuneAccuracy: t.accuracy,
      tuneShots: Object.keys(t.shots).join(' '),
      headSource: this.headSource,
      heartSource: this.heartSource,
      ownMesh: this.mCount > 0 && now - this.lastMeshAt < 2500,
      ownMuscles: this.ownMuscles,
      hasEar: this.hasEar,
      faceRead: this.faceRead?.label ?? null,
      doseSeen: this.doseSeen,
      streaming: this.lastFrameAt > 0 && now - this.lastFrameAt < 2500,
      phoneReadings: this.phoneReadings,
      camera: this.camera,
      earOn: this.earOn,
      ear: this.ear,
      rate: this.rate,
      earCounts: this.earCounts,
      teach: this.teach,
    }
  }
}

/** how much a mesh looks like the asked face, from its own geometry (used when the phone sends no muscle values) */
function shapeScore(face: TuneFace, m: Float32Array, elapsed: number): number {
  const x = (i: number) => m[i * 3]
  const y = (i: number) => m[i * 3 + 1]
  const fw = Math.abs(x(454) - x(234)) || 1
  const fh = Math.abs(y(152) - y(10)) || 1
  const browGap = (y(159) - y(105) + (y(386) - y(334))) / 2 / fh
  if (face === 'smile') return Math.abs(x(291) - x(61)) / fw
  if (face === 'surprised') return browGap
  if (face === 'angry') return -browGap - Math.abs(x(336) - x(107)) / fw
  if (face === 'sad') return ((y(61) + y(291)) / 2 - (y(13) + y(14)) / 2) / fh
  return -Math.abs(elapsed - 1600) / 10000
}

const same = (a: View, b: View) => (Object.keys(a) as (keyof View)[]).every((k) => a[k] === b[k])

interface RoomRow {
  code: string
  name: string
  since: string
}

/** query of the page, whether it sits before or after the hash */
export function pageQuery(): URLSearchParams {
  const q = new URLSearchParams(location.search)
  const h = location.hash.split('?')[1]
  if (h) new URLSearchParams(h).forEach((v, k) => q.set(k, v))
  return q
}

/**
 * Connects the stage to a room. Reconnects by itself; falls back to the simulated show when the API cannot be
 * reached at all (and keeps looking for it). `?mock=1` forces the show; `&at=40` starts it 40 s in,
 * `&sim=old` plays an older phone build (no mesh, no muscles), `&sim=cam` a phone without AirPods.
 */
export function useStage(code: string | null): { stage: Stage; view: View } {
  const ref = useRef<Stage | null>(null)
  if (!ref.current) {
    ref.current = new Stage()
    // for the dev scripts: read the stage's own numbers instead of scraping the screen
    if (typeof window !== 'undefined') (window as unknown as { __stage?: Stage }).__stage = ref.current
  }
  const stage = ref.current
  const [view, setView] = useState<View>(() => stage.view(performance.now()))

  useEffect(() => {
    let cur = stage.view(performance.now())
    const refresh = () => {
      const next = stage.view(performance.now())
      if (!same(cur, next)) {
        cur = next
        setView(next)
      }
    }
    const offSub = stage.subscribe(refresh)
    const offFrame = onFrame((now, dt) => stage.frame(now, dt))
    const slow = setInterval(refresh, 300)
    return () => {
      offSub()
      offFrame()
      clearInterval(slow)
    }
  }, [stage])

  useEffect(() => {
    stage.reset()
    if (!code) {
      stage.conn = 'connecting'
      return
    }
    let dead = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let sim: ReturnType<typeof setInterval> | undefined
    let probe: ReturnType<typeof setInterval> | undefined
    let rooms: ReturnType<typeof setInterval> | undefined
    const q = pageQuery()

    const setConn = (c: Conn) => {
      stage.conn = c
      stage.touch()
    }

    const simulate = () => {
      if (sim) return
      setConn('simulated')
      const kind = q.get('sim') ?? ''
      if (kind === 'idle') {
        // nobody in the room: the attract screen, for a look at it without a server
        sim = setInterval(() => {}, 60_000)
        return
      }
      const make = (round: number): PingPlayer =>
        createShow({
          vigor: [0.68, 1.04, 0.56][round % 3],
          seed: round + 1,
          hz: kind === 'old' ? 15 : 25,
          rich: kind === 'old' ? null : { airpods: kind !== 'cam', ear: kind !== 'cam' && kind !== 'noear', meshHz: kind === 'nomesh' ? 0 : 10, muscles: kind !== 'nomuscles' },
          tune: kind !== 'old' && q.get('tune') !== '0',
          tuneBare: kind === 'baretune',
          dose: q.get('dose') !== '0',
          miniEcho: q.get('miniecho') === '1',
        })
      let round = 0
      let player = make(round)
      let started = 0
      // start the show `sec` seconds in: the stretch before it is replayed on a virtual clock, so the screen is
      // exactly where it would be. Also on window, for the screenshot script.
      const seek = (sec: number) => {
        const at = Math.max(0, sec * 1000)
        stage.reset()
        stage.name = q.get('name') ?? 'Aino'
        round = 0
        player = make(round)
        started = performance.now() + (at ? -at : 1800)
        for (let el = 0; el < at; el += 40) {
          const st = stage.tune.step
          // mesh frames only where they leave a trace: the faces a tune keeps, and the last seconds
          synthSwitch.mesh = el > at - 3000 || (st !== null && st !== 'training' && st !== 'done')
          for (const m of player.step(el)) stage.ingest(m, started + el)
        }
        synthSwitch.mesh = true
        stage.touch()
      }
      seek(Number(q.get('at') ?? 0))
      ;(window as unknown as { __stageSeek?: (sec: number) => void }).__stageSeek = seek
      sim = setInterval(() => {
        const el = performance.now() - started
        if (el < 0) return
        stage.present = true
        for (const m of player.step(el)) stage.ingest(m)
        if (el > player.durationMs) {
          round++
          player = make(round)
          started = performance.now() + 1500
        }
      }, 40)
    }
    const stopSim = () => {
      clearInterval(sim)
      sim = undefined
    }

    const connect = () => {
      if (dead) return
      setConn('connecting')
      const sock = new WebSocket(wsUrl(`live?room=${encodeURIComponent(code)}&role=viewer&name=stage`))
      ws = sock
      sock.onopen = () => {
        if (ws === sock) setConn('open')
      }
      sock.onmessage = (ev) => {
        if (ws !== sock) return
        const raw = String(ev.data)
        try {
          stage.ingest(JSON.parse(raw) as LiveMessage, performance.now(), raw.length)
        } catch {
          /* not ours */
        }
      }
      sock.onclose = () => {
        if (dead || ws !== sock) return
        setConn('closed')
        retry = setTimeout(connect, 1200)
      }
      sock.onerror = () => sock.close()
    }
    // a socket can die without saying so (wifi dropped, laptop slept): drop it and open a new one
    const reopen = () => {
      if (dead || sim || (!ws && retry === undefined)) return
      clearTimeout(retry)
      const old = ws
      ws = null
      try {
        old?.close()
      } catch {
        /* already gone */
      }
      connect()
    }
    let misses = 0
    const online = () => reopen()
    window.addEventListener('online', online)
    // for the dev scripts: lose the socket the way a network drop would
    ;(window as unknown as { __stageDrop?: () => void }).__stageDrop = () => ws?.close()

    const health = (ms: number) => {
      const ctl = new AbortController()
      const to = setTimeout(() => ctl.abort(), ms)
      return fetch(apiUrl('health'), { signal: ctl.signal })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => clearTimeout(to))
    }

    if (isMock()) simulate()
    else {
      void health(2500).then((ok) => {
        if (dead) return
        if (ok) return connect()
        // no server: play the show so the screen is never empty, and switch to the real room when it appears
        simulate()
        probe = setInterval(() => {
          void health(2000).then((up) => {
            if (!up || dead || !sim) return
            clearInterval(probe)
            stopSim()
            stage.reset()
            connect()
          })
        }, 5000)
      })
      // is a phone in the room at all? The relay only says so when one joins, so ask the room list as well
      const look = () => {
        if (stage.conn === 'simulated') return
        api<RoomRow[]>('live/rooms')
          .then((rows) => {
            if (dead || !Array.isArray(rows)) return
            if (misses >= 2) reopen()
            misses = 0
            const r = code === '*' ? rows[0] : rows.find((x) => x.code === code)
            const here = !!r || (stage.lastMsgAt > 0 && performance.now() - stage.lastMsgAt < 5000)
            const name = r?.name && !stage.name ? r.name : stage.name
            if (here !== stage.present || name !== stage.name) {
              stage.present = here
              stage.name = name
              stage.touch()
            }
          })
          .catch(() => {
            // the server stopped answering: say so, and take a fresh socket once it is back
            if (++misses === 2 && !dead && stage.conn === 'open') setConn('closed')
          })
      }
      look()
      rooms = setInterval(look, 3000)
    }

    return () => {
      dead = true
      clearInterval(sim)
      clearInterval(probe)
      clearInterval(rooms)
      clearTimeout(retry)
      window.removeEventListener('online', online)
      ws?.close()
    }
  }, [code, stage])

  return { stage, view }
}
