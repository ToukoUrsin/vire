import type { EarSessionRec, PacedBreath, SessionPhase } from '@shared/earsession'

export interface SimPaceSegment {
  t0: number
  t1: number
  perMin: number
  /** false makes the person breathe at actualPerMin instead of following the sound. */
  follow?: boolean
  actualPerMin?: number
}

export interface SimSessionOptions {
  seed?: number
  durationMs?: number
  durationSec?: number
  hz?: number
  sampleHz?: number
  pace?: number
  actualPace?: number
  paceSchedule?: number | SimPaceSegment[] | number[]
  paces?: number[]
  schedule?: SimPaceSegment[]
  amplitudeDeg?: number
  noise?: number
  follow?: boolean
  walking?: boolean
  fidget?: boolean
  fidgetAmplitude?: number
  gappy?: boolean
  gapProbability?: number
  gapMs?: number
  at?: string
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function rng(seed: number): () => number {
  let state = (seed | 0) || 1
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return ((state >>> 0) % 1_000_000) / 1_000_000
  }
}

function normal(random: () => number): number {
  const a = Math.max(1e-9, random()); const b = random()
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b)
}

function asSchedule(options: SimSessionOptions, durationMs: number): SimPaceSegment[] {
  const numeric = options.paces ?? (Array.isArray(options.paceSchedule) && options.paceSchedule.every((x) => typeof x === 'number') ? options.paceSchedule as number[] : null)
  if (numeric?.length) {
    const span = durationMs / numeric.length
    return numeric.filter((pace) => pace > 0).map((perMin, i) => ({ t0: i * span, t1: (i + 1) * span, perMin, follow: options.follow ?? true, actualPerMin: options.actualPace }))
  }
  const given = options.schedule ?? (Array.isArray(options.paceSchedule) ? options.paceSchedule as SimPaceSegment[] : null)
  if (given?.length) return given.filter((s) => s && s.t1 > s.t0 && s.perMin > 0).map((s) => ({ ...s }))
  const pace = typeof options.paceSchedule === 'number' ? options.paceSchedule : options.pace ?? 8
  return [{ t0: 0, t1: durationMs, perMin: pace, follow: options.follow ?? true, actualPerMin: options.actualPace }]
}

function segmentAt(schedule: SimPaceSegment[], t: number): SimPaceSegment | null {
  return schedule.find((s) => t >= s.t0 && t < s.t1) ?? null
}

/** Deterministic AirPods and camera-pulse data for estimator tests and the demo. */
export function simulateSession(options: SimSessionOptions = {}): EarSessionRec {
  const durationMs = Math.max(20_000, Math.round(options.durationMs ?? (options.durationSec ? options.durationSec * 1000 : 120_000)))
  const hz = clamp(Math.round(options.sampleHz ?? options.hz ?? 50), 20, 60)
  const amplitude = Math.max(0.02, options.amplitudeDeg ?? 0.24)
  const noise = Math.max(0, options.noise ?? 0.028)
  const random = rng(options.seed ?? 1)
  const schedule = asSchedule(options, durationMs)
  const actualFor = (s: SimPaceSegment) => s.follow === false || (!s.follow && options.follow === false) ? (s.actualPerMin ?? options.actualPace ?? s.perMin + 3) : (s.actualPerMin ?? s.perMin)
  const head: number[][] = []
  const dt = 1000 / hz
  let phase = 0
  let lastActual: number | null = null
  let nextGap = -1
  for (let t = 0; t <= durationMs + 0.1; t += dt) {
    const s = segmentAt(schedule, t)
    const actual = s ? actualFor(s) : (options.actualPace ?? options.pace ?? 8)
    if (lastActual !== actual) { phase = 0; lastActual = actual }
    const step = 2 * Math.PI * actual / 60 * dt / 1000
    phase += step
    if (phase > Math.PI * 2) phase -= Math.PI * 2
    if (nextGap < 0 && options.gappy && random() < (options.gapProbability ?? 0.003)) nextGap = t + (options.gapMs ?? 500)
    if (nextGap >= 0 && t < nextGap) continue
    nextGap = -1
    const breathAmp = amplitude * (0.82 + 0.28 * random())
    const breath = Math.sin(phase) * breathAmp
    const drift = 0.25 * Math.sin(t * 0.00014 + 0.4) + 0.12 * Math.sin(t * 0.000037)
    const fidget = random() < (options.fidget ? 0.012 : 0.0007) ? (random() - 0.5) * (options.fidgetAmplitude ?? (options.fidget ? 5 : 3.5)) : 0
    const walk = options.walking ? Math.sin(t * 2 * Math.PI * 1.8 / 1000) : 0
    const pitch = drift + breath * 1.0 + fidget + walk * 1.2 + normal(random) * noise
    const yaw = 0.6 * drift + breath * 0.55 + fidget * 0.6 + walk * 0.75 + normal(random) * noise
    const roll = 0.35 * drift + breath * 0.7 + fidget * 0.45 + walk * 0.5 + normal(random) * noise * 0.8
    const ax = 0.018 * Math.sin(phase + 0.5) + (options.walking ? 0.22 * walk : 0) + normal(random) * noise * 0.45
    const ay = 0.013 * Math.sin(phase + 1.1) + normal(random) * noise * 0.45
    const az = 1 + 0.02 * Math.sin(phase + 2) + normal(random) * noise * 0.45
    const omega = actual / 60 * 2 * Math.PI
    const walkOmega = 2 * Math.PI * 1.8
    const rx = breathAmp * omega * Math.cos(phase) + (options.walking ? 1.2 * walkOmega * Math.cos(t * walkOmega / 1000) : 0) + normal(random) * noise * 2
    const ry = breathAmp * 0.55 * omega * Math.cos(phase) + (options.walking ? 0.75 * walkOmega * Math.cos(t * walkOmega / 1000) : 0) + normal(random) * noise * 2
    const rz = breathAmp * 0.7 * omega * Math.cos(phase) + (options.walking ? 0.5 * walkOmega * Math.cos(t * walkOmega / 1000) : 0) + normal(random) * noise * 2
    head.push([Math.round(t), pitch, yaw, roll, ax, ay, az, rx, ry, rz])
  }

  const breaths: PacedBreath[] = []
  for (const s of schedule) {
    const breathMs = 60_000 / s.perMin
    for (let t = s.t0; t + breathMs <= s.t1 + 1; t += breathMs) breaths.push({ t0: t, tMid: t + breathMs / 2, t1: t + breathMs, perMin: s.perMin })
  }
  const pulse: number[][] = []
  for (let t = 0; t <= durationMs; t += 250) {
    const s = segmentAt(schedule, t); const actual = s ? actualFor(s) : options.pace ?? 8
    const p = t / 1000; const bpm = 66 + 3.8 * Math.sin(2 * Math.PI * actual / 60 * p) + normal(random) * 0.25
    pulse.push([t, bpm, 0.86, Math.sin(2 * Math.PI * actual / 60 * p)])
  }
  const phases: SessionPhase[] = [{ name: 'session', t0: 0, t1: durationMs }]
  const kind = options.walking ? 'walk' : 'breathe'
  return {
    v: 1,
    at: options.at ?? '2026-01-01T00:00:00.000Z',
    kind,
    device: { shell: 'sim', gyro: true, hz, ua: 'vire-session-sim' },
    head,
    pulse,
    airHr: [],
    phases,
    breaths,
    steps: [],
    sound: schedule.map((s, i) => ({ id: `pace-${i}`, t: s.t0, made: 'tone' as const })),
  }
}

