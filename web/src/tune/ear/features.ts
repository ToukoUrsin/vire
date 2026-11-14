// What one moment of AirPods motion looks like to the ear model.
// Two kinds of numbers: how the head is moving right now (per channel, over a short window), and how the
// AirPods' angles have shifted against a second or three ago. The second kind is what a smile leaves: the
// cheek pushes the AirPod a couple of degrees and it stays there until the face lets go.
import type { EarRecording } from '@shared/ear'

/** 'raw' is not a set of numbers worked out by hand: it is the motion itself, 50 times a second, for a small conv net */
export type FeatureSubset = 'all' | 'rotation' | 'attitude' | 'acceleration' | 'motion' | 'posture' | 'raw'
export interface EarFeatureWindow { t: number; start: number; end: number; index: number; x: number[] }

type Group = 'att' | 'acc' | 'gyr' | 'post' | 'energy'
const GROUPS: Record<FeatureSubset, Group[]> = {
  all: ['att', 'acc', 'gyr', 'post', 'energy'],
  motion: ['att', 'acc', 'energy'],
  rotation: ['gyr', 'energy'],
  attitude: ['att', 'post'],
  acceleration: ['acc', 'energy'],
  posture: ['post', 'energy'],
  raw: [],
}
const CHANNELS: Record<'att' | 'acc' | 'gyr', number[]> = { att: [0, 1, 2], acc: [3, 4, 5], gyr: [6, 7, 8] }
/** below this a channel is just sensor noise: degrees, g, degrees a second */
const FLOOR: Record<'att' | 'acc' | 'gyr', number> = { att: 0.02, acc: 0.0005, gyr: 0.1 }
/** how far back the angle shift looks, in seconds */
export const LAGS = [1, 2, 3]
const LAG_MEAN_MS = 400
/** ms of history a reader has to keep to compute any vector */
export const CONTEXT_MS = LAGS[LAGS.length - 1] * 1000 + LAG_MEAN_MS + 200
/** one vector every this many ms */
export const STRIDE_MS = 100

const finite = (v: number) => Number.isFinite(v) ? v : 0

export function unwrapYaw(rows: number[][]): number[] {
  if (!rows.length) return []
  const out = [finite(rows[0][2])]
  for (let i = 1; i < rows.length; i++) {
    let d = finite(rows[i][2]) - finite(rows[i - 1][2])
    while (d > 180) d -= 360
    while (d < -180) d += 360
    out.push(out[i - 1] + d)
  }
  return out
}

/** Nine channels in the fixed order: pitch, yaw, roll, ax, ay, az, rx, ry, rz. */
export function channelsFromRows(rows: number[][], gyro: boolean): number[][] {
  const yaw = unwrapYaw(rows)
  const out: number[][] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    let rx = finite(r[7]); let ry = finite(r[8]); let rz = finite(r[9])
    if (!gyro) {
      if (i > 0) {
        const dt = Math.max(0.001, (r[0] - rows[i - 1][0]) / 1000)
        rx = (finite(r[1]) - finite(rows[i - 1][1])) / dt
        ry = (yaw[i] - yaw[i - 1]) / dt
        rz = (finite(r[3]) - finite(rows[i - 1][3])) / dt
      } else { rx = 0; ry = 0; rz = 0 }
    }
    out.push([finite(r[1]), yaw[i], finite(r[3]), finite(r[4]), finite(r[5]), finite(r[6]), rx, ry, rz])
  }
  return out
}

/** first index whose time is >= t (rows are in time order) */
function lower(ts: number[], t: number, hi = ts.length): number {
  let lo = 0
  while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m }
  return lo
}

function meanOf(ch: number[][], col: number, i0: number, i1: number): number {
  let s = 0
  for (let i = i0; i <= i1; i++) s += ch[i][col]
  return s / Math.max(1, i1 - i0 + 1)
}

/** spread, speed, how often it turns and how far it swings: one channel over one window, straight line removed */
function channelStats(ch: number[][], ts: number[], col: number, i0: number, i1: number, floor: number): number[] {
  const n = i1 - i0 + 1
  if (n < 3) return [Math.log(floor), Math.log(floor), 0, Math.log(floor)]
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0
  for (let i = i0; i <= i1; i++) { const x = i - i0; const y = ch[i][col]; sx += x; sy += y; sxx += x * x; sxy += x * y }
  const den = n * sxx - sx * sx
  const slope = den ? (n * sxy - sx * sy) / den : 0
  const icpt = (sy - slope * sx) / n
  let ss = 0; let min = Infinity; let max = -Infinity; let turns = 0; let prev = 0; let rate = 0
  for (let i = i0; i <= i1; i++) {
    const d = ch[i][col] - (icpt + slope * (i - i0))
    ss += d * d
    if (d < min) min = d
    if (d > max) max = d
    if (i > i0) {
      if (prev * d < 0) turns++
      const dt = Math.max(0.001, (ts[i] - ts[i - 1]) / 1000)
      const v = (ch[i][col] - ch[i - 1][col]) / dt
      rate += v * v
    }
    prev = d
  }
  const secs = Math.max(0.05, (ts[i1] - ts[i0]) / 1000)
  return [Math.log(Math.sqrt(ss / n) + floor), Math.log(Math.sqrt(rate / (n - 1)) + floor * 10), turns / secs, Math.log(max - min + floor)]
}

const SIZE: Record<Group, number> = { att: 12, acc: 12, gyr: 12, post: LAGS.length * 6, energy: 6 }
/** where a subset's numbers sit inside the 'all' vector, in the subset's own order */
export function subsetColumns(subset: FeatureSubset): number[] {
  const at: Partial<Record<Group, number>> = {}
  let n = 0
  for (const g of GROUPS.all) { at[g] = n; n += SIZE[g] }
  return GROUPS[subset].flatMap(g => Array.from({ length: SIZE[g] }, (_, i) => at[g]! + i))
}

/** samples a second in a raw window, whatever the AirPods sent */
export const RAW_HZ = 50
/** the nine channels of `channelsFromRows` */
export const RAW_CH = 9
const RAW_LEAD = 10

/**
 * The motion itself over the last `seconds`, laid on an even grid of RAW_HZ samples a second (time by channel,
 * time first). The three angles are given against where they were as the window began, so a shift inside the
 * window shows as a shift and where the head happens to point does not.
 */
export function rawAt(ch: number[][], ts: number[], end: number, seconds: number): number[] {
  const len = Math.round(seconds * RAW_HZ)
  const out = new Array<number>(len * RAW_CH)
  const t = ts[end]
  let i = lower(ts, t - (len - 1) * (1000 / RAW_HZ), end + 1)
  for (let k = 0; k < len; k++) {
    const at = t - (len - 1 - k) * (1000 / RAW_HZ)
    while (i < end && ts[i] < at) i++
    const a = i > 0 ? i - 1 : 0
    const span = ts[i] - ts[a]
    const f = span > 0 ? Math.max(0, Math.min(1, (at - ts[a]) / span)) : 1
    for (let c = 0; c < RAW_CH; c++) out[k * RAW_CH + c] = ch[a][c] + (ch[i][c] - ch[a][c]) * f
  }
  const lead = Math.min(RAW_LEAD, len)
  for (let c = 0; c < 3; c++) {
    let m = 0
    for (let k = 0; k < lead; k++) m += out[k * RAW_CH + c]
    m /= lead
    for (let k = 0; k < len; k++) out[k * RAW_CH + c] -= m
  }
  return out
}

/**
 * The vector for the moment `ts[end]`: the last `seconds` of movement plus the angle shifts against a few
 * seconds back. `ch` and `ts` may hold more history than the window; the shifts read up to CONTEXT_MS back.
 */
export function vectorAt(ch: number[][], ts: number[], end: number, seconds: number, subset: FeatureSubset = 'all'): number[] {
  if (subset === 'raw') return rawAt(ch, ts, end, seconds)
  const t = ts[end]
  const i0 = lower(ts, t - seconds * 1000, end + 1)
  const out: number[] = []
  for (const g of GROUPS[subset]) {
    if (g === 'att' || g === 'acc' || g === 'gyr') {
      for (const col of CHANNELS[g]) out.push(...channelStats(ch, ts, col, i0, end, FLOOR[g]))
    } else if (g === 'post') {
      const n0 = lower(ts, t - LAG_MEAN_MS, end + 1)
      const now = [0, 1, 2].map(c => meanOf(ch, c, n0, end))
      const shifts: number[] = []
      for (const lag of LAGS) {
        const a = lower(ts, t - lag * 1000 - LAG_MEAN_MS, end + 1)
        const b = lower(ts, t - lag * 1000, end + 1) - 1
        for (const c of [0, 1, 2]) shifts.push(b >= a ? now[c] - meanOf(ch, c, a, b) : 0)
      }
      out.push(...shifts, ...shifts.map(Math.abs))
    } else {
      // how hard the head shakes and turns, with the squares so a model can ask for "some, but not a lot"
      const n = end - i0 + 1
      const m = [3, 4, 5].map(c => meanOf(ch, c, i0, end))
      let acc = 0; let gyr = 0; let gNow = 0; let nNow = 0
      const s0 = lower(ts, t - LAG_MEAN_MS, end + 1)
      for (let i = i0; i <= end; i++) {
        const r = ch[i]
        acc += (r[3] - m[0]) ** 2 + (r[4] - m[1]) ** 2 + (r[5] - m[2]) ** 2
        const g2 = r[6] * r[6] + r[7] * r[7] + r[8] * r[8]
        gyr += g2
        if (i >= s0) { gNow += g2; nNow++ }
      }
      const la = Math.log(Math.sqrt(acc / Math.max(1, n)) + 0.001)
      const lg = Math.log(Math.sqrt(gyr / Math.max(1, n)) + 0.3)
      const ls = Math.log(Math.sqrt(gNow / Math.max(1, nNow)) + 0.3)
      out.push(la, la * la, lg, lg * lg, la * lg, ls)
    }
  }
  return out
}

/** The vector for the last row of `rows` (a reader's buffer). `hz` is kept for older callers and not used. */
export function featureVector(rows: number[][], gyro: boolean, subset: FeatureSubset = 'all', _hz = 25, seconds = 1): number[] {
  if (!rows.length) return []
  return vectorAt(channelsFromRows(rows, gyro), rows.map(r => r[0]), rows.length - 1, seconds, subset)
}

/** One vector every STRIDE_MS once the requested window is full. `index` is the AirPods row it ends on. */
export function buildFeatureWindows(rec: EarRecording, seconds: number, subset: FeatureSubset = 'all'): EarFeatureWindow[] {
  const rows = rec.head
  if (rows.length < 3) return []
  const ch = channelsFromRows(rows, rec.device.gyro)
  const ts = rows.map(r => r[0])
  const out: EarFeatureWindow[] = []
  const ms = seconds * 1000
  let next = ts[0] + ms * 0.92
  for (let end = 0; end < rows.length; end++) {
    if (ts[end] < next) continue
    next = Math.max(next + STRIDE_MS, ts[end] - STRIDE_MS / 2 + STRIDE_MS)
    out.push({ t: ts[end], start: ts[end] - ms, end: ts[end], index: end, x: vectorAt(ch, ts, end, seconds, subset) })
  }
  return out
}

export const extractEarFeatures = featureVector
export const makeFeatureWindows = buildFeatureWindows
export const extractFeatures = featureVector
