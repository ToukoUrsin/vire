// Synthetic ping signal: one source for the mock cohort traces, the mock live stream
// and the fake sensor script (bun). No DOM, no dependencies. Relative import so bun can run it.
import { PING_PHASES } from '../../../../shared/types'
import type { Echo, EchoComponent, LiveFrame, LiveMessage, PhaseKey, PingTraces, TuneFace } from '../../../../shared/types'
import { poseFace } from '../stage/canon'

export const PHASE_START: Record<PhaseKey, number> = (() => {
  const out = {} as Record<PhaseKey, number>
  let at = 0
  for (const p of PING_PHASES) {
    out[p.key] = at
    at += p.ms
  }
  return out
})()
export const PING_TOTAL_MS = PING_PHASES.reduce((s, p) => s + p.ms, 0)

export function phaseAt(t: number): PhaseKey | 'idle' {
  if (t < 0 || t >= PING_TOTAL_MS) return 'idle'
  let key: PhaseKey = 'settle'
  for (const p of PING_PHASES) if (t >= PHASE_START[p.key]) key = p.key
  return key
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const sstep = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a), 0, 1)
  return u * u * (3 - 2 * u)
}
/** smooth pseudo-noise in -1..1, deterministic in t */
const noise = (t: number, k: number) =>
  (Math.sin(t * 1.0 + k * 12.9) + Math.sin(t * 2.31 + k * 4.1) * 0.6 + Math.sin(t * 5.17 + k * 7.7) * 0.3) / 1.9

export interface SynthSample {
  phase: PhaseKey | 'idle'
  smile: number
  cheek: number
  pitch: number
  yaw: number
  bpm: number
  rms: number
  f0: number | null
}

/**
 * One instant of a synthetic ping. `vigor` 1 = this person's usual response, 0.5 = a flat day.
 * Stateless: the same t always gives the same sample.
 */
export function synthSample(t: number, vigor = 1, seed = 1): SynthSample {
  const v = clamp(vigor, 0.25, 1.3)
  const s = t / 1000
  const phase = phaseAt(t)
  const L = PHASE_START.laugh
  const N = PHASE_START.nod
  const S = PHASE_START.speak
  const B = PHASE_START.breathe

  // smile: latency grows and the peak shrinks on a flat day
  const on = L + 1000 + 520 / v
  const rise = sstep(on, on + 650 + 300 / v, t)
  const fall = 1 - sstep(L + 9200, L + 13800, t)
  const pulses = 0.84 + 0.16 * Math.sin((t - on) / 1000 * Math.PI * 2 * 1.35)
  const base = 0.07 + 0.015 * noise(s * 0.7, seed)
  const smile = clamp(base + 0.74 * Math.min(v, 1.15) * rise * fall * pulses, 0, 1)
  const cheekRise = sstep(on + 180, on + 1100 + 300 / v, t)
  const cheek = clamp(0.04 + 0.01 * noise(s * 0.9, seed + 2) + 0.6 * v * v * cheekRise * fall * pulses, 0, 1)

  // head: slow resting sway, then two or three damped nods
  let pitch = 1.5 * noise(s * 0.4, seed + 3) + 0.4 * noise(s * 2.1, seed + 5)
  const u = (t - (N + 1100)) / 1000
  if (u > 0 && u < 3.2) pitch -= 15.5 * v * Math.sin(Math.PI * 2 * (0.95 + 0.4 * v) * u) * Math.exp(-0.55 * u) * sstep(0, 0.12, u)
  if (phase === 'speak') pitch += 1.2 * Math.sin(s * 2.2)
  const yaw = 1.8 * noise(s * 0.33, seed + 9) + (phase === 'speak' ? 1.4 * Math.sin(s * 1.3) : 0)

  // heart: resting rate, a small lift on laughter, then the slow-breath swing
  let bpm = 67 + 1.8 * noise(s * 0.21, seed + 7) + 3 * v * rise * fall
  if (t >= B && t < PING_TOTAL_MS) {
    const w = sstep(B, B + 1500, t)
    bpm += w * (6.6 * v) * -Math.cos(((t - B) / 10000) * Math.PI * 2)
  }

  // voice: one sentence with pauses; pitch moves less on a flat day
  let rms = 0.012 + 0.005 * Math.abs(noise(s * 3.1, seed + 11))
  let f0: number | null = null
  if (phase === 'laugh') rms += 0.05 * v * rise * fall * Math.abs(Math.sin(s * Math.PI * 2 * 2.8))
  const s0 = S + 1300
  const s1 = S + 10600
  if (t > s0 && t < s1) {
    const q = (t - s0) / (s1 - s0)
    const pauses = v < 0.75 ? [0.22, 0.47, 0.72] : [0.34, 0.68]
    const half = v < 0.75 ? 0.055 : 0.035
    let gate = sstep(0, 0.03, q) * (1 - sstep(0.97, 1, q))
    for (const p of pauses) gate *= 1 - sstep(p - half - 0.015, p - half, q) * (1 - sstep(p + half, p + half + 0.015, q))
    const syll = 0.5 + 0.5 * Math.abs(Math.sin(s * Math.PI * (3.2 + 1.1 * v)))
    rms += gate * (0.13 + 0.11 * v) * syll * (0.85 + 0.15 * noise(s * 6.3, seed + 13))
    if (gate > 0.5 && syll > 0.58) {
      const st = 3.3 * v * (0.8 * Math.sin(s * Math.PI * 2 * 0.31) + 0.5 * Math.sin(s * Math.PI * 2 * 0.83 + 1) + 0.3 * Math.sin(s * Math.PI * 2 * 1.9))
      f0 = 172 * Math.pow(2, st / 12)
    }
  }
  return { phase, smile, cheek, pitch, yaw, bpm, rms: clamp(rms, 0, 1), f0 }
}

/** 10 Hz traces of one full synthetic ping, in the upload format. */
export function synthTraces(vigor = 1, seed = 1): PingTraces {
  const tr: PingTraces = {
    t: [],
    smile: [],
    cheek: [],
    headPitch: [],
    bpm: [],
    rms: [],
    f0: [],
    phases: PING_PHASES.map((p) => ({ key: p.key, at: PHASE_START[p.key] })),
  }
  for (let t = 0; t < PING_TOTAL_MS; t += 100) {
    const x = synthSample(t, vigor, seed)
    tr.t.push(t)
    tr.smile.push(+x.smile.toFixed(3))
    tr.cheek.push(+x.cheek.toFixed(3))
    tr.headPitch.push(+x.pitch.toFixed(2))
    tr.bpm.push(t < 2500 ? null : +x.bpm.toFixed(1))
    tr.rms.push(+x.rms.toFixed(3))
    tr.f0.push(x.f0 === null ? null : Math.round(x.f0))
  }
  return tr
}

/** The echo a ping of this vigor resolves into (synthetic, deterministic). */
export function synthEcho(vigor = 1): Echo {
  const d = vigor - 1
  const zs = { smile: d * 3.6, voice: d * 2.6 + 0.1, heart: d * 1.5 + 0.2, move: d * 3.1 - 0.1 }
  const st = (z: number) => Math.round(clamp(50 + 15 * z, 0, 100))
  const lateS = Math.max(0, 0.52 / clamp(vigor, 0.25, 1.3) - 0.52)
  const components: EchoComponent[] = [
    {
      channel: 'smile',
      value: +(3.2 + 0.9 * zs.smile).toFixed(1),
      unit: 'smile·s',
      z: +zs.smile.toFixed(2),
      strength: st(zs.smile),
      note: zs.smile < -0.5 ? `Your smile came ${lateS.toFixed(1)} s slower than usual` : zs.smile > 0.5 ? 'Your smile came fast and stayed' : 'Your smile came like it usually does',
    },
    {
      channel: 'voice',
      value: +(3.4 + 0.7 * zs.voice).toFixed(1),
      unit: 'st',
      z: +zs.voice.toFixed(2),
      strength: st(zs.voice),
      note: zs.voice < -0.5 ? 'Your voice moved a little less than usual' : zs.voice > 0.5 ? 'Your voice had more melody than usual' : 'Your voice sounded like you',
    },
    {
      channel: 'heart',
      value: +(11 + 3 * zs.heart).toFixed(0),
      unit: 'bpm',
      z: +zs.heart.toFixed(2),
      strength: st(zs.heart),
      note: zs.heart < -0.5 ? 'Your heart followed your breath a bit less' : 'Your heart followed your breath well',
    },
    {
      channel: 'move',
      value: +(95 + 22 * zs.move).toFixed(0),
      unit: '°/s',
      z: +zs.move.toFixed(2),
      strength: st(zs.move),
      note: zs.move < -0.5 ? 'Your nod was smaller and slower than usual' : zs.move > 0.5 ? 'Your nod was quick and sure' : 'Your nod was your usual nod',
    },
  ]
  const strength = Math.round(components.reduce((s, c) => s + c.strength, 0) / components.length)
  const drift = +((strength - 50) / 15).toFixed(2)
  const status: Echo['status'] = drift > -0.75 ? 'steady' : drift > -1.5 ? 'dipping' : 'low'
  return {
    pingId: `synth-${Math.round(vigor * 100)}`,
    at: new Date().toISOString(),
    components,
    strength,
    drift,
    status,
    message:
      status === 'steady'
        ? 'Your echo is right around your usual today.'
        : 'Your echo was a little quieter today, and your week still looks like you.',
    suggestion:
      status === 'steady'
        ? null
        : { dose: 'forest', reason: 'The forest has lifted your echo most often.', expected: 6, uncertainty: 2.5 },
  }
}

export interface PingPlayer {
  /** total length including the idle tail, ms */
  durationMs: number
  /** every message due between the previous call and `elapsed` ms since the ping started */
  step(elapsed: number): LiveMessage[]
}

/**
 * Plays one synthetic 58 s ping as a LiveMessage stream: phase messages at each boundary,
 * frames at `hz`, then the echo and a short idle tail. Drive it with a timer: `step(now - start)`.
 */
export function createPingPlayer(opts: { vigor?: number; hz?: number; seed?: number; tailMs?: number; echo?: Echo; rich?: RichOpts | null } = {}): PingPlayer {
  const vigor = opts.vigor ?? 1
  const hz = opts.hz ?? 20
  const seed = opts.seed ?? 1
  const tailMs = opts.tailMs ?? 14000
  const dt = 1000 / hz
  const rich = opts.rich ? createRich(opts.rich, seed) : null
  let next = 0
  let lastPhase: string | null = null
  let beat = 0
  let echoSent = false
  return {
    durationMs: PING_TOTAL_MS + tailMs,
    step(elapsed) {
      const out: LiveMessage[] = []
      if (elapsed - next > 500) next = elapsed - 500 // never replay a long backlog
      for (; next <= elapsed; next += dt) {
        const t = next
        const x = synthSample(t, vigor, seed)
        if (x.phase !== lastPhase) {
          lastPhase = x.phase
          out.push({ type: 'phase', phase: x.phase, at: t })
        }
        beat += (x.bpm / 60) * (dt / 1000) * Math.PI * 2
        const wave = (Math.sin(beat) + 0.42 * Math.sin(2 * beat + 0.7) + 0.12 * Math.sin(3 * beat + 1.4)) / 1.35
        const idle = x.phase === 'idle'
        const frame: LiveFrame = {
          type: 'frame',
          t: Math.round(t),
          phase: x.phase,
          smile: idle ? 0.07 : +x.smile.toFixed(3),
          cheek: idle ? 0.04 : +x.cheek.toFixed(3),
          pitch: +x.pitch.toFixed(2),
          yaw: +x.yaw.toFixed(2),
          bpm: t < 2500 ? null : +x.bpm.toFixed(1),
          wave: +wave.toFixed(3),
          rms: +x.rms.toFixed(3),
          f0: x.f0 === null ? null : Math.round(x.f0),
        }
        // the phone stops sending when the ping is over: the rich stream does the same, the plain one keeps its idle tail
        if (rich && idle) {
          if (!echoSent && t >= PING_TOTAL_MS + 1900) {
            echoSent = true
            out.push({ type: 'echo', echo: opts.echo ?? synthEcho(vigor) })
          }
          continue
        }
        if (rich) rich.dress(frame, x, t, out)
        out.push(frame)
        if (!echoSent && t >= PING_TOTAL_MS + 700) {
          echoSent = true
          out.push({ type: 'echo', echo: opts.echo ?? synthEcho(vigor) })
        }
      }
      return out
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Round 2: what a phone with a personal face model and AirPods sends on top of the basic frame
// (muscles, the face read, the ear model's smile, where head and heart come from, the 478-point mesh),
// plus the tune step, a dose and the re-measure. All optional on the wire.

export interface RichOpts {
  /** head motion and heart rate come from AirPods Pro 3 (else the camera) */
  airpods?: boolean
  /** send `earSmile` (needs `airpods`) */
  ear?: boolean
  /** send the face mesh at this rate; 0 = no mesh */
  meshHz?: number
  /** send `muscles` and `face` (a phone with a personal model) */
  muscles?: boolean
}

/** MUSCLES order: smile, cheek, browDown, browUp, frown, jaw, eyes, nose */
export const TUNE_POSE: Record<TuneFace, number[]> = {
  rest: [0.03, 0.02, 0.03, 0.03, 0.02, 0.02, 0.05, 0],
  smile: [0.95, 0.8, 0, 0.1, 0, 0.25, 0.3, 0.25],
  sad: [0, 0, 0.22, 0.3, 0.9, 0, 0.15, 0],
  angry: [0, 0.1, 0.95, 0, 0.35, 0.05, 0.3, 0.45],
  surprised: [0, 0, 0, 0.95, 0, 0.6, 0, 0],
}

const r3 = (v: number) => +clamp(v, 0, 1).toFixed(3)

/** the eight muscle groups for one synthetic instant, each 0..1 of the person's own range */
export function synthMuscles(x: SynthSample, t: number, seed = 1): number[] {
  const s = t / 1000
  const smile = clamp((x.smile - 0.07) / 0.74, 0, 1)
  const cheek = clamp((x.cheek - 0.04) / 0.6, 0, 1)
  const speaking = x.phase === 'speak' ? clamp(x.rms / 0.2, 0, 1) : 0
  const blink = Math.pow(Math.max(0, Math.sin(s * 1.37 + seed) * Math.sin(s * 0.61 + 2 * seed)), 24)
  return [
    smile,
    cheek,
    0.04 + 0.03 * noise(s * 0.8, seed + 21),
    0.05 + 0.4 * speaking * (0.5 + 0.5 * Math.sin(s * 1.7)) + 0.18 * smile,
    0.03 + 0.03 * noise(s * 0.6, seed + 23),
    0.03 + 0.55 * speaking * Math.abs(Math.sin(s * Math.PI * 3.6)) + 0.28 * smile * (0.6 + 0.4 * Math.sin(s * Math.PI * 2 * 2.8)),
    blink + 0.35 * cheek,
    0.3 * smile * smile,
  ].map(r3)
}

/** the stage's fast-forward turns mesh frames off for the stretch nobody will see */
export const synthSwitch = { mesh: true }

function createRich(o: RichOpts, seed: number) {
  const meshHz = o.meshHz ?? 10
  const withMuscles = o.muscles ?? true
  let nextMesh = 0
  let ear = 0
  let lastT = 0
  return {
    /** adds the round-2 fields to `frame`, and a mesh message to `out` when one is due. `muscles` overrides the synthetic ones. */
    dress(frame: LiveFrame, x: SynthSample, t: number, out: LiveMessage[], muscles?: number[]): void {
      const s = t / 1000
      const mus = muscles ?? synthMuscles(x, t, seed)
      const roll = 1.4 * noise(s * 0.27, seed + 15) + (x.phase === 'speak' ? 1.6 * Math.sin(s * 0.9) : 0)
      frame.roll = +roll.toFixed(2)
      frame.headSource = o.airpods ? 'airpods' : 'camera'
      frame.heartSource = frame.bpm === null ? 'none' : o.airpods ? 'airpods' : 'camera'
      if (o.airpods) frame.wave = 0
      if (withMuscles) {
        frame.muscles = mus
        const scores: [TuneFace, number][] = [
          ['smile', mus[0]],
          ['sad', mus[4]],
          ['angry', mus[2]],
          ['surprised', mus[3] * 0.9],
        ]
        scores.sort((a, b) => b[1] - a[1])
        const top = scores[0]
        frame.face = top[1] > 0.42 ? { label: top[0], p: +clamp(0.5 + top[1] * 0.48, 0, 0.99).toFixed(2) } : { label: 'rest', p: +clamp(0.95 - top[1], 0.5, 0.99).toFixed(2) }
      }
      if (o.airpods && o.ear) {
        // the ear model follows the camera's smile a beat late, a little short, with its own noise
        const dtS = Math.max(0, Math.min(0.2, (t - lastT) / 1000))
        ear += (mus[0] * 0.88 - ear) * (1 - Math.exp(-dtS / 0.22))
        frame.earSmile = r3(ear + 0.035 * noise(s * 4.3, seed + 31))
      }
      lastT = t
      if (synthSwitch.mesh && meshHz > 0 && t >= nextMesh) {
        nextMesh = Math.max(nextMesh + 1000 / meshHz, t - 500)
        const pts = poseFace(
          new Array<number>(478 * 3),
          { pitch: x.pitch, yaw: x.yaw, roll },
          mus,
          { size: 0.5 + 0.006 * Math.sin(s * 1.1), cx: 0.5 + 0.012 * noise(s * 0.5, seed + 41), cy: 0.47 + 0.01 * noise(s * 0.4, seed + 43), aspect: 0.75, scale: 1000 },
        )
        out.push({ type: 'mesh', t: Math.round(t), pts })
      }
    },
  }
}

const TUNE_ORDER: TuneFace[] = ['rest', 'smile', 'sad', 'angry', 'surprised']
const TUNE_FACE_MS = 3400
const TUNE_TRAIN_MS = 1100

/**
 * The tune step as the phone sends it: `tune` messages for each asked face, then training, then the model's own check.
 * With `frames`, the face itself is sent too (frames with muscles and the mesh), as the patient app's session does.
 */
export function createTunePlayer(opts: { hz?: number; seed?: number; rich?: RichOpts | null; accuracy?: number; earAccuracy?: number | null; holdMs?: number } = {}): PingPlayer {
  const hz = opts.hz ?? 20
  const seed = opts.seed ?? 1
  const dt = 1000 / hz
  const rich = opts.rich ? createRich(opts.rich, seed) : null
  const holdMs = opts.holdMs ?? 7000
  const facesMs = TUNE_ORDER.length * TUNE_FACE_MS
  let next = 0
  let said = ''
  let beat = 0
  return {
    durationMs: facesMs + TUNE_TRAIN_MS + holdMs,
    step(elapsed) {
      const out: LiveMessage[] = []
      if (elapsed - next > 500) next = elapsed - 500
      for (; next <= elapsed; next += dt) {
        const t = next
        const i = Math.floor(t / TUNE_FACE_MS)
        const step: TuneFace | 'training' | 'done' = i < TUNE_ORDER.length ? TUNE_ORDER[i] : t < facesMs + TUNE_TRAIN_MS ? 'training' : 'done'
        if (step !== said) {
          said = step
          if (step === 'done') out.push({ type: 'tune', step, accuracy: opts.accuracy ?? 0.94, earAccuracy: opts.earAccuracy === undefined ? (opts.rich?.airpods ? 0.86 : null) : opts.earAccuracy })
          else out.push({ type: 'tune', step })
        }
        if (!rich || t > facesMs + TUNE_TRAIN_MS + 2500) continue
        // the asked face comes on, holds, and lets go before the next one
        const u = i < TUNE_ORDER.length ? (t - i * TUNE_FACE_MS) / TUNE_FACE_MS : 1
        const on = i < TUNE_ORDER.length ? sstep(0.1, 0.32, u) * (1 - sstep(0.84, 0.98, u)) : 0
        const target = i < TUNE_ORDER.length ? TUNE_POSE[TUNE_ORDER[i]] : TUNE_POSE.rest
        const s = t / 1000
        const blink = Math.pow(Math.max(0, Math.sin(s * 1.37 + seed) * Math.sin(s * 0.61 + 2 * seed)), 24)
        const mus = target.map((v, k) => r3(TUNE_POSE.rest[k] + (v - TUNE_POSE.rest[k]) * on + (k === 6 ? blink : 0)))
        const bpm = 66 + 1.5 * noise(s * 0.2, seed + 7)
        beat += (bpm / 60) * (dt / 1000) * Math.PI * 2
        const x: SynthSample = {
          phase: 'idle',
          smile: 0.07 + 0.74 * mus[0],
          cheek: 0.04 + 0.6 * mus[1],
          pitch: 1.2 * noise(s * 0.4, seed + 3) + 2.5 * mus[3] - 2 * mus[2],
          yaw: 1.6 * noise(s * 0.33, seed + 9),
          bpm,
          rms: 0.012,
          f0: null,
        }
        const frame: LiveFrame = {
          type: 'frame',
          t: Math.round(t),
          phase: 'idle',
          smile: +x.smile.toFixed(3),
          cheek: +x.cheek.toFixed(3),
          pitch: +x.pitch.toFixed(2),
          yaw: +x.yaw.toFixed(2),
          bpm: t < 2500 ? null : +bpm.toFixed(1),
          wave: +(Math.sin(beat) * 0.7).toFixed(3),
          rms: 0.012,
          f0: null,
        }
        rich.dress(frame, x, t, out, mus)
        out.push(frame)
      }
      return out
    },
  }
}

const MINI_LAUGH_MS = 8000
const MINI_BREATHE_MS = 10000

/** The dose (phase `dose`, slow breathing and a slowly turning head) followed by the 18 s mini ping: laugh, one breath. */
export function createDosePlayer(opts: { vigor?: number; hz?: number; seed?: number; rich?: RichOpts | null; doseMs?: number; echo?: Echo | null } = {}): PingPlayer {
  const vigor = opts.vigor ?? 1
  const hz = opts.hz ?? 20
  const seed = opts.seed ?? 1
  const dt = 1000 / hz
  const doseMs = opts.doseMs ?? 16000
  const rich = opts.rich ? createRich(opts.rich, seed) : null
  const miniAt = doseMs + 3300 // "One more quick listen."
  const endAt = miniAt + MINI_LAUGH_MS + MINI_BREATHE_MS
  let next = 0
  let said = ''
  let beat = 0
  let echoSent = false
  return {
    durationMs: endAt + 9000,
    step(elapsed) {
      const out: LiveMessage[] = []
      if (elapsed - next > 500) next = elapsed - 500
      for (; next <= elapsed; next += dt) {
        const t = next
        const s = t / 1000
        let x: SynthSample
        let phase: LiveFrame['phase']
        if (t < miniAt) {
          phase = 'dose'
          // a forest walk for the head, slow breathing for the heart
          const w = sstep(0, 2500, t)
          x = {
            phase: 'idle',
            smile: 0.09 + 0.06 * w * (0.5 + 0.5 * Math.sin(s * 0.5)),
            cheek: 0.05,
            pitch: 1.5 * noise(s * 0.4, seed + 3) + 5 * w * Math.sin(s * 0.47),
            yaw: 26 * w * Math.sin(s * 0.62) + 2 * noise(s * 0.9, seed + 9),
            bpm: 66 + 5.5 * w * -Math.cos((t / 10000) * Math.PI * 2) + noise(s * 0.3, seed + 7),
            rms: 0.012,
            f0: null,
          }
        } else if (t < endAt) {
          const m = t - miniAt
          x = synthSample(m < MINI_LAUGH_MS ? PHASE_START.laugh + m : PHASE_START.breathe + (m - MINI_LAUGH_MS), vigor, seed)
          phase = m < MINI_LAUGH_MS ? 'laugh' : 'breathe'
        } else {
          phase = 'idle'
          x = synthSample(-1, vigor, seed)
        }
        if (phase !== said) {
          said = phase
          out.push({ type: 'phase', phase, at: t })
        }
        if (phase === 'idle') {
          if (!echoSent && opts.echo && t >= endAt + 1500) {
            echoSent = true
            out.push({ type: 'echo', echo: opts.echo })
          }
          continue
        }
        beat += (x.bpm / 60) * (dt / 1000) * Math.PI * 2
        const frame: LiveFrame = {
          type: 'frame',
          t: Math.round(t),
          phase,
          smile: +x.smile.toFixed(3),
          cheek: +x.cheek.toFixed(3),
          pitch: +x.pitch.toFixed(2),
          yaw: +x.yaw.toFixed(2),
          bpm: +x.bpm.toFixed(1),
          wave: +((Math.sin(beat) + 0.42 * Math.sin(2 * beat + 0.7)) / 1.35).toFixed(3),
          rms: +x.rms.toFixed(3),
          f0: null,
        }
        if (rich) rich.dress(frame, { ...x, phase: phase === 'dose' ? 'idle' : phase }, t, out)
        out.push(frame)
      }
      return out
    },
  }
}

/** Several players back to back, with a quiet gap between them: the whole demo as one stream. */
export function createSequence(parts: PingPlayer[], gapMs = 1500): PingPlayer {
  const starts: number[] = []
  let at = 0
  for (const p of parts) {
    starts.push(at)
    at += p.durationMs + gapMs
  }
  return {
    durationMs: at,
    step(elapsed) {
      const out: LiveMessage[] = []
      parts.forEach((p, i) => {
        const local = elapsed - starts[i]
        if (local >= 0 && local <= p.durationMs + gapMs) out.push(...p.step(Math.min(local, p.durationMs)))
      })
      return out
    },
  }
}

export interface ShowOpts {
  vigor?: number
  hz?: number
  seed?: number
  /** null = an old phone build: the basic frame only */
  rich?: RichOpts | null
  tune?: boolean
  /** during tune, send only the `tune` messages (no frames, no mesh) */
  tuneBare?: boolean
  dose?: boolean
  doseMs?: number
  /** send an echo after the re-measure too (the phone does not today) */
  miniEcho?: boolean
}

/** tune (optional), one full ping with its echo, then (optional) a dose and the re-measure */
export function createShow(o: ShowOpts = {}): PingPlayer {
  const vigor = o.vigor ?? 0.68
  const rich = o.rich === undefined ? { airpods: true, ear: true, meshHz: 10, muscles: true } : o.rich
  const parts: PingPlayer[] = []
  if (o.tune) parts.push(createTunePlayer({ hz: o.hz, seed: o.seed, rich: o.tuneBare ? null : rich }))
  parts.push(createPingPlayer({ vigor, hz: o.hz, seed: o.seed, rich, tailMs: o.dose ? 9000 : 14000 }))
  if (o.dose) {
    const after = Math.min(1.2, vigor + 0.22)
    parts.push(createDosePlayer({ vigor: after, hz: o.hz, seed: o.seed, rich, doseMs: o.doseMs, echo: o.miniEcho ? synthEcho(after) : null }))
  }
  return createSequence(parts)
}
