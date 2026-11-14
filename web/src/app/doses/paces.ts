// Slow breathing: which pace swings this person's heart the most.
// Three paces, two breaths each. For each pace the swing is read from the beats of the camera's pulse wave with
// the same lock-in fit the ping uses, and shown only when it passes the ping's own gates. Pure, so it runs in tests:
// the pulse wave is passed in.
import {
  HEART_MAX_SWING_SE,
  HEART_MIN_QUALITY,
  analyzePulseWindow,
  beatSeries,
  coversBreaths,
  lockedSwing,
} from '../../sense/features'
import type { PulseSample } from '../../sense/types'
import { clamp, mean, plural, round1 } from './num'

export const PACE_FIRST = 6
export const PACE_MIN = 4.5
export const PACE_MAX = 7
const PACE_STEP = 0.5
export const BREATHS_PER_PACE = 2
/** the live line looks back this far */
const LIVE_WINDOW_MS = 20000
/**
 * The camera's pulse wave is final 47 frames (at 30 a second) after the light it describes reached the lens.
 * A pace is read this long after its last breath, so its last beat is in the wave and no longer provisional.
 */
export const WAVE_SETTLES_MS = 1800

export interface PaceSlot {
  /** breaths a minute */
  pace: number
  /** ms from the start of the dose */
  startMs: number
  endMs: number
  breathMs: number
}

export interface PaceRead {
  pace: number
  /** peak to trough of the heart rate that moved with the breath; null when the pulse could not be read */
  swingBpm: number | null
  /** one standard error of that swing */
  se: number | null
}

/** what the `pulse` events said, kept for the whole dose: the camera's quality for the gate, the AirPods' rates */
export interface PulseLog {
  /** camera: one row per event */
  t: number[]
  quality: number[]
  /** AirPods heart-rate samples, when they are the source */
  airT: number[]
  airBpm: number[]
}

/** the camera's pulse wave (`sense.pulseWave`): each sample at the time it describes, ms on the pulse clock */
export interface WaveSeries {
  t: number[]
  v: number[]
}

export const emptyPulseLog = (): PulseLog => ({ t: [], quality: [], airT: [], airBpm: [] })

export function logPulse(log: PulseLog, p: PulseSample) {
  if (p.source === 'airpods') {
    if (p.bpm == null) return
    log.airT.push(p.t)
    log.airBpm.push(p.bpm)
    return
  }
  log.t.push(p.t)
  log.quality.push(p.quality)
}

const snap = (pace: number) => Math.round(pace / PACE_STEP) * PACE_STEP

/** the remembered pace, then one half a breath slower and one half a breath faster, all inside 4.5 to 7 */
export function threePaces(centre: number): number[] {
  const c = snap(clamp(Number.isFinite(centre) ? centre : PACE_FIRST, PACE_MIN, PACE_MAX))
  let slower = c - PACE_STEP
  let faster = c + PACE_STEP
  // at an edge the missing neighbour is taken from the other side, so there are always three different paces
  if (slower < PACE_MIN) slower = c + 2 * PACE_STEP
  if (faster > PACE_MAX) faster = c - 2 * PACE_STEP
  return [c, Math.min(slower, faster), Math.max(slower, faster)]
}

export function paceSchedule(centre: number): PaceSlot[] {
  let at = 0
  return threePaces(centre).map((pace) => {
    const breathMs = 60000 / pace
    const slot: PaceSlot = { pace, startMs: at, endMs: at + BREATHS_PER_PACE * breathMs, breathMs }
    at = slot.endMs
    return slot
  })
}

export interface BreathAt {
  /** which pace, and which of its breaths */
  slot: number
  breath: number
  /** 0..1 through the breath: the first half is the in-breath */
  u: number
  /** breath halves begun since the start of the dose (0 is the first in-breath) */
  half: number
}

/** where in the breathing the dose is, `ms` after it began; null once the last breath is over */
export function breathAt(slots: PaceSlot[], ms: number): BreathAt | null {
  let halves = 0
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!
    if (ms < s.endMs) {
      const b = Math.max(0, ms - s.startMs) / s.breathMs
      const breath = Math.min(BREATHS_PER_PACE - 1, Math.floor(b))
      const u = clamp(b - breath, 0, 1)
      return { slot: i, breath, u, half: halves + 2 * breath + (u < 0.5 ? 0 : 1) }
    }
    halves += 2 * BREATHS_PER_PACE
  }
  return null
}

/**
 * Mean camera pulse quality between two times, or null when there is too little to judge.
 * The estimator reports exactly 0 until it has its first six seconds of signal; those rows say nothing about
 * the light, so they are left out, but what is left must still cover half the window.
 */
function qualityBetween(log: PulseLog, t0: number, t1: number): number | null {
  const warm = log.quality.findIndex((q) => q > 0)
  if (warm < 0) return null
  const from = Math.max(t0, log.t[warm]!)
  if (t1 - from < 0.5 * (t1 - t0)) return null
  const qs: number[] = []
  for (let i = warm; i < log.t.length; i++) {
    if (log.t[i]! >= from && log.t[i]! < t1) qs.push(log.quality[i]!)
  }
  return qs.length ? mean(qs) : null
}

function between(t: number[], v: number[], t0: number, t1: number): { t: number[]; v: number[] } {
  const out = { t: [] as number[], v: [] as number[] }
  for (let i = 0; i < t.length; i++) {
    if (t[i]! < t0 || t[i]! >= t1) continue
    out.t.push(t[i]!)
    out.v.push(v[i]!)
  }
  return out
}

export interface Swing {
  swingBpm: number
  /** one standard error of it */
  se: number
}

/** the ping's first gate: the camera pulse was clean and the face still, on average, between the two times */
function passesQuality(log: PulseLog, t0: number, t1: number): boolean {
  const quality = qualityBetween(log, t0, t1)
  return quality != null && quality >= HEART_MIN_QUALITY
}

/** a fit is shown only when its standard error is inside the ping's bound */
const trusted = (fit: { swingBpm: number; se: number } | null): Swing | null =>
  fit && fit.se <= HEART_MAX_SWING_SE ? { swingBpm: fit.swingBpm, se: fit.se } : null

/**
 * The heart-rate swing over one pace's breaths (absolute ms on the pulse clock), or null when it cannot be trusted.
 * Camera: the ping's gates, in the ping's order: mean quality at or above HEART_MIN_QUALITY, an unbroken pulse run
 * over at least HEART_MIN_SWING_COVER of the breaths, beats from the pulse wave, the lock-in fit, and a standard
 * error of at most HEART_MAX_SWING_SE. AirPods: their rate samples go into the same fit, under the same bound.
 */
export function readSwing(log: PulseLog, wave: WaveSeries, t0: number, t1: number, breathMs: number): Swing | null {
  const air = between(log.airT, log.airBpm, t0, t1)
  if (air.t.length) return trusted(lockedSwing(air.t, air.v, t0, breathMs))
  if (!passesQuality(log, t0, t1)) return null
  const run = analyzePulseWindow(wave.t, wave.v, [t0, t1])
  if (!run || !coversBreaths(run, [t0, t1])) return null
  const beats = beatSeries(run)
  if (!beats) return null
  return trusted(lockedSwing(beats.rateT, beats.rate, t0, breathMs))
}

export function readPace(log: PulseLog, wave: WaveSeries, slot: PaceSlot, doseStart: number): PaceRead {
  const fit = readSwing(log, wave, doseStart + slot.startMs, doseStart + slot.endMs, slot.breathMs)
  return { pace: slot.pace, swingBpm: fit ? fit.swingBpm : null, se: fit ? fit.se : null }
}

export interface LiveRate {
  /** ms on the pulse clock */
  t: number[]
  bpm: number[]
}

/**
 * The beat-to-beat heart rate over the last 20 s for the live line, or null when the pulse does not pass the
 * gate right now. `wave` is the pulse wave over those 20 s.
 */
export function liveRate(log: PulseLog, wave: WaveSeries, now: number): LiveRate | null {
  const air = between(log.airT, log.airBpm, now - LIVE_WINDOW_MS, now + 1)
  if (air.t.length) return now - air.t[air.t.length - 1]! < 6000 ? { t: air.t, bpm: air.v } : null
  if (!passesQuality(log, now - 5000, now + 1)) return null
  const run = analyzePulseWindow(wave.t, wave.v, [now - LIVE_WINDOW_MS, now + 1], 6)
  if (!run) return null
  const beats = beatSeries(run)
  if (!beats || now - beats.t[beats.t.length - 1]! > 4000) return null
  return { t: beats.t, bpm: beats.bpm }
}

/** the pace with the largest swing; the earlier one when two are level */
export function bestRead(reads: PaceRead[]): PaceRead | null {
  let best: PaceRead | null = null
  for (const r of reads) {
    if (r.swingBpm == null) continue
    if (!best || r.swingBpm > best.swingBpm!) best = r
  }
  return best
}

const readCount = (reads: PaceRead[]) => reads.filter((r) => r.swingBpm != null).length

/** Tomorrow's centre. One pace alone cannot be called the best of anything, so it changes nothing. */
export function nextCentre(reads: PaceRead[], centre: number): number {
  const best = bestRead(reads)
  return best && readCount(reads) >= 2 ? best.pace : centre
}

const beats = (swing: number) => plural(Math.round(swing), 'beat')

/** the error bar as it is said: one standard error, rounded up to a whole beat */
export const giveOrTake = (se: number) => Math.max(1, Math.ceil(se))

/** "12 beats, give or take 1" */
const swingWords = (read: PaceRead) => `${beats(read.swingBpm!)}, give or take ${giveOrTake(read.se ?? 0)}`

export function breatheEndLine(reads: PaceRead[], source: 'camera' | 'airpods'): string {
  const best = bestRead(reads)
  if (!best) {
    return source === 'airpods'
      ? 'Your AirPods didn’t send enough heartbeats, so this was a plain pacer today.'
      : 'I couldn’t read your pulse in this light, so this was a plain pacer today.'
  }
  const pace = best.pace.toFixed(1)
  if (readCount(reads) < 2) return `Your heart swung ${swingWords(best)}, at ${pace} breaths a minute. That was the one pace I could read.`
  return `Your heart swung most at ${pace} breaths a minute: ${swingWords(best)}. Tomorrow starts there.`
}

export function breatheMetrics(reads: PaceRead[], centre: number, breaths: number): Record<string, number> {
  const best = bestRead(reads)
  const m: Record<string, number> = { breaths, pacesRead: readCount(reads), breathsPerMin: nextCentre(reads, centre) }
  if (best) {
    m.swingBpm = round1(best.swingBpm!)
    m.swingSe = round1(best.se ?? 0)
    // the error bar as the end line said it; rounding `swingSe` again can land a beat lower
    m.giveOrTake = giveOrTake(best.se ?? 0)
    // the pace that swing was read at; `breathsPerMin` is where tomorrow starts, which one pace alone does not move
    m.swingPace = best.pace
  }
  reads.forEach((r, i) => {
    m[`pace${i + 1}`] = r.pace
    if (r.swingBpm != null) m[`swing${i + 1}`] = round1(r.swingBpm)
  })
  return m
}
