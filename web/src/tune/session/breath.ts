import type { BreathRead, PaceFollow } from '@shared/earsession'

/** The shortest window on which two or three slow breaths can be distinguished. */
export const MIN_BREATH_MS = 20_000
const LOW_HZ = 0.07
const HIGH_HZ = 0.5
const MIN_SAMPLE_HZ = 18
const MAX_SAMPLE_HZ = 70
const MAX_GAP_MS = 300

type Fit = { amplitude: number; quality: number; c: number; s: number }
type Prepared = { t: number[]; values: number[][]; fs: number; duration: number }
type Analysis = { frequency: number; score: number; confidence: number; channel: number; fit: Fit; prepared: Prepared }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value))
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
const median = (values: number[]): number | null => {
  if (!values.length) return null
  const a = values.slice().sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length & 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2
}

/** Gaps longer than this make an interpolated phase misleading. Times are in ms. */
export function gapsOf(rows: number[][], maxGapMs = MAX_GAP_MS): Array<{ t0: number; t1: number; ms: number }> {
  const times = rows
    .filter((row) => Array.isArray(row) && finite(row[0]))
    .map((row) => row[0]!)
    .sort((a, b) => a - b)
  const out: Array<{ t0: number; t1: number; ms: number }> = []
  for (let i = 1; i < times.length; i++) {
    const ms = times[i]! - times[i - 1]!
    if (ms > maxGapMs) out.push({ t0: times[i - 1]!, t1: times[i]!, ms })
  }
  return out
}

function unwrap(values: number[]): number[] {
  if (!values.length) return []
  const out = [values[0]!]
  for (let i = 1; i < values.length; i++) {
    let d = values[i]! - values[i - 1]!
    while (d > 180) d -= 360
    while (d < -180) d += 360
    out.push(out[i - 1]! + d)
  }
  return out
}

function detrend(values: number[]): number[] {
  if (values.length < 3) return values.slice()
  const xMean = (values.length - 1) / 2
  const yMean = mean(values)
  let xx = 0; let xy = 0
  for (let i = 0; i < values.length; i++) {
    const x = i - xMean
    xx += x * x
    xy += x * (values[i]! - yMean)
  }
  const slope = xx ? xy / xx : 0
  return values.map((v, i) => v - (yMean + slope * (i - xMean)))
}

function prepare(rows: number[][], t0: number, t1: number): Prepared | null {
  if (!(finite(t0) && finite(t1) && t1 > t0 && t1 - t0 >= MIN_BREATH_MS)) return null
  const source = rows
    .filter((row) => Array.isArray(row) && row.length >= 4 && finite(row[0]) && row[0]! >= t0 && row[0]! <= t1 && row.slice(1, 4).every(finite))
    .map((row) => row.slice())
    .sort((a, b) => a[0]! - b[0]!)
  const unique: number[][] = []
  for (const row of source) if (!unique.length || row[0] !== unique[unique.length - 1]![0]) unique.push(row)
  if (unique.length < 20) return null
  const dts: number[] = []
  for (let i = 1; i < unique.length; i++) {
    const dt = unique[i]![0]! - unique[i - 1]![0]!
    if (dt > 0) dts.push(dt)
  }
  const dt = median(dts)
  if (dt === null || dt <= 0) return null
  const inputHz = 1000 / dt
  if (inputHz < MIN_SAMPLE_HZ || inputHz > MAX_SAMPLE_HZ || gapsOf(unique).length) return null
  const start = unique[0]![0]!
  const end = unique[unique.length - 1]![0]!
  const duration = end - start
  if (duration < MIN_BREATH_MS * 0.92) return null
  const fs = Math.max(20, Math.min(60, inputHz))
  const count = Math.min(5000, Math.floor(duration / 1000 * fs) + 1)
  if (count < 200) return null
  const yaw = unwrap(unique.map((row) => row[2]!))
  const channels = unique.map((row, i) => [row[1]!, yaw[i]!, row[3]!, row[4]!, row[5]!, row[6]!, row[7]!, row[8]!, row[9]!])
  const outT: number[] = []; const outValues = Array.from({ length: 9 }, () => [] as number[])
  let cursor = 0
  for (let i = 0; i < count; i++) {
    const t = start + i * 1000 / fs
    while (cursor + 1 < unique.length && unique[cursor + 1]![0]! < t) cursor++
    const a = unique[cursor]!; const b = unique[Math.min(unique.length - 1, cursor + 1)]!
    const span = b[0]! - a[0]!; const u = span > 0 ? clamp((t - a[0]!) / span, 0, 1) : 0
    const ca = channels[cursor]!; const cb = channels[Math.min(channels.length - 1, cursor + 1)]!
    outT.push(t)
    for (let k = 0; k < 9; k++) {
      const av = finite(ca[k]) ? ca[k]! : 0; const bv = finite(cb[k]) ? cb[k]! : av
      outValues[k]!.push(av + (bv - av) * u)
    }
  }
  return { t: outT, values: outValues.map(detrend), fs, duration }
}

function fitAt(values: number[], t: number[], frequency: number): Fit {
  const omega = 2 * Math.PI * frequency / 1000
  let c = 0; let s = 0; let energy = 0
  for (let i = 0; i < values.length; i++) {
    const phase = omega * t[i]!
    const v = values[i]!
    c += v * Math.cos(phase); s += v * Math.sin(phase); energy += v * v
  }
  const n = Math.max(1, values.length)
  c /= n; s /= n; energy /= n
  const amplitude = 2 * Math.hypot(c, s)
  const quality = energy > 1e-12 ? clamp((amplitude * amplitude / 2) / energy, 0, 1) : 0
  return { amplitude, quality, c, s }
}

function channelWeight(index: number): number {
  // Angles are in degrees and are the most stable breath carrier. Gyro and acceleration
  // are useful corroboration but are noisier in the recordings.
  if (index < 3) return 1
  if (index < 6) return 0.6
  return 0.35
}

function scoreAt(prepared: Prepared, frequency: number): { score: number; channel: number; fit: Fit } {
  const fits = prepared.values.map((values) => fitAt(values, prepared.t, frequency))
  const usable = fits
    .map((fit, index) => ({ fit, index, value: fit.quality * channelWeight(index) }))
    .filter((x) => x.fit.amplitude > 1e-7)
    .sort((a, b) => b.value - a.value)
  if (!usable.length) return { score: 0, channel: 0, fit: fits[0] ?? { amplitude: 0, quality: 0, c: 0, s: 0 } }
  const top = usable[0]!
  const support = usable.filter((x) => x.fit.quality >= top.fit.quality * 0.3).slice(0, 4).length
  const score = top.fit.quality * (0.58 + 0.14 * Math.min(3, support - 1))
  return { score: clamp(score), channel: top.index, fit: top.fit }
}

function analyze(prepared: Prepared): Analysis | null {
  const seconds = prepared.duration / 1000
  const step = Math.max(0.0015, 1 / seconds / 4)
  const scores: Array<{ f: number; score: number; channel: number; fit: Fit }> = []
  for (let f = LOW_HZ; f <= HIGH_HZ + 1e-9; f += step) {
    const got = scoreAt(prepared, f)
    scores.push({ f, ...got })
  }
  const best = scores.reduce((a, b) => b.score > a.score ? b : a, scores[0]!)
  const background = median(scores.map((x) => x.score)) ?? 0
  const prominence = best.score / Math.max(0.008, background)
  if (!(best.score >= 0.035 && prominence >= 2.1)) return null

  // A breath waveform can have a stronger second harmonic than its fundamental.
  // If the subharmonic is also clear, prefer it so we do not report twice the rate.
  let chosen = best
  const half = scores.reduce((a, b) => Math.abs(b.f - best.f / 2) < Math.abs(a.f - best.f / 2) ? b : a, scores[0]!)
  if (best.f > LOW_HZ * 2.05 && half.score >= best.score * 0.42 && half.score >= 0.045) chosen = half

  const mid = prepared.t.length >> 1
  const first: Prepared = { ...prepared, t: prepared.t.slice(0, mid), values: prepared.values.map((x) => x.slice(0, mid)), duration: prepared.duration / 2 }
  const second: Prepared = { ...prepared, t: prepared.t.slice(mid), values: prepared.values.map((x) => x.slice(mid)), duration: prepared.duration / 2 }
  const q1 = scoreAt(first, chosen.f).score; const q2 = scoreAt(second, chosen.f).score
  const stability = clamp(Math.min(q1, q2) / Math.max(0.08, chosen.score))
  const support = scores.filter((x) => Math.abs(x.f - chosen.f) <= step * 1.5 && x.score >= chosen.score * 0.75).length
  const confidence = clamp(0.28 * clamp((chosen.score - 0.025) / 0.45) + 0.28 * clamp((prominence - 1.5) / 7) + 0.3 * stability + 0.14 * clamp(support / 3))
  if (confidence < 0.29 || stability < 0.2) return null
  return { frequency: chosen.f, score: chosen.score, confidence, channel: chosen.channel, fit: scoreAt(prepared, chosen.f).fit, prepared }
}

function selected(rows: number[][], t0: number, t1: number): Prepared | null {
  return prepare(rows, t0, t1)
}

/** Blindly estimate the breathing pace in a stretch. It needs at least 20 seconds of clean samples. */
export function breathRate(rows: number[][], t0: number, t1: number): BreathRead {
  const prepared = selected(rows, t0, t1)
  if (!prepared) return { perMin: null, conf: 0 }
  const motion = stillness(rows, t0, t1)
  // A walking or large head-motion run can leave a deceptively periodic low-frequency
  // remnant after resampling. Keep the answer honest in that case.
  if (motion !== null && motion > 8) return { perMin: null, conf: 0 }
  const result = analyze(prepared)
  if (!result) return { perMin: null, conf: 0 }
  return { perMin: result.frequency * 60, conf: result.confidence }
}

/**
 * Lock in at the requested pace and report how much angle motion is at that frequency. `minAmplitudeDeg` is the
 * least motion at that pace, peak to trough, that counts: a head's by default; a phone on a chest passes its own.
 */
export function followsPace(rows: number[][], t0: number, t1: number, perMin: number, minAmplitudeDeg = 0.06): PaceFollow {
  const prepared = selected(rows, t0, t1)
  if (!prepared || !(perMin > 0 && Number.isFinite(perMin))) return { follows: false, coherence: 0, amplitudeDeg: 0 }
  const motion = stillness(rows, t0, t1)
  if (motion !== null && motion > 8) return { follows: false, coherence: 0, amplitudeDeg: 0 }
  const asked = perMin / 60
  if (asked < LOW_HZ || asked > HIGH_HZ) return { follows: false, coherence: 0, amplitudeDeg: 0 }
  const fixed = scoreAt(prepared, asked)
  const best = analyze(prepared)
  const coherence = best ? clamp(fixed.score / Math.max(0.001, best.score)) : clamp(fixed.score / 0.12)
  const angleFits = prepared.values.slice(0, 3).map((values) => fitAt(values, prepared.t, asked))
  const angle = angleFits.reduce((a, b) => b.amplitude > a.amplitude ? b : a, angleFits[0]!)
  const amplitudeDeg = angle.amplitude * 2
  const nearAsked = !best || Math.abs(best.frequency - asked) <= Math.max(0.025, 1 / (prepared.duration / 1000))
  const follows = nearAsked && fixed.score >= 0.08 && coherence >= 0.42 && amplitudeDeg >= minAmplitudeDeg
  return { follows, coherence, amplitudeDeg }
}

/** Mean angular speed in degrees per second, matching the earMeasures convention. */
export function stillness(rows: number[][], t0: number, t1: number): number | null {
  const source = rows
    .filter((row) => Array.isArray(row) && row.length >= 4 && finite(row[0]) && row[0]! >= t0 && row[0]! <= t1 && row.slice(1, 4).every(finite))
    .map((row) => row.slice())
    .sort((a, b) => a[0]! - b[0]!)
  if (source.length < 3) return null
  const yaw = unwrap(source.map((row) => row[2]!))
  const gyro = source.slice(1).map((row, i) => ({ dt: (row[0]! - source[i]![0]!) / 1000, speed: Math.hypot(row[7] ?? 0, row[8] ?? 0, row[9] ?? 0) })).filter((x) => x.dt > 0 && x.dt <= 0.5 && x.speed > 1e-9).map((x) => x.speed)
  if (gyro.length >= Math.max(2, Math.floor((source.length - 1) * 0.25))) return mean(gyro)
  const rates: number[] = []
  for (let i = 1; i < source.length; i++) {
    const dt = (source[i]![0]! - source[i - 1]![0]!) / 1000
    if (!(dt > 0 && dt <= 0.5)) continue
    rates.push(Math.hypot(source[i]![1]! - source[i - 1]![1]!, yaw[i]! - yaw[i - 1]!, source[i]![3]! - source[i - 1]![3]!) / dt)
  }
  return rates.length ? mean(rates) : null
}

export interface BreathTracker {
  push(row: number[]): void
  read(nowMs: number): { perMin: number | null; conf: number; wave: number; moveDegS: number | null }
}

/** A small rolling estimator for the live breathing line. */
export function createBreathTracker(): BreathTracker {
  const rows: number[][] = []
  return {
    push(row: number[]) {
      if (!Array.isArray(row) || !finite(row[0])) return
      rows.push(row.slice())
      const cutoff = row[0]! - 32_000
      while (rows.length && rows[0]![0]! < cutoff) rows.shift()
    },
    read(nowMs: number) {
      const from = nowMs - 25_000
      const window = rows.filter((row) => row[0]! >= from && row[0]! <= nowMs)
      const read = breathRate(window, from, nowMs)
      const moveDegS = stillness(window, from, nowMs)
      if (read.perMin === null) return { ...read, wave: 0, moveDegS }
      const prepared = prepare(window, from, nowMs)
      if (!prepared) return { ...read, wave: 0, moveDegS }
      const result = analyze(prepared)
      if (!result) return { ...read, wave: 0, moveDegS }
      const fit = result.fit; const phase = 2 * Math.PI * result.frequency * prepared.t[prepared.t.length - 1]! / 1000
      const projected = 2 * (fit.c * Math.cos(phase) + fit.s * Math.sin(phase))
      return { ...read, wave: clamp(projected / Math.max(1e-9, fit.amplitude), -1, 1), moveDegS }
    },
  }
}
