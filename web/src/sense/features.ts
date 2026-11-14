// Ping feature math. Pure functions over arrays (times in ms on one clock), so they run in tests without a browser.
// Definitions follow shared/types.ts and "Ping protocol v1" in CONTRACT.md.

import type { HeartFeatures, MoveFeatures, MoveSource, PhaseKey, PingFeatures, PingTraces, SmileFeatures, VoiceFeatures } from '@shared/types'
import { bandpassZeroPhase, clamp, contiguousRuns, lowpassZeroPhase, mean, median, percentile, resampleUniform, snrToQuality, spectralPeak, std } from './dsp'

/** [start, end) in ms */
export type Win = [number, number]

const inWin = (t: number, w: Win) => t >= w[0] && t < w[1]
const round = (x: number, d: number) => {
  const k = 10 ** d
  return Math.round(x * k) / k
}

// ---------------------------------------------------------------- smile

/** A smile is timed only after the tuned smile value rises clearly above this person's own resting noise and stays there for a short stretch. */
export const SMILE_ONSET_DELTA = 0.15
export const SMILE_ONSET_HOLD_MS = 120
/** Nobody answers a sound with a smile sooner than this: a rise before it was already on its way, so it is not timed against the laugh. */
export const SMILE_MIN_LATENCY_MS = 200
/** below this peak there is no smile to time */
const SMILE_MIN_PEAK = 0.05

export interface SmileInput {
  /** frames with a face present */
  t: number[]
  smile: number[]
  cheek: number[]
  settle: Win | null
  laugh: Win | null
  /** when the laughter started (same clock); null = unknown, the laugh phase start is used */
  laughOnsetT: number | null
}

export function smileFeatures(inp: SmileInput): SmileFeatures {
  const out: SmileFeatures = { latencyMs: null, peak: 0, auc: 0, duchenne: 0, durationMs: 0, baseline: 0 }
  const { t, smile, cheek, settle, laugh } = inp
  const pick = (w: Win) => {
    const idx: number[] = []
    for (let i = 0; i < t.length; i++) if (inWin(t[i], w)) idx.push(i)
    return idx
  }
  const li = laugh ? pick(laugh) : []
  const onset = inp.laughOnsetT ?? (laugh ? laugh[0] : 0)

  // resting level: settle if it happened, else the moment before the laughter, else the low end of the phase
  let baseline: number | null = null
  if (settle) {
    const si = pick(settle)
    if (si.length >= 3) baseline = median(si.map((i) => smile[i]))
  }
  if (baseline === null && laugh) {
    const pre = li.filter((i) => t[i] < onset)
    if (pre.length >= 3) baseline = median(pre.map((i) => smile[i]))
    else if (li.length) baseline = percentile(li.map((i) => smile[i]), 0.1)
  }
  out.baseline = round(baseline ?? 0, 4)
  if (!laugh || li.length < 3 || baseline === null) return out

  const tt = li.map((i) => t[i])
  // 3-frame median removes single-frame blendshape spikes
  const rel = li.map((i, k) => {
    const a = smile[li[Math.max(0, k - 1)]]
    const b = smile[i]
    const c = smile[li[Math.min(li.length - 1, k + 1)]]
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)) - baseline
  })
  const n = rel.length
  const restValues = settle ? pick(settle).map((i) => smile[i]) : li.filter((i) => t[i] < onset).map((i) => smile[i])
  const restNoise = restValues.length >= 3 ? median(restValues.map((v) => Math.abs(v - baseline))) * 1.4826 : 0
  const onsetDelta = Math.max(SMILE_ONSET_DELTA, restNoise * 4)
  const wasSmilingAtOnset = rel.some((v, k) => tt[k]! < onset && v > onsetDelta)

  let pk = -1
  for (let k = 0; k < n; k++) if (tt[k] >= onset && (pk < 0 || rel[k] > rel[pk])) pk = k
  if (pk < 0) for (let k = 0; k < n; k++) if (pk < 0 || rel[k] > rel[pk]) pk = k
  const peak = Math.max(0, rel[pk])
  out.peak = round(peak, 4)

  // area: positive part only, skipping stretches where the face was lost
  let auc = 0
  for (let k = 1; k < n; k++) {
    const dt = tt[k] - tt[k - 1]
    if (dt > 500) continue
    auc += ((Math.max(0, rel[k]) + Math.max(0, rel[k - 1])) / 2) * (dt / 1000)
  }
  out.auc = round(auc, 4)
  if (peak < SMILE_MIN_PEAK || peak < onsetDelta) {
    out.peak = 0
    out.auc = 0
    return out
  }

  // onset = the smile crossing 30% of its own peak, kept between 0.04 and SMILE_ONSET_DELTA,
  // so a small closed-mouth smile (peak 0.15-0.25) still gets a latency
  const delta = Math.max(onsetDelta, clamp(peak * 0.3, 0.04, SMILE_ONSET_DELTA))
  let early = false
  if (peak > delta && !wasSmilingAtOnset) {
    for (let k = 0; k < n; k++) {
      if (tt[k] < onset || rel[k] <= delta) continue
      let held = false
      for (let j = k + 1; j < n; j++) {
        if (rel[j] <= delta) break
        if (tt[j] - tt[k] >= SMILE_ONSET_HOLD_MS) {
          held = true
          break
        }
      }
      if (!held) continue
      let at = tt[k]
      if (k > 0 && tt[k - 1] >= onset && rel[k - 1] <= delta && rel[k] > rel[k - 1]) {
        at = tt[k - 1] + ((delta - rel[k - 1]) / (rel[k] - rel[k - 1])) * (tt[k] - tt[k - 1])
      }
      if (at - onset < SMILE_MIN_LATENCY_MS) early = true
      else out.latencyMs = Math.round(at - onset)
      break
    }
  }
  out.alreadySmiling = wasSmilingAtOnset || early
  if (out.latencyMs === null && !out.alreadySmiling) {
    out.peak = 0
    out.auc = 0
    return out
  }

  const near = li.filter((i) => Math.abs(t[i] - tt[pk]) <= 150)
  out.duchenne = round(clamp(mean(near.map((i) => cheek[i])), 0, 1), 4)

  const half = peak / 2
  let dur = 0
  for (let k = 1; k < n; k++) {
    const dt = tt[k] - tt[k - 1]
    if (dt > 500) continue
    const a = rel[k - 1] - half
    const b = rel[k] - half
    if (a >= 0 && b >= 0) dur += dt
    else if (a >= 0 || b >= 0) dur += dt * (Math.max(a, b) / (Math.abs(a) + Math.abs(b) || 1))
  }
  out.durationMs = Math.round(dur)
  return out
}

// ---------------------------------------------------------------- head: nod + restlessness

/** an excursion smaller than this is not a nod */
export const NOD_MIN_DEG = 3
const HEAD_FS = 30
const HEAD_LP_HZ = 5

/** prominence of every strict local maximum of x */
function peakProminences(x: ArrayLike<number>): { i: number; prom: number }[] {
  const out: { i: number; prom: number }[] = []
  const n = x.length
  for (let i = 1; i < n - 1; i++) {
    if (!(x[i] > x[i - 1] && x[i] >= x[i + 1])) continue
    let lmin = x[i]
    for (let j = i - 1; j >= 0 && x[j] <= x[i]; j--) if (x[j] < lmin) lmin = x[j]
    let rmin = x[i]
    for (let j = i + 1; j < n && x[j] <= x[i]; j++) if (x[j] < rmin) rmin = x[j]
    out.push({ i, prom: x[i] - Math.max(lmin, rmin) })
  }
  return out
}

function unwrapDeg(a: ArrayLike<number>): Float64Array {
  const out = new Float64Array(a.length)
  let off = 0
  for (let i = 0; i < a.length; i++) {
    if (i > 0) {
      const d = a[i] - a[i - 1]
      if (d > 180) off -= 360
      else if (d < -180) off += 360
    }
    out[i] = a[i] + off
  }
  return out
}

function smoothAngle(t: number[], a: number[]): Float64Array | null {
  if (t.length < 8 || t[t.length - 1] - t[0] < 600) return null
  const r = resampleUniform(t, unwrapDeg(a), HEAD_FS)
  return lowpassZeroPhase(r.v, HEAD_FS, HEAD_LP_HZ)
}

function velocity(x: Float64Array): Float64Array {
  const v = new Float64Array(x.length)
  for (let i = 1; i < x.length - 1; i++) v[i] = ((x[i + 1] - x[i - 1]) / 2) * HEAD_FS
  return v
}

/** nods from head pitch (deg) over the nod phase. Sign convention does not matter. */
export function nodFeatures(t: number[], pitch: number[]): Pick<MoveFeatures, 'nodAmplitudeDeg' | 'nodPeakVelDegS' | 'nodCount'> {
  const x = smoothAngle(t, pitch)
  if (!x) return { nodAmplitudeDeg: null, nodPeakVelDegS: null, nodCount: 0 }
  const v = velocity(x)
  let peakVel = 0
  for (let i = 0; i < v.length; i++) if (Math.abs(v[i]) > peakVel) peakVel = Math.abs(v[i])
  const neg = x.map((y) => -y)
  const peaks = peakProminences(x).filter((p) => p.prom >= NOD_MIN_DEG)
  const troughs = peakProminences(neg).filter((p) => p.prom >= NOD_MIN_DEG)
  const count = Math.max(peaks.length, troughs.length)
  let amp = 0
  for (const p of peaks) if (p.prom > amp) amp = p.prom
  for (const p of troughs) if (p.prom > amp) amp = p.prom
  if (count === 0) {
    // no nod: report how far the head did move, so a flat answer is a small number and not a gap
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < x.length; i++) {
      if (x[i] < lo) lo = x[i]
      if (x[i] > hi) hi = x[i]
    }
    amp = hi - lo
  }
  return { nodAmplitudeDeg: round(amp, 2), nodPeakVelDegS: round(peakVel, 1), nodCount: count }
}

/** RMS head angular velocity (deg/s) over the given windows */
export function restlessness(t: number[], pitch: number[], yaw: number[], roll: number[], windows: Win[]): number {
  let sum = 0
  let cnt = 0
  for (const w of windows) {
    const idx: number[] = []
    for (let i = 0; i < t.length; i++) if (inWin(t[i], w)) idx.push(i)
    for (const [a, b] of contiguousRuns(idx.map((i) => t[i]), 500)) {
      const ii = idx.slice(a, b)
      const tt = ii.map((i) => t[i])
      const p = smoothAngle(tt, ii.map((i) => pitch[i]))
      const y = smoothAngle(tt, ii.map((i) => yaw[i]))
      const r = smoothAngle(tt, ii.map((i) => roll[i]))
      if (!p || !y || !r) continue
      const vp = velocity(p)
      const vy = velocity(y)
      const vr = velocity(r)
      for (let i = 1; i < vp.length - 1; i++) {
        sum += vp[i] * vp[i] + vy[i] * vy[i] + vr[i] * vr[i]
        cnt++
      }
    }
  }
  return cnt ? round(Math.sqrt(sum / cnt), 2) : 0
}

// ---------------------------------------------------------------- voice

/** a silence between two stretches of speech longer than this is a pause */
export const PAUSE_MIN_MS = 250
const SYLLABLE_MIN_DIP_DB = 2

export function voiceFeatures(t: number[], rms: number[], voiced: boolean[], f0: (number | null)[], win: Win | null): VoiceFeatures {
  const out: VoiceFeatures = { speechFraction: 0, pauseCount: 0, meanPauseMs: 0, f0MedianHz: null, f0SdSemitones: null, loudnessSdDb: 0, syllableRateHz: null }
  if (!win) return out
  const idx: number[] = []
  for (let i = 0; i < t.length; i++) if (inWin(t[i], win)) idx.push(i)
  const n = idx.length
  if (n < 10) return out
  const tt = idx.map((i) => t[i])
  const dt = median(tt.slice(1).map((x, k) => x - tt[k])) || 20
  // drop one-frame blips, fill one-frame holes
  const v = idx.map((i) => voiced[i])
  for (let k = 1; k < n - 1; k++) {
    if (v[k] && !voiced[idx[k - 1]] && !voiced[idx[k + 1]]) v[k] = false
    else if (!v[k] && voiced[idx[k - 1]] && voiced[idx[k + 1]]) v[k] = true
  }
  const nv = v.reduce((s, x) => s + (x ? 1 : 0), 0)
  out.speechFraction = round(nv / n, 4)
  if (nv === 0) return out

  // voiced runs -> pauses between them
  const runs: [number, number][] = []
  for (let k = 0; k < n; k++) {
    if (!v[k]) continue
    let e = k
    while (e + 1 < n && v[e + 1]) e++
    runs.push([k, e])
    k = e
  }
  const pauses: number[] = []
  for (let r = 1; r < runs.length; r++) {
    const gap = tt[runs[r][0]] - tt[runs[r - 1][1]] - dt
    if (gap > PAUSE_MIN_MS) pauses.push(gap)
  }
  out.pauseCount = pauses.length
  out.meanPauseMs = pauses.length ? Math.round(mean(pauses)) : 0

  const f = idx.filter((i, k) => v[k] && f0[i] !== null).map((i) => f0[i] as number)
  if (f.length >= 10) {
    const med = median(f)
    // an octave slip is exactly 12 st away: leave those frames out of the spread
    const st = f.map((x) => 12 * Math.log2(x / med)).filter((s) => Math.abs(s) < 9)
    out.f0MedianHz = round(med, 1)
    if (st.length >= 10) out.f0SdSemitones = round(std(st), 3)
  }

  const lv = idx.filter((_, k) => v[k]).map((i) => rms[i])
  if (lv.length >= 5) out.loudnessSdDb = round(std(lv), 2)

  // syllable nuclei: peaks of the smoothed intensity contour that sit in voiced speech and
  // stand at least 2 dB above the dips around them (de Jong & Wempe 2009)
  const speakMs = tt[runs[runs.length - 1][1]] - tt[runs[0][0]] + dt - pauses.reduce((s, x) => s + x, 0)
  if (speakMs >= 1000) {
    const fs = 1000 / dt
    const env = lowpassZeroPhase(resampleUniform(tt, idx.map((i) => Math.max(-90, rms[i])), fs).v, fs, Math.min(8, fs * 0.4))
    const top = percentile(lv, 0.95)
    let nuclei = 0
    let k = 0
    for (const p of peakProminences(env)) {
      if (p.prom < SYLLABLE_MIN_DIP_DB || env[p.i] < top - 25) continue
      const at = tt[0] + p.i * dt
      while (k < n - 1 && tt[k + 1] <= at) k++
      if (v[k] || v[Math.max(0, k - 1)] || v[Math.min(n - 1, k + 1)]) nuclei++
    }
    if (nuclei >= 2) out.syllableRateHz = round(nuclei / (speakMs / 1000), 2)
  }
  return out
}

// ---------------------------------------------------------------- heart

const PULSE_LO = 0.7
const PULSE_HI = 3.0
/** below this the camera pulse is not reported */
export const HEART_MIN_QUALITY = 0.3
/** do not show a swing whose lock-in standard error is larger than this */
export const HEART_MAX_SWING_SE = 2
/**
 * and only when the pulse was followed through nearly all of the paced breaths. A face lost for a second restarts
 * the pulse; what is left is too short to tell a breath from a drift (validation/README.md, dropouts).
 */
export const HEART_MIN_SWING_COVER = 0.9

/** true when the unbroken pulse run covers enough of the window to read a swing from it */
export function coversBreaths(w: PulseWindow, win: Win): boolean {
  return (w.x.length / w.fs) * 1000 >= HEART_MIN_SWING_COVER * (win[1] - win[0])
}

export interface PulseWindow {
  /** grid start (ms) and rate of x */
  t0: number
  fs: number
  /** POS pulse wave on a uniform grid */
  x: Float64Array
  /** mean rate from the spectral peak */
  bpm: number
  /** 0..1 from the spectral SNR */
  snrQuality: number
}

/** spectral heart rate of the longest unbroken stretch of the pulse wave inside a window */
export function analyzePulseWindow(t: number[], v: number[], win: Win, minS = 5): PulseWindow | null {
  const idx: number[] = []
  for (let i = 0; i < t.length; i++) if (inWin(t[i], win)) idx.push(i)
  if (idx.length < 2) return null
  const tt = idx.map((i) => t[i])
  let best: [number, number] | null = null
  for (const r of contiguousRuns(tt, 150)) if (!best || r[1] - r[0] > best[1] - best[0]) best = r
  if (!best) return null
  const st = tt.slice(best[0], best[1])
  if (st[st.length - 1] - st[0] < minS * 1000) return null
  const fs = 30
  const r = resampleUniform(st, idx.slice(best[0], best[1]).map((i) => v[i]), fs)
  const pk = spectralPeak(r.v, fs, PULSE_LO, PULSE_HI)
  if (!pk) return null
  return { t0: r.t0, fs, x: r.v, bpm: pk.freq * 60, snrQuality: snrToQuality(pk.snrDb) }
}

export interface BeatSeries {
  /** beat (pulse peak) times, ms */
  beats: number[]
  /** smoothed instantaneous heart rate on a 4 Hz grid */
  t: number[]
  bpm: number[]
  /** max - min of the smoothed rate: kept for the trace and for comparison, not used by the echo */
  swingBpm: number
  meanBpm: number
  /** beat-to-beat rates before smoothing (ms, bpm), impossible intervals dropped */
  rateT: number[]
  rate: number[]
}

/** The ping paces the breath: 5 s in, 5 s out. */
export const BREATH_PERIOD_MS = 10000

export interface LockedSwing {
  /** peak to trough of the part of the heart rate that moves with the paced breath, bpm */
  swingBpm: number
  /** one standard error of that swing, bpm */
  se: number
  /** 0..1: how much of the rate's movement is the breath (the rest is noise and drift) */
  lock: number
  /** seconds into the breath where the rate is highest (it should be near the end of the in-breath) */
  peakAtS: number
  /** rates used, and how many of them the fit set aside as misread beats */
  n: number
  dropped: number
}

function solve(A: number[][], y: number[]): number[] | null {
  const n = y.length
  const M = A.map((r, i) => [...r, y[i]!])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r
    if (Math.abs(M[p]![c]!) < 1e-9) return null
    ;[M[c], M[p]] = [M[p]!, M[c]!]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r]![c]! / M[c]![c]!
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!
    }
  }
  return M.map((r, i) => r[n]! / r[i]!)
}

/** inverse of a small symmetric matrix, by solving for each unit vector */
function invert(A: number[][]): number[][] | null {
  const n = A.length
  const cols: number[][] = []
  for (let c = 0; c < n; c++) {
    const e = new Array<number>(n).fill(0)
    e[c] = 1
    const x = solve(A, e)
    if (!x) return null
    cols.push(x)
  }
  return A.map((_, r) => cols.map((col) => col[r]!))
}

interface RobustFit {
  beta: number[]
  /** covariance of beta */
  cov: number[][]
  /** weighted residual variance */
  var_: number
  kept: number
}

/** least squares with bisquare weights: points far off the fit (misread beats) are set aside */
function robustFit(X: number[][], y: number[], floor: number): RobustFit | null {
  const n = y.length
  const k = X[0]!.length
  let wt = new Array<number>(n).fill(1)
  let beta: number[] | null = null
  let res: number[] = []
  let A: number[][] = []
  for (let it = 0; it < 8; it++) {
    A = Array.from({ length: k }, () => new Array<number>(k).fill(0))
    const b = new Array<number>(k).fill(0)
    for (let i = 0; i < n; i++) {
      for (let p = 0; p < k; p++) {
        b[p]! += wt[i]! * X[i]![p]! * y[i]!
        for (let q = 0; q < k; q++) A[p]![q]! += wt[i]! * X[i]![p]! * X[i]![q]!
      }
    }
    beta = solve(A, b)
    if (!beta) return null
    res = y.map((v, i) => v - X[i]!.reduce((acc, x, p) => acc + x * beta![p]!, 0))
    if (it === 7) break
    const scale = Math.max(floor, 1.4826 * median(res.map(Math.abs)))
    wt = res.map((r) => {
      const u = r / (4.685 * scale)
      return Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0
    })
  }
  if (!beta) return null
  const kept = wt.filter((x) => x > 0).length
  const sw = wt.reduce((a, b) => a + b, 0)
  if (sw <= k + 1) return null
  const inv = invert(A)
  if (!inv) return null
  const var_ = res.reduce((a, r, i) => a + wt[i]! * r * r, 0) / (sw - k)
  return { beta, cov: inv.map((row) => row.map((v) => v * var_)), var_, kept }
}

interface BeatChain {
  /** beat times, ms */
  t: number[]
  /** how many beats have gone by at each of them */
  k: number[]
  /** a new segment starts where the count across a hole cannot be known */
  seg: number[]
}

/**
 * Beat-to-beat rates back to the beats they came from. Each rate sits at the middle of its interval, so its two
 * beats are half an interval either side. Where an interval was dropped as impossible the hole is counted in
 * beats when it is close to a whole number of them, and starts a new segment when it is not.
 * Null when the rates are samples of a rate (AirPods) and not beat intervals.
 */
function chainBeats(t: number[], bpm: number[]): BeatChain | null {
  const n = t.length
  const ibi = bpm.map((v) => 60000 / v)
  const med = median(ibi)
  const bt = [t[0]! - ibi[0]! / 2, t[0]! + ibi[0]! / 2]
  const k = [0, 1]
  const seg = [0, 0]
  let s = 0
  let joined = 0
  for (let i = 1; i < n; i++) {
    const from = t[i]! - ibi[i]! / 2
    const to = t[i]! + ibi[i]! / 2
    const gap = from - bt[bt.length - 1]!
    if (Math.abs(gap) < 3) {
      joined++
    } else {
      const m = gap / med
      const whole = Math.round(m)
      if (whole < 1 || Math.abs(m - whole) > 0.25) s++
      bt.push(from)
      k.push(k[k.length - 1]! + Math.max(1, whole))
      seg.push(s)
    }
    bt.push(to)
    k.push(k[k.length - 1]! + 1)
    seg.push(s)
  }
  if (joined < 0.6 * (n - 1) || s > 2) return null
  return { t: bt, k, seg }
}

/**
 * The lock-in on the beats themselves. A heart rate that swings with the breath moves each beat a little early
 * or late: beat count = level + rate * time (+ drift) + A cos(wt) + B sin(wt), and the swing is 2 w sqrt(A^2 + B^2).
 * The camera's error is in when a beat is seen (tens of ms), which is white here; in beat-to-beat rates the same
 * error is doubled and alternates, which is why the rates look far noisier than the swing really is.
 */
function beatLock(c: BeatChain, t0: number, periodMs: number): LockedSwing | null {
  const n = c.t.length
  if (n < 7) return null
  const span = c.t[n - 1]! - c.t[0]!
  if (span < 0.7 * periodMs) return null
  const w0 = (2 * Math.PI) / periodMs
  // a drifting rate needs more than one breath to be told apart from the breath itself
  const drift = span >= 1.6 * periodMs
  const mid = (c.t[0]! + c.t[n - 1]!) / 2
  const segs = c.seg[n - 1]! + 1
  const X = c.t.map((ti, i) => {
    const row = new Array<number>(segs).fill(0)
    row[c.seg[i]!] = 1
    const tau = (ti - mid) / periodMs
    row.push(tau)
    if (drift) row.push(tau * tau)
    const ph = w0 * (ti - t0)
    row.push(Math.cos(ph), Math.sin(ph))
    return row
  })
  const k = X[0]!.length
  // floor: 4 ms of timing at 60 beats a minute
  const fit = robustFit(X, c.k, 0.004)
  if (!fit) return null
  if (fit.kept < 7 || fit.kept < 0.65 * n) return null
  // beats scattered by more than a fifth of a beat are not a heart
  if (Math.sqrt(fit.var_) > 0.2) return null
  const a = fit.beta[k - 2]!
  const b = fit.beta[k - 1]!
  const va = fit.cov[k - 2]![k - 2]!
  const vb = fit.cov[k - 1]![k - 1]!
  const vab = fit.cov[k - 2]![k - 1]!
  const amp2 = a * a + b * b
  const amp = Math.sqrt(Math.max(0, amp2 - va - vb))
  const seAmp = Math.sqrt(amp > 0 ? Math.max(0, a * a * va + b * b * vb + 2 * a * b * vab) / amp2 : (va + vb) / 2)
  // beats to beats a minute: d/dt of the fitted count
  const toBpm = 60000 * w0
  const meanBpm = (60000 * (c.k[n - 1]! - c.k[0]!)) / span
  const rateNoise = Math.sqrt(2 * fit.var_) * meanBpm
  const half = toBpm * amp
  let peak = (-Math.atan2(a, b) / w0) % periodMs
  if (peak < 0) peak += periodMs
  return {
    swingBpm: 2 * half,
    se: 2 * toBpm * seAmp,
    lock: half > 0 ? clamp((half * half) / 2 / ((half * half) / 2 + rateNoise * rateNoise), 0, 1) : 0,
    peakAtS: peak / 1000,
    n,
    dropped: n - fit.kept,
  }
}

/** the same lock-in on samples of a rate (AirPods give a rate, not beats) */
function rateLock(t: number[], bpm: number[], t0: number, periodMs: number): LockedSwing | null {
  const n = t.length
  const span = t[n - 1]! - t[0]!
  const w0 = (2 * Math.PI) / periodMs
  const drift = span >= 1.6 * periodMs
  const mid = (t[0]! + t[n - 1]!) / 2
  const X = t.map((ti) => {
    const ph = w0 * (ti - t0)
    return drift ? [1, (ti - mid) / periodMs, Math.cos(ph), Math.sin(ph)] : [1, Math.cos(ph), Math.sin(ph)]
  })
  const k = X[0]!.length
  const fit = robustFit(X, bpm, 0.4)
  if (!fit) return null
  if (fit.kept < 6 || fit.kept < 0.65 * n) return null
  if (Math.sqrt(fit.var_) > 5) return null
  const a = fit.beta[k - 2]!
  const b = fit.beta[k - 1]!
  const va = fit.cov[k - 2]![k - 2]!
  const vb = fit.cov[k - 1]![k - 1]!
  const amp2 = a * a + b * b
  const amp = Math.sqrt(Math.max(0, amp2 - va - vb))
  let peak = (Math.atan2(b, a) / w0) % periodMs
  if (peak < 0) peak += periodMs
  return {
    swingBpm: 2 * amp,
    se: 2 * Math.sqrt((va + vb) / 2),
    lock: amp2 > 0 ? clamp((amp * amp) / 2 / ((amp * amp) / 2 + fit.var_), 0, 1) : 0,
    peakAtS: peak / 1000,
    n,
    dropped: n - fit.kept,
  }
}

/**
 * Lock-in read of the heart-rate swing. The app paces the breath, so the period and the start are known:
 * only the part of the heart rate that moves at that period counts. Misread beats are set aside, so a few
 * dropouts cannot make a swing, and the noise that is left is taken out of the amplitude (a steady heart reads
 * near zero, not at the noise floor). Beat-to-beat rates are read on the beats (`beatLock`), samples of a
 * rate on the rates (`rateLock`). Null when there are too few beats, too many set aside, or too much scatter.
 */
export function lockedSwing(t: number[], bpm: number[], t0: number, periodMs = BREATH_PERIOD_MS): LockedSwing | null {
  const n = t.length
  if (n < 6) return null
  if (t[n - 1]! - t[0]! < 0.7 * periodMs) return null
  const chain = chainBeats(t, bpm)
  return chain ? beatLock(chain, t0, periodMs) : rateLock(t, bpm, t0, periodMs)
}

/**
 * Beat-to-beat heart rate from the pulse wave: band-pass around the mean rate, pick peaks with
 * sub-sample timing, drop impossible intervals, smooth (Gaussian, sigma 0.75 s) for the trace.
 * The swing the echo uses is `lockedSwing` on the unsmoothed rates.
 * Null when too few clean beats exist to trust it.
 */
export function beatSeries(w: PulseWindow): BeatSeries | null {
  const { fs, x, t0 } = w
  const f0 = w.bpm / 60
  const bp = bandpassZeroPhase(x, fs, Math.max(0.6, 0.6 * f0), Math.min(3.2, 1.6 * f0))
  const minDist = (0.6 / f0) * fs
  const pk: number[] = []
  for (let i = 1; i < bp.length - 1; i++) {
    if (!(bp[i] > 0 && bp[i] > bp[i - 1] && bp[i] >= bp[i + 1])) continue
    const last = pk[pk.length - 1]
    if (last !== undefined && i - last < minDist) {
      if (bp[i] > bp[last]) pk[pk.length - 1] = i
      continue
    }
    pk.push(i)
  }
  const beats = pk.map((i) => {
    const a = bp[i - 1]
    const b = bp[i]
    const c = bp[i + 1]
    const d = a - 2 * b + c
    const off = d !== 0 ? clamp((0.5 * (a - c)) / d, -0.5, 0.5) : 0
    return t0 + ((i + off) * 1000) / fs
  })
  if (beats.length < 7) return null
  const ibi = beats.slice(1).map((b, k) => b - beats[k])
  const med = median(ibi)
  const ht: number[] = []
  const hv: number[] = []
  for (let k = 0; k < ibi.length; k++) {
    if (ibi[k] < 0.65 * med || ibi[k] > 1.5 * med) continue
    ht.push((beats[k] + beats[k + 1]) / 2)
    hv.push(60000 / ibi[k])
  }
  if (hv.length < 6 || hv.length < 0.7 * ibi.length) return null
  const gfs = 4
  const g = resampleUniform(ht, hv, gfs)
  const sm = new Float64Array(g.v.length)
  const sigma = 0.75 * gfs
  const reach = Math.ceil(3 * sigma)
  for (let i = 0; i < sm.length; i++) {
    let s = 0
    let ws = 0
    for (let j = Math.max(0, i - reach); j <= Math.min(sm.length - 1, i + reach); j++) {
      const wgt = Math.exp(-((j - i) * (j - i)) / (2 * sigma * sigma))
      s += g.v[j] * wgt
      ws += wgt
    }
    sm[i] = s / ws
  }
  if (sm.length < 7 * gfs) return null
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < sm.length; i++) {
    if (sm[i] < lo) lo = sm[i]
    if (sm[i] > hi) hi = sm[i]
  }
  return {
    beats,
    t: Array.from(sm, (_, i) => g.t0 + (i * 1000) / gfs),
    bpm: Array.from(sm),
    swingBpm: hi - lo,
    meanBpm: mean(hv),
    rateT: ht,
    rate: hv,
  }
}

export interface HeartInput {
  /** camera pulse wave (POS output), ms */
  waveT: number[]
  waveV: number[]
  /** camera pulse samples: 0..1 gate (1 = still, quiet face) */
  camT: number[]
  camGate: number[]
  /** AirPods heart rate samples */
  airT: number[]
  airBpm: number[]
  settle: Win | null
  breathe: Win | null
}

/** AirPods rates during the breath: the lock-in read when there are enough samples, the plain range when sparse. */
function airSwing(inp: HeartInput, breathe: Win | null): { value: number; se: number | null } | null {
  if (!breathe) return null
  const t: number[] = []
  const v: number[] = []
  inp.airT.forEach((ti, i) => {
    if (inWin(ti, breathe)) {
      t.push(ti)
      v.push(inp.airBpm[i]!)
    }
  })
  if (v.length < 3) return null
  const ls = lockedSwing(t, v, breathe[0])
  return { value: round(ls ? ls.swingBpm : Math.max(...v) - Math.min(...v), 1), se: ls?.se ?? null }
}

export function heartFeatures(inp: HeartInput): HeartFeatures {
  const none: HeartFeatures = { restBpm: null, swingBpm: null, quality: 0, source: 'none' }
  const { settle, breathe } = inp
  if (!settle && !breathe) return none
  const air = (w: Win | null) => (w ? inp.airBpm.filter((_, i) => inWin(inp.airT[i], w)) : [])
  const airB = air(breathe)
  const airS = air(settle)

  // AirPods first: a real sensor beats the camera estimate
  if (airB.length >= 3 || (!breathe && airS.length >= 1)) {
    const rest = airS.length ? median(airS) : median(airB)
    const airSwingValue = airSwing(inp, breathe)
    return {
      restBpm: round(rest, 1),
      swingBpm: airSwingValue?.value ?? null,
      ...(airSwingValue?.se != null ? { swingSe: round(airSwingValue.se, 2) } : {}),
      quality: 1,
      source: 'airpods',
    }
  }

  const gate = (w: Win) => {
    const g = inp.camGate.filter((_, i) => inWin(inp.camT[i], w))
    return g.length ? mean(g) : 0
  }
  const b = breathe ? analyzePulseWindow(inp.waveT, inp.waveV, breathe) : null
  const s = settle ? analyzePulseWindow(inp.waveT, inp.waveV, settle) : null
  const qb = b && breathe ? b.snrQuality * gate(breathe) : 0
  const qs = s && settle ? s.snrQuality * gate(settle) : 0
  if (!b && !s) {
    // camera gave nothing; sparse AirPods samples can still give a resting rate
    const all = [...airS, ...airB]
    if (all.length) return { restBpm: round(median(all), 1), swingBpm: null, quality: 0.5, source: 'airpods' }
    return none
  }
  let swing: number | null = null
  let swingSe: number | null = null
  let beatMean: number | null = null
  if (b && qb >= HEART_MIN_QUALITY) {
    const bs = beatSeries(b)
    if (bs && breathe) {
      const ls = coversBreaths(b, breathe) ? lockedSwing(bs.rateT, bs.rate, breathe[0]) : null
      if (ls && ls.se <= HEART_MAX_SWING_SE) {
        swing = ls.swingBpm
        swingSe = ls.se
      }
      beatMean = bs.meanBpm
    }
  }
  let rest: number | null = null
  if (s && qs >= HEART_MIN_QUALITY) rest = s.bpm
  else if (b && qb >= HEART_MIN_QUALITY) rest = beatMean ?? b.bpm
  return {
    restBpm: rest === null ? null : round(rest, 1),
    swingBpm: swing === null ? null : round(swing, 1),
    ...(swingSe === null ? {} : { swingSe: round(swingSe, 2) }),
    quality: round(breathe ? qb : qs, 3),
    source: 'camera',
  }
}

// ---------------------------------------------------------------- whole ping

export interface Recording {
  /** recording start / end, ms */
  t0: number
  t1: number
  marks: { key: PhaseKey; t: number }[]
  face: { t: number[]; present: boolean[]; smile: number[]; cheek: number[]; pitch: number[]; yaw: number[]; roll: number[] }
  airHead: { t: number[]; pitch: number[]; yaw: number[]; roll: number[] }
  camPulse: { t: number[]; bpm: (number | null)[]; quality: number[]; gate: number[] }
  airPulse: { t: number[]; bpm: number[] }
  wave: { t: number[]; v: number[] }
  voice: { t: number[]; rms: number[]; voiced: boolean[]; f0: (number | null)[] }
}

export function emptyRecording(t0: number): Recording {
  return {
    t0,
    t1: t0,
    marks: [],
    face: { t: [], present: [], smile: [], cheek: [], pitch: [], yaw: [], roll: [] },
    airHead: { t: [], pitch: [], yaw: [], roll: [] },
    camPulse: { t: [], bpm: [], quality: [], gate: [] },
    airPulse: { t: [], bpm: [] },
    wave: { t: [], v: [] },
    voice: { t: [], rms: [], voiced: [], f0: [] },
  }
}

/** the first window marked with this phase, or null if it never happened */
export function phaseWindow(rec: Recording, key: PhaseKey): Win | null {
  const i = rec.marks.findIndex((m) => m.key === key)
  if (i < 0) return null
  const end = i + 1 < rec.marks.length ? rec.marks[i + 1].t : rec.t1
  return end > rec.marks[i].t ? [rec.marks[i].t, end] : null
}

function countIn(t: number[], w: Win | null): number {
  if (!w) return 0
  let c = 0
  for (let i = 0; i < t.length; i++) if (inWin(t[i], w)) c++
  return c
}

export function computePing(rec: Recording, laughOnsetT: number | null): { features: PingFeatures; traces: PingTraces } {
  const settle = phaseWindow(rec, 'settle')
  const nod = phaseWindow(rec, 'nod')
  const laugh = phaseWindow(rec, 'laugh')
  const speak = phaseWindow(rec, 'speak')
  const breathe = phaseWindow(rec, 'breathe')

  // camera frames with a face
  const fi: number[] = []
  for (let i = 0; i < rec.face.t.length; i++) if (rec.face.present[i]) fi.push(i)
  const ft = fi.map((i) => rec.face.t[i])
  const cam = {
    t: ft,
    pitch: fi.map((i) => rec.face.pitch[i]),
    yaw: fi.map((i) => rec.face.yaw[i]),
    roll: fi.map((i) => rec.face.roll[i]),
  }

  const smile = smileFeatures({
    t: ft,
    smile: fi.map((i) => rec.face.smile[i]),
    cheek: fi.map((i) => rec.face.cheek[i]),
    settle,
    laugh,
    laughOnsetT,
  })

  // head: AirPods when they cover the phase that matters, else the camera pose
  const ref = nod ?? settle ?? breathe
  const airCovers = !!ref && countIn(rec.airHead.t, ref) >= ((ref[1] - ref[0]) / 1000) * 10
  const source: MoveSource = airCovers ? 'airpods' : 'camera'
  const head = airCovers ? rec.airHead : cam
  let nodF: Pick<MoveFeatures, 'nodAmplitudeDeg' | 'nodPeakVelDegS' | 'nodCount'> = { nodAmplitudeDeg: null, nodPeakVelDegS: null, nodCount: 0 }
  if (nod) {
    const ni: number[] = []
    for (let i = 0; i < head.t.length; i++) if (inWin(head.t[i], nod)) ni.push(i)
    nodF = nodFeatures(ni.map((i) => head.t[i]), ni.map((i) => head.pitch[i]))
  }
  const restWins = [settle, breathe].filter((w): w is Win => !!w && !!nod) // mini ping: move stays at zero
  const move: MoveFeatures = {
    ...nodF,
    restlessness: restlessness(head.t, head.pitch, head.yaw, head.roll, restWins),
    source,
  }

  const voice = voiceFeatures(rec.voice.t, rec.voice.rms, rec.voice.voiced, rec.voice.f0, speak)

  const heart = heartFeatures({
    waveT: rec.wave.t,
    waveV: rec.wave.v,
    camT: rec.camPulse.t,
    camGate: rec.camPulse.gate,
    airT: rec.airPulse.t,
    airBpm: rec.airPulse.bpm,
    settle,
    breathe,
  })

  return { features: { smile, voice, heart, move }, traces: traces(rec, head, heart.source === 'airpods') }
}

function traces(rec: Recording, head: { t: number[]; pitch: number[] }, airHeart: boolean): PingTraces {
  const n = Math.max(0, Math.ceil((rec.t1 - rec.t0) / 100))
  const out: PingTraces = {
    t: [],
    smile: [],
    cheek: [],
    headPitch: [],
    bpm: [],
    rms: [],
    f0: [],
    phases: rec.marks.map((m) => ({ key: m.key, at: Math.round(m.t - rec.t0) })),
  }
  let iF = 0
  let iH = 0
  let iP = 0
  let iV = 0
  let smile = 0
  let cheek = 0
  let pitch = 0
  let bpm: number | null = null
  let bpmT = -Infinity
  const pT = airHeart ? rec.airPulse.t : rec.camPulse.t
  const hold = airHeart ? 15000 : 1500
  for (let k = 0; k < n; k++) {
    const end = rec.t0 + (k + 1) * 100
    let s = 0
    let c = 0
    let cnt = 0
    for (; iF < rec.face.t.length && rec.face.t[iF] < end; iF++) {
      if (!rec.face.present[iF]) continue
      s += rec.face.smile[iF]
      c += rec.face.cheek[iF]
      cnt++
    }
    if (cnt) {
      smile = s / cnt
      cheek = c / cnt
    }
    let hp = 0
    let hc = 0
    for (; iH < head.t.length && head.t[iH] < end; iH++) {
      hp += head.pitch[iH]
      hc++
    }
    if (hc) pitch = hp / hc
    for (; iP < pT.length && pT[iP] < end; iP++) {
      const b = airHeart ? rec.airPulse.bpm[iP] : rec.camPulse.quality[iP] >= HEART_MIN_QUALITY ? rec.camPulse.bpm[iP] : null
      if (airHeart && b === null) continue
      bpm = b
      bpmT = pT[iP]
    }
    if (end - bpmT > hold) bpm = null
    let e = 0
    let ec = 0
    const fs: number[] = []
    for (; iV < rec.voice.t.length && rec.voice.t[iV] < end; iV++) {
      e += rec.voice.rms[iV]
      ec++
      const f = rec.voice.f0[iV]
      if (rec.voice.voiced[iV] && f !== null) fs.push(f)
    }
    out.t.push(k * 100)
    out.smile.push(round(smile, 3))
    out.cheek.push(round(cheek, 3))
    out.headPitch.push(round(pitch, 1))
    out.bpm.push(bpm === null ? null : round(bpm, 1))
    out.rms.push(ec ? round(e / ec, 1) : -90)
    out.f0.push(fs.length ? round(median(fs), 1) : null)
  }
  return out
}
