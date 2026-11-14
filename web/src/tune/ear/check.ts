// How a candidate is taught and how it is checked.
// One minute: the teaching minute is the same round done three times (smile twice, nod, shake no). Three times
// over, a model is taught on two rounds and asked about the third, so every answer that is scored comes from a
// model that never saw that round.
// Two minutes or more: a model is taught on all the person's minutes but one and asked about the whole minute
// left out, once for every minute. That is the plainer test, and it is the one used as soon as it can be: as
// soon as the teacher saw the thing in two of the minutes. Seen in one minute only, that minute is checked round
// by round, and the other minutes are taught on as what the thing is not.
// A single recording without rounds (one long go at each thing) cannot be checked: cutting one bout of nodding
// into pieces and asking about the middle piece passes on anything.
import type { EarAsk, EarEvent, EarRecording, EarScore, EarStep } from '@shared/ear'
import { makeEarLabels, type EarLabels } from './labels'
import { buildFeatureWindows, CONTEXT_MS, type EarFeatureWindow, type FeatureSubset } from './features'

export type Family = 'linear' | 'logistic' | 'network' | 'tree' | 'conv'
export interface EarTreeNode { feature: number; threshold: number; left: number; right: number; value: number }
/** one layer of a small conv net over time: `w` is out by in by k, flat, `s` is the step */
export interface EarConvLayer { k: number; s: number; cin: number; cout: number; w: number[]; b: number[] }
export interface EarDet {
  family: Family
  window: number
  subset: FeatureSubset
  mean: number[]
  scale: number[]
  w?: number[]
  b?: number
  hidden?: number
  w1?: number[]
  b1?: number[]
  w2?: number[]
  b2?: number
  trees?: EarTreeNode[]
  treeCount?: number
  treeDepth?: number
  shrinkage?: number
  treeRoots?: number[]
  /** family 'conv': the layers, then one weight per pooled number (each channel's mean, then each channel's highest) */
  layers?: EarConvLayer[]
  /** who made it, in words, for the board */
  name?: string
  threshold: number
  on: number
  off: number
  how?: string
}
export interface Candidate { family: Family; window: number; subset: FeatureSubset; l2?: number; depth?: number; trees?: number; shrinkage?: number }

const HOW_ROUND = 'taught on all rounds but one, asked about the round left out'
const HOW_MINUTE = 'taught on all minutes but one, asked about the minute left out'
/** minutes are laid end to end with this much between them, so nothing is ever cut across two */
const APART_MS = 10_000_000

const windowCache = new WeakMap<EarRecording, Map<string, EarFeatureWindow[]>>()
function windowsFor(rec: EarRecording, cfg: { window: number; subset: FeatureSubset }): EarFeatureWindow[] {
  let cache = windowCache.get(rec)
  if (!cache) { cache = new Map(); windowCache.set(rec, cache) }
  const key = `${cfg.window}|${cfg.subset}`
  const hit = cache.get(key)
  if (hit) return hit
  const value = buildFeatureWindows(rec, cfg.window, cfg.subset)
  cache.set(key, value)
  return value
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(Math.max(-40, Math.min(40, -x))))
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0

function standardize(xs: number[][]): { mean: number[]; scale: number[]; z: number[][] } {
  const d = xs[0]?.length ?? 0
  const m = Array.from({ length: d }, (_, j) => mean(xs.map(x => x[j] ?? 0)))
  const s = Array.from({ length: d }, (_, j) => Math.max(1e-5, Math.sqrt(mean(xs.map(x => ((x[j] ?? 0) - m[j]) ** 2)))))
  return { mean: m, scale: s, z: xs.map(x => x.map((v, j) => ((v ?? 0) - m[j]) / s[j])) }
}
// Clipped so one wild window (a head thrown back) cannot outvote everything the model learned.
const zrow = (x: number[], m: number[], s: number[]) => x.map((v, j) => Math.max(-6, Math.min(6, ((v ?? 0) - (m[j] ?? 0)) / (s[j] || 1))))

function fitLda(z: number[][], y: number[]): { w: number[]; b: number } {
  const d = z[0]?.length ?? 0
  const a = z.filter((_, i) => y[i] > 0.5); const b = z.filter((_, i) => y[i] <= 0.5)
  if (!a.length || !b.length) return { w: Array(d).fill(0), b: 0 }
  const ma = Array.from({ length: d }, (_, j) => mean(a.map(x => x[j])))
  const mb = Array.from({ length: d }, (_, j) => mean(b.map(x => x[j])))
  const va = Array.from({ length: d }, (_, j) => mean(a.map(x => (x[j] - ma[j]) ** 2)))
  const vb = Array.from({ length: d }, (_, j) => mean(b.map(x => (x[j] - mb[j]) ** 2)))
  // each number on its own: how far apart the two groups sit, in units of their own spread
  const w = ma.map((v, j) => (v - mb[j]) / (0.5 * (va[j] + vb[j]) + 0.25))
  const bias = -0.5 * w.reduce((s, wj, j) => s + wj * (ma[j] + mb[j]), 0)
  const k = 2 / Math.sqrt(Math.max(1, d))
  return { w: w.map(v => v * k), b: bias * k }
}

/** solve A x = b for a symmetric positive definite A (in place) */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let j = 0; j < n; j++) {
    let s = a[j][j]
    for (let k = 0; k < j; k++) s -= a[j][k] * a[j][k]
    if (!(s > 1e-12)) return null
    a[j][j] = Math.sqrt(s)
    for (let i = j + 1; i < n; i++) {
      let v = a[i][j]
      for (let k = 0; k < j; k++) v -= a[i][k] * a[j][k]
      a[i][j] = v / a[j][j]
    }
  }
  const y = Array(n).fill(0)
  for (let i = 0; i < n; i++) { let v = b[i]; for (let k = 0; k < i; k++) v -= a[i][k] * y[k]; y[i] = v / a[i][i] }
  const x = Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) { let v = y[i]; for (let k = i + 1; k < n; k++) v -= a[k][i] * x[k]; x[i] = v / a[i][i] }
  return x
}

/** Logistic regression, both groups weighing the same, pulled towards zero by `l2`. Newton steps. */
function fitLogistic(z: number[][], y: number[], l2 = 3): { w: number[]; b: number } {
  const n = z.length; const d = z[0]?.length ?? 0
  const pos = y.filter(v => v > 0.5).length; const neg = n - pos
  if (!pos || !neg) return { w: Array(d).fill(0), b: 0 }
  const cw = y.map(v => v > 0.5 ? n / (2 * pos) : n / (2 * neg))
  const w = Array(d + 1).fill(0)   // the last one is the bias
  for (let iter = 0; iter < 12; iter++) {
    const g = Array(d + 1).fill(0)
    const h = Array.from({ length: d + 1 }, () => Array(d + 1).fill(0))
    for (let i = 0; i < n; i++) {
      const x = z[i]
      let s = w[d]
      for (let j = 0; j < d; j++) s += w[j] * x[j]
      const p = sigmoid(s)
      const e = cw[i] * (p - y[i])
      const c = cw[i] * Math.max(1e-4, p * (1 - p))
      for (let j = 0; j < d; j++) {
        g[j] += e * x[j]
        const cx = c * x[j]
        const row = h[j]
        for (let k = 0; k <= j; k++) row[k] += cx * x[k]
      }
      g[d] += e
      const last = h[d]
      for (let k = 0; k < d; k++) last[k] += c * x[k]
      last[d] += c
    }
    for (let j = 0; j < d; j++) { g[j] += l2 * w[j]; h[j][j] += l2 }
    h[d][d] += 1e-6
    const step = solve(h, g)
    if (!step) break
    let big = 0
    for (let j = 0; j <= d; j++) { w[j] -= step[j]; big = Math.max(big, Math.abs(step[j])) }
    if (big < 1e-4) break
  }
  return { w: w.slice(0, d), b: w[d] }
}

function fitNetwork(z: number[][], y: number[], hidden = 8): { w1: number[]; b1: number[]; w2: number[]; b2: number } {
  const d = z[0]?.length ?? 0; const w1 = Array.from({ length: hidden * d }, (_, i) => Math.sin(i * 12.9898) * 0.18); const b1 = Array(hidden).fill(0); const w2 = Array.from({ length: hidden }, (_, i) => Math.cos(i * 4.123) * 0.15); let b2 = 0
  const pos = Math.max(1, y.filter(v => v > 0.5).length); const neg = Math.max(1, y.length - pos)
  const cw = y.map(v => v > 0.5 ? y.length / (2 * pos) : y.length / (2 * neg))
  for (let epoch = 0; epoch < 70; epoch++) {
    const gw1 = Array(w1.length).fill(0); const gb1 = Array(hidden).fill(0); const gw2 = Array(hidden).fill(0); let gb2 = 0
    for (let i = 0; i < z.length; i++) {
      const h = b1.map((v, k) => { let s = v; for (let j = 0; j < d; j++) s += z[i][j] * w1[k * d + j]; return Math.tanh(s) })
      const p = sigmoid(b2 + h.reduce((s, v, k) => s + v * w2[k], 0)); const e = (p - y[i]) * cw[i]
      gb2 += e
      for (let k = 0; k < hidden; k++) { gw2[k] += e * h[k]; const eh = e * w2[k] * (1 - h[k] * h[k]); gb1[k] += eh; for (let j = 0; j < d; j++) gw1[k * d + j] += eh * z[i][j] }
    }
    const lr = 0.35 / Math.sqrt(1 + epoch / 20)
    for (let j = 0; j < w1.length; j++) w1[j] -= lr * (gw1[j] / z.length + 0.01 * w1[j])
    for (let k = 0; k < hidden; k++) { w2[k] -= lr * (gw2[k] / z.length + 0.01 * w2[k]); b1[k] -= lr * gb1[k] / z.length }
    b2 -= lr * gb2 / z.length
  }
  return { w1, b1, w2, b2 }
}

/** Small deterministic gradient boosted stump/tree ensemble. It is deliberately shallow so the reader stays cheap. */
function fitTrees(z: number[][], y: number[], depth = 2, count = 12, shrinkage = 0.12): { trees: EarTreeNode[]; treeRoots: number[]; treeCount: number; treeDepth: number; shrinkage: number; b: number } {
  const n = z.length; const d = z[0]?.length ?? 0
  let base = y.length ? mean(y) : 0.5
  base = Math.max(1e-4, Math.min(1 - 1e-4, base))
  let bias = Math.log(base / (1 - base)); const pred = Array(n).fill(base)
  const trees: EarTreeNode[] = []; const treeRoots: number[] = []
  for (let k = 0; k < count; k++) {
    const residual = y.map((v, i) => v - pred[i]); let bestF = -1; let bestT = 0; let bestGain = 0; let bestL = 0; let bestR = 0
    for (let f = 0; f < d; f++) {
      const sorted = Array.from({ length: n }, (_, i) => i).sort((a, b) => z[a][f] - z[b][f]); const step = Math.max(1, Math.floor(n / 10))
      for (let q = 3; q < n - 2; q += step) { const t = (z[sorted[q - 1]][f] + z[sorted[q]][f]) / 2; let sl = 0; let sr = 0; let nl = 0; let nr = 0; for (let i = 0; i < n; i++) { if (z[i][f] <= t) { sl += residual[i]; nl++ } else { sr += residual[i]; nr++ } }; if (nl < 3 || nr < 3) continue; const lm = sl / nl; const rm = sr / nr; let gain = 0; for (let i = 0; i < n; i++) { const e = residual[i] - (z[i][f] <= t ? lm : rm); gain += e * e }; if (bestF < 0 || gain < bestGain) { bestGain = gain; bestF = f; bestT = t; bestL = lm; bestR = rm } }
    }
    if (bestF < 0) { trees.push({ feature: -1, threshold: 0, left: -1, right: -1, value: mean(residual) }); treeRoots.push(trees.length - 1) } else { const root = trees.length; trees.push({ feature: bestF, threshold: bestT, left: root + 1, right: root + 2, value: 0 }); trees.push({ feature: -1, threshold: 0, left: -1, right: -1, value: bestL }); trees.push({ feature: -1, threshold: 0, left: -1, right: -1, value: bestR }); treeRoots.push(root); for (let i = 0; i < n; i++) pred[i] = sigmoid(bias + shrinkage * (z[i][bestF] <= bestT ? bestL : bestR)) }
    bias = Math.log(Math.max(1e-4, Math.min(1 - 1e-4, mean(pred))) / Math.max(1e-4, 1 - Math.min(1 - 1e-4, mean(pred))))
  }
  return { trees, treeRoots, treeCount: count, treeDepth: depth, shrinkage, b: bias }
}

/** A small conv net over the raw motion: layers of conv and ReLU, then each channel's mean and highest, then one sum. */
function predictConv(det: EarDet, x: number[]): number {
  const c0 = det.mean.length
  let len = Math.floor(x.length / c0)
  let cur = new Float64Array(len * c0)
  for (let i = 0; i < len; i++) for (let c = 0; c < c0; c++) cur[i * c0 + c] = Math.max(-8, Math.min(8, ((x[i * c0 + c] ?? 0) - det.mean[c]) / (det.scale[c] || 1)))
  let cin = c0
  for (const l of det.layers ?? []) {
    const n = Math.floor((len - l.k) / l.s) + 1
    if (n < 1 || l.cin !== cin) return 0.5
    const next = new Float64Array(n * l.cout)
    for (let i = 0; i < n; i++) {
      const base = i * l.s * cin
      for (let o = 0; o < l.cout; o++) {
        let sum = l.b[o]
        const wo = o * cin * l.k
        for (let c = 0; c < cin; c++) { const wc = wo + c * l.k; for (let j = 0; j < l.k; j++) sum += l.w[wc + j] * cur[base + j * cin + c] }
        next[i * l.cout + o] = sum > 0 ? sum : 0
      }
    }
    cur = next; len = n; cin = l.cout
  }
  let out = det.b ?? 0
  for (let c = 0; c < cin; c++) {
    let m = 0; let hi = -Infinity
    for (let i = 0; i < len; i++) { const v = cur[i * cin + c]; m += v; if (v > hi) hi = v }
    out += (det.w?.[c] ?? 0) * (m / len) + (det.w?.[cin + c] ?? 0) * hi
  }
  return sigmoid(out)
}

export function predictDet(det: EarDet, x: number[]): number {
  if (det.family === 'conv') return predictConv(det, x)
  const z = zrow(x, det.mean, det.scale)
  if (det.family === 'network') {
    const d = det.mean.length; const hidden = det.hidden ?? 8
    const h = Array.from({ length: hidden }, (_, k) => Math.tanh((det.b1?.[k] ?? 0) + z.reduce((s, v, j) => s + v * (det.w1?.[k * d + j] ?? 0), 0)))
    return sigmoid((det.b2 ?? 0) + h.reduce((s, v, k) => s + v * (det.w2?.[k] ?? 0), 0))
  }
  if (det.family === 'tree') {
    const trees = det.trees ?? []; const roots = det.treeRoots ?? [0]; const shrink = det.shrinkage ?? 0.12
    const walk = (i: number): number => { const node = trees[i]; if (!node || node.feature < 0) return node?.value ?? 0; return walk(z[node.feature] <= node.threshold ? node.left : node.right) }
    let sum = 0; for (const root of roots) sum += walk(root)
    return sigmoid((det.b ?? 0) + shrink * sum)
  }
  return sigmoid((det.b ?? 0) + z.reduce((s, v, j) => s + v * (det.w?.[j] ?? 0), 0))
}

function trainDet(cfg: Candidate, xs: number[][], ys: number[], how: string): EarDet {
  const st = standardize(xs)
  const z = st.z.map(r => r.map(v => Math.max(-6, Math.min(6, v))))
  let extra: Partial<EarDet> = {}
  if (cfg.family === 'linear') extra = fitLda(z, ys)
  else if (cfg.family === 'logistic') extra = fitLogistic(z, ys, cfg.l2 ?? 3)
  else if (cfg.family === 'network') { const n = fitNetwork(z, ys, 8); extra = { ...n, hidden: 8 } }
  else { extra = fitTrees(z, ys, cfg.depth ?? 2, cfg.trees ?? 12, cfg.shrinkage ?? 0.12) }
  return { ...extra, mean: st.mean, scale: st.scale, family: cfg.family, window: cfg.window, subset: cfg.subset, threshold: 0.5, on: 0.6, off: 0.4, how } as EarDet
}

export function auc(y: number[], p: number[]): number {
  const pos = y.filter(v => v > 0.5).length; const neg = y.length - pos
  if (!pos || !neg) return 0.5
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  // tied answers share their rank, so a model that says the same thing everywhere scores a coin
  let sum = 0
  for (let i = 0; i < order.length;) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const rank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) if (y[order[k][1]] > 0.5) sum += rank
    i = j + 1
  }
  return clamp((sum - pos * (pos + 1) / 2) / (pos * neg), 0, 1)
}

/**
 * What luck reaches: the same answers scored against the same moments after the minute has been cut into
 * one-second pieces and the pieces shuffled. The highest of 40 shuffles but two.
 */
export function luck(t: number[], y: number[], p: number[], seed = 7): number {
  if (y.length < 8) return 0.5
  const pieces: number[][] = []
  let cur: number[] = []; let t0 = t[0]
  for (let i = 0; i < y.length; i++) {
    if (cur.length && (t[i] - t0 >= 1000 || t[i] - t[i - 1] > 400)) { pieces.push(cur); cur = []; t0 = t[i] }
    cur.push(y[i])
  }
  if (cur.length) pieces.push(cur)
  let s = seed >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const got: number[] = []
  for (let k = 0; k < 40; k++) {
    const order = pieces.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = order[i]; order[i] = order[j]; order[j] = x }
    const sy: number[] = []
    for (const i of order) sy.push(...pieces[i])
    got.push(auc(sy, p))
  }
  got.sort((a, b) => b - a)
  return Math.max(0.5, got[2])
}

export interface Round {
  t0: number
  t1: number
  /** where the stillness that closes the round begins: the round is asked about up to here */
  until: number
  bouts: Partial<Record<EarAsk, Array<{ t0: number; t1: number }>>>
}
/**
 * The rounds of a recording. A round begins where a smile is asked for after anything but the letting go of
 * the smile before it; the stillness at the very start belongs to the first round. The stillness that closes a
 * round is a gap between rounds: it is taught on, never asked about.
 */
export function roundsOf(steps: EarStep[]): Round[] {
  const out: Round[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const starts = s.ask === 'smile' && (i === 0 || steps[i - 1].ask !== 'relax') && !!out[out.length - 1]?.bouts.smile
    if (starts || !out.length) out.push({ t0: out.length ? s.t0 : 0, t1: s.t1, until: s.t1, bouts: {} })
    const r = out[out.length - 1]
    r.t1 = s.t1
    r.until = s.ask === 'rest' && !!r.bouts.smile ? s.t0 : s.t1
    ;(r.bouts[s.ask] ??= []).push({ t0: s.t0, t1: s.t1 })
  }
  return out
}

function bestThreshold(y: number[], p: number[]): number {
  let best = -1; let bestT = 0.5
  for (let k = 2; k < 19; k++) {
    const t = k / 20; let tp = 0; let fp = 0; let fn = 0
    for (let i = 0; i < y.length; i++) { const on = p[i] >= t; if (on && y[i] > 0.5) tp++; else if (on) fp++; else if (y[i] > 0.5) fn++ }
    const f = tp ? 2 * tp / (2 * tp + fp + fn) : 0
    if (f > best + 1e-9) { best = f; bestT = t }
  }
  return bestT
}

const NO_SCORE: EarScore = { auc: 0.5, chance: 0.5, windows: 0, times: 0, ok: false }
export const passes = (auc: number, chance: number, times: number) => times >= 3 && auc >= 0.8 && auc > chance + 0.05

/** the answers the check got, in time order: when, what the teacher said, what the model said */
export interface Held { t: number[]; y: number[]; p: number[] }
export { bestThreshold, APART_MS }
interface Checked { score: EarScore; det: EarDet | null; held?: Held }

interface Minute { windows: EarFeatureWindow[]; ys: number[]; known: number[]; rounds: Round[] }

function scoreCandidate(recs: EarRecording[], labels: number[][], cfg: Candidate, ask: EarAsk): Checked {
  const mins: Minute[] = recs.map((rec, k) => {
    const windows = windowsFor(rec, cfg)
    const ys = windows.map(w => labels[k][w.index] ?? -1)
    return { windows, ys, known: windows.map((_, i) => i).filter(i => ys[i] >= 0), rounds: roundsOf(rec.steps) }
  })
  const xs = (m: Minute, idx: number[]) => idx.map(i => m.windows[i].x)
  const yv = (m: Minute, idx: number[]) => idx.map(i => m.ys[i])
  const both = (y: number[]) => y.some(v => v > 0.5) && y.some(v => v <= 0.5)
  const allX = mins.flatMap(m => xs(m, m.known)); const allY = mins.flatMap(m => yv(m, m.known))
  if (!both(allY)) return { score: NO_SCORE, det: null }
  // the minutes in which the teacher saw the thing happen and saw it not happen
  const seen = mins.map((_, k) => k).filter(k => both(yv(mins[k], mins[k].known)))
  const byMinute = seen.length >= 2
  const how = byMinute ? HOW_MINUTE : HOW_ROUND
  const det = trainDet(cfg, allX, allY, how)
  const tt: number[] = []; const ty: number[] = []; const tp: number[] = []
  let times = 0
  const ask1 = (d: EarDet, m: Minute, k: number, test: number[], bouts: Array<{ t0: number; t1: number }>) => {
    for (const i of test) { tt.push(k * APART_MS + m.windows[i].end); ty.push(m.ys[i]); tp.push(predictDet(d, m.windows[i].x)) }
    // a separate time it happened: a bout that was asked for, where the teacher saw it
    for (const b of bouts) if (test.filter(i => m.windows[i].end >= b.t0 && m.windows[i].end < b.t1 + 700 && m.ys[i] > 0.5).length >= 2) times++
  }
  if (byMinute) {
    for (let k = 0; k < mins.length; k++) {
      const trainX = mins.flatMap((m, j) => j === k ? [] : xs(m, m.known)); const trainY = mins.flatMap((m, j) => j === k ? [] : yv(m, m.known))
      if (!mins[k].known.length || !both(trainY)) continue
      ask1(trainDet(cfg, trainX, trainY, how), mins[k], k, mins[k].known, mins[k].rounds.flatMap(r => r.bouts[ask] ?? []))
    }
  } else {
    const k = seen.length ? seen[0] : 0
    const m = mins[k]
    if (m.rounds.length < 3) return { score: NO_SCORE, det }
    const restX = mins.flatMap((o, j) => j === k ? [] : xs(o, o.known)); const restY = mins.flatMap((o, j) => j === k ? [] : yv(o, o.known))
    for (const held of m.rounds) {
      // asked about: the round left out, up to the stillness that closes it. Taught on: everything at least
      // CONTEXT_MS away from that, so no number a taught window is made of was felt during what it will be asked
      // about, and the other way round. The stillness between rounds is that long, so only stillness is lost.
      const test = m.known.filter(i => m.windows[i].end >= held.t0 && m.windows[i].end < held.until)
      const train = m.known.filter(i => m.windows[i].end < held.t0 - CONTEXT_MS || m.windows[i].end - CONTEXT_MS >= held.until)
      if (!test.length || !both(yv(m, train))) continue
      ask1(trainDet(cfg, [...xs(m, train), ...restX], [...yv(m, train), ...restY], how), m, k, test, held.bouts[ask] ?? [])
    }
  }
  const order = tt.map((_, i) => i).sort((a, b) => tt[a] - tt[b])
  const t = order.map(i => tt[i]); const y = order.map(i => ty[i]); const p = order.map(i => tp[i])
  if (!both(y)) return { score: NO_SCORE, det }
  const a = auc(y, p)
  const chance = luck(t, y, p)
  // where to say "now": set on the answers the check got, not on what the final model already knows
  const thr = bestThreshold(y, p)
  det.threshold = thr
  det.on = Math.max(0.5, Math.min(0.9, thr + 0.05))
  det.off = Math.max(0.2, Math.min(det.on - 0.12, thr - 0.1))
  return { score: { auc: a, chance, windows: y.length, times, ok: passes(a, chance, times), held: byMinute ? 'minute' : 'round' }, det, held: { t, y, p } }
}

/** One recording or all of a person's minutes; `labels` in the same shape (one set, or one set per minute). */
export function evaluateCandidate(rec: EarRecording | EarRecording[], event: EarEvent, cfg: Candidate, labels?: EarLabels | EarLabels[]): Checked {
  const recs = Array.isArray(rec) ? rec : [rec]
  const sets = labels ? (Array.isArray(labels) ? labels : [labels]) : recs.map(r => makeEarLabels(r))
  return scoreCandidate(recs, sets.map(l => l[event]), cfg, event as EarAsk)
}

/**
 * A finished detector asked about a whole other recording: the plain test. Nothing in `rec` was used to make it.
 * `times` is how many separate times the thing happened in it.
 */
export function scoreForModel(rec: EarRecording, event: EarEvent, det: EarDet, labels = makeEarLabels(rec)): EarScore {
  const windows = windowsFor(rec, det); const ys = windows.map(w => labels[event][w.index] ?? -1)
  const t: number[] = []; const y: number[] = []; const p: number[] = []
  let times = 0; let prev = 0
  for (let i = 0; i < windows.length; i++) {
    if (ys[i] < 0) continue
    t.push(windows[i].end); y.push(ys[i]); p.push(predictDet(det, windows[i].x))
    if (ys[i] > 0.5 && prev <= 0.5) times++
    prev = ys[i]
  }
  const a = auc(y, p); const chance = luck(t, y, p)
  return { auc: a, chance, windows: y.length, times, ok: passes(a, chance, Math.max(times, 3)) }
}
