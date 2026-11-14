import type { EarEvent, EarModel2, EarNow, EarRecording, EarScore, EarTried } from '@shared/ear'
import type { HeadFrame } from '../../sense/types'
import { CONTEXT_MS, channelsFromRows, vectorAt, buildFeatureWindows } from './features'
import { evaluateCandidate, passes, predictDet, scoreForModel, auc, luck, type Candidate, type EarDet, type Family } from './check'
import { makeEarLabels } from './labels'

export { EarRecorder, TEACH_MS, TEACH_ROUNDS, TEACH_STEPS } from './record'
export { roundsOf } from './check'
export type { TeachStep } from './record'
export { makeEarLabels, labelsFromRecording, buildEarLabels, labelEarEvents, makeLabels } from './labels'
export { buildFeatureWindows, featureVector, channelsFromRows, vectorAt, extractEarFeatures, makeFeatureWindows, extractFeatures } from './features'
export { earKey, keepMinute, listMinutes, syncMinutes, forgetMinutes } from './minutes'
export { simulateTeach } from './sim'
export type { SimTeachOptions } from './sim'

// v3: the detectors read angle shifts and are checked pile by pile; a v2 model cannot be read by this code
const KEY = 'vire.ear.v3'
interface LocalStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const EVENTS: EarEvent[] = ['smile', 'nod', 'shake', 'laugh', 'talk']
const c = (window: number, subset: Candidate['subset'], family: Family = 'logistic'): Candidate => ({ window, subset, family })
/** the few candidates the phone tries at once: a smile is an angle that shifts and stays, the rest is movement */
const QUICK: Record<EarEvent, Candidate[]> = {
  smile: [c(0.6, 'attitude'), c(1, 'attitude'), c(0.6, 'posture')],
  nod: [c(1, 'rotation'), c(1, 'motion')],
  shake: [c(1, 'rotation'), c(1, 'motion')],
  laugh: [c(0.6, 'motion'), c(1, 'acceleration'), c(0.6, 'rotation')],
  talk: [c(0.6, 'motion'), c(1, 'acceleration'), c(1, 'attitude')],
}
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))

function scoreMean(scores: Partial<Record<EarEvent, EarScore>>): number {
  const a = Object.values(scores).filter((x): x is EarScore => !!x && x.windows > 0).map(x => x.auc)
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0.5
}

/**
 * The best of several candidates has had several goes at the same check, so what luck reaches is taken as the
 * highest any of them reached, and the pass is decided against that.
 */
function fair(score: EarScore, luckiest: number): EarScore {
  const chance = Math.max(score.chance, luckiest)
  return { ...score, chance, ok: passes(score.auc, chance, score.times) }
}

/** the most minutes one model learns from: the newest ones, so the phone still answers in a second or two */
export const MAX_MINUTES = 8
/** oldest first, the newest last; only minutes read the same way as the newest one (the same kind of device) */
export function several(rec: EarRecording | EarRecording[]): EarRecording[] {
  const sorted = (Array.isArray(rec) ? rec.slice() : [rec]).sort((a, b) => a.at.localeCompare(b.at))
  const last = sorted[sorted.length - 1]
  return sorted.filter(r => r.device.shell === last.device.shell && r.device.gyro === last.device.gyro).slice(-MAX_MINUTES)
}
export function describe(recs: EarRecording[], by: EarModel2['by'], events: EarModel2['events'], tried: number, curve?: EarModel2['curve']): EarModel2 {
  const last = recs[recs.length - 1]
  return { v: 2, at: last.at, by, shell: last.device.shell, hz: last.device.hz, gyro: last.device.gyro, events, tried, minutes: recs.length, held: Object.values(events).some(e => e?.score.held === 'minute') ? 'minute' : 'round', ...(curve ? { curve } : {}) }
}

/**
 * The person's own model, made on the device right after a teaching minute, from that minute or from every
 * minute they have done. A thing is in the model only when it could be checked on a part the model never saw.
 */
export function trainEarModel(rec: EarRecording | EarRecording[]): EarModel2 {
  const recs = several(rec)
  if (!recs.length) throw new Error('no teaching minute to learn from')
  const labels = recs.map(r => makeEarLabels(r))
  const events: EarModel2['events'] = {}
  let tried = 0
  for (const event of EVENTS) {
    let best: { score: EarScore; det: EarDet } | null = null
    let luckiest = 0.5
    for (const cfg of QUICK[event]) {
      const checked = evaluateCandidate(recs, event, cfg, labels)
      if (!checked.det) continue
      tried++
      if (!checked.score.windows) continue
      luckiest = Math.max(luckiest, checked.score.chance)
      if (!best || checked.score.auc - checked.score.chance > best.score.auc - best.score.chance) best = { score: checked.score, det: checked.det }
    }
    // never asked for, never seen by the teacher, or nothing to hold back and check on: no row, no claim
    if (!best) continue
    events[event] = { score: fair(best.score, luckiest), det: best.det }
  }
  return describe(recs, 'device', events, tried)
}

/**
 * A model made from one minute, asked about a whole other minute: the plain test. Events the model never
 * passed on its own minute are still scored, so the screen can show what a second minute says.
 */
export function scoreModelOn(model: EarModel2, rec: EarRecording): Partial<Record<EarEvent, EarScore>> {
  const labels = makeEarLabels(rec)
  const out: Partial<Record<EarEvent, EarScore>> = {}
  for (const event of EVENTS) {
    const det = model.events[event]?.det as EarDet | undefined
    if (!det || !det.mean?.length) continue
    const s = scoreForModel(rec, event, det, labels)
    if (s.windows > 0 && labels[event].some(v => v > 0.5)) out[event] = s
  }
  return out
}

/**
 * What each minute added: a model taught on `n` of the person's minutes, asked about another whole minute of
 * theirs, averaged over the ways to choose them (at most `maxPairs` for each n). The model is always the one the
 * phone makes by itself, so the only thing that changes along the curve is how many minutes it learned from.
 */
export function learningCurve(rec: EarRecording[], maxPairs = 8): NonNullable<EarModel2['curve']> {
  const recs = several(rec)
  const out: NonNullable<EarModel2['curve']> = []
  const choose = (from: number[], n: number): number[][] => n === 0 ? [[]] : from.length < n ? [] : [...choose(from.slice(1), n - 1).map(s => [from[0], ...s]), ...choose(from.slice(1), n)]
  for (let n = 1; n < recs.length; n++) {
    const pairs: Array<{ train: number[]; test: number }> = []
    for (let k = 0; k < recs.length; k++) for (const train of choose(recs.map((_, i) => i).filter(i => i !== k), n)) pairs.push({ train, test: k })
    const step = Math.max(1, pairs.length / maxPairs)
    const picked = pairs.length <= maxPairs ? pairs : Array.from({ length: maxPairs }, (_, i) => pairs[Math.floor(i * step)])
    const sum: Partial<Record<EarEvent, number>> = {}; const count: Partial<Record<EarEvent, number>> = {}
    for (const pr of picked) {
      const got = scoreModelOn(trainEarModel(pr.train.map(i => recs[i])), recs[pr.test])
      for (const e of EVENTS) if (got[e]) { sum[e] = (sum[e] ?? 0) + got[e]!.auc; count[e] = (count[e] ?? 0) + 1 }
    }
    const auc: Partial<Record<EarEvent, number>> = {}
    for (const e of EVENTS) if (count[e]) auc[e] = sum[e]! / count[e]!
    out.push({ minutes: n, auc })
  }
  return out
}

function candidateName(c: Candidate): string {
  const family = c.family === 'network' ? 'network' : c.family
  const subset = c.subset === 'all' ? 'all motion' : c.subset
  return `${c.window.toFixed(2)} s windows, ${subset}, ${family}`
}

function candidates(max: number): Candidate[] {
  const out: Candidate[] = []
  const windows = [0.4, 0.6, 1.0, 1.5, 2.0]
  const subsets = ['attitude', 'posture', 'rotation', 'acceleration', 'motion', 'all'] as const
  for (const window of windows) for (const subset of subsets) {
    out.push({ window, subset, family: 'linear' }); out.push({ window, subset, family: 'network' })
    for (const l2 of [0.1, 1, 3, 10]) out.push({ window, subset, family: 'logistic', l2 })
    for (const depth of [1, 2, 3]) out.push({ window, subset, family: 'tree', depth, trees: 8, shrinkage: 0.12 })
    if (out.length >= max) return out.slice(0, max)
  }
  return out
}

type HeldPool = { t: number[]; y: number[]; p: number[]; times: number }
function poolFor(rec: EarRecording, event: EarEvent, det: EarDet, labels: ReturnType<typeof makeEarLabels>): HeldPool {
  const windows = buildFeatureWindows(rec, det.window, det.subset); const t: number[] = []; const y: number[] = []; const p: number[] = []; let times = 0; let prev = 0
  for (const w of windows) { const yy = labels[event][w.index] ?? -1; if (yy < 0) continue; t.push(w.end); y.push(yy); p.push(predictDet(det, w.x)); if (yy > 0.5 && prev <= 0.5) times++; prev = yy }
  return { t, y, p, times }
}

/** Nested minute holdout used by the sandbox search. Candidate choice never sees the outer minute. */
function nestedEvent(recs: EarRecording[], labels: ReturnType<typeof makeEarLabels>[], event: EarEvent, cfgs: Candidate[], deadline = Infinity): { cfg: Candidate; det: EarDet; score: EarScore } | null {
  if (recs.length < 2) return null
  const held: HeldPool = { t: [], y: [], p: [], times: 0 }; let chosen: Candidate | null = null
  const totals = new Map<string, { cfg: Candidate; score: number; n: number }>()
  const keyOf = (c: Candidate) => JSON.stringify([c.family, c.window, c.subset, c.l2, c.depth, c.trees, c.shrinkage])
  for (let k = 0; k < recs.length; k++) {
    const train = recs.filter((_, j) => j !== k); const tl = labels.filter((_, j) => j !== k)
    let inner: { cfg: Candidate; score: EarScore } | null = null
    for (const cfg of cfgs.slice(0, 8)) { if (Date.now() >= deadline) break; const x = evaluateCandidate(train, event, cfg, tl); if (!x.det || !x.score.windows) continue; if (!inner || x.score.auc - x.score.chance > inner.score.auc - inner.score.chance) inner = { cfg, score: x.score } }
    if (!inner) continue
    const key = keyOf(inner.cfg); const old = totals.get(key); totals.set(key, { cfg: inner.cfg, score: (old?.score ?? 0) + inner.score.auc - inner.score.chance, n: (old?.n ?? 0) + 1 })
    if (Date.now() >= deadline) break
    const fit = evaluateCandidate(train, event, inner.cfg, tl).det
    if (!fit) continue
    const got = poolFor(recs[k], event, fit, labels[k]); const off = k * 10_000_000
    held.t.push(...got.t.map(v => v + off)); held.y.push(...got.y); held.p.push(...got.p); held.times += got.times
  }
  const overall = [...totals.values()].sort((a, b) => b.score / b.n - a.score / a.n || keyOf(a.cfg).localeCompare(keyOf(b.cfg)))[0]
  chosen = overall?.cfg ?? null
  if (!chosen || !held.y.length || !held.y.some(v => v > 0.5) || !held.y.some(v => v <= 0.5)) return null
  const a = auc(held.y, held.p); const chance = luck(held.t, held.y, held.p); const score: EarScore = { auc: a, chance, windows: held.y.length, times: held.times, ok: passes(a, chance, held.times), held: 'minute' }
  const finalFit = evaluateCandidate(recs, event, chosen, labels).det
  if (!finalFit) return null
  // Thresholds are estimated from outer held answers only.
  let best = 0.5; let bestF = -1
  for (let k = 2; k < 19; k++) { const th = k / 20; let tp = 0; let fp = 0; let fn = 0; for (let i = 0; i < held.y.length; i++) { const on = held.p[i] >= th; if (on && held.y[i] > 0.5) tp++; else if (on) fp++; else if (held.y[i] > 0.5) fn++ }; const f = tp ? 2 * tp / (2 * tp + fp + fn) : 0; if (f > bestF) { bestF = f; best = th } }
  finalFit.threshold = best; finalFit.on = Math.max(0.5, Math.min(0.9, best + 0.05)); finalFit.off = Math.max(0.2, Math.min(finalFit.on - 0.12, best - 0.1))
  return { cfg: chosen, det: finalFit, score }
}

/** Thorough deterministic candidate search for the sandbox, over one minute or all of a person's minutes. */
export function searchEarModel(rec: EarRecording | EarRecording[], opts: { maxCandidates?: number; budgetMs?: number; onTried?: (t: EarTried) => void; extraCandidates?: Candidate[] } = {}): { model: EarModel2; board: EarTried[] } {
  const recs = several(rec)
  if (!recs.length) throw new Error('no teaching minute to learn from')
  const max = Math.max(1, Math.floor(opts.maxCandidates ?? 180)); const deadline = Date.now() + Math.max(1, opts.budgetMs ?? 45000)
  const labels = recs.map(r => makeEarLabels(r)); const board: EarTried[] = []; const best: Partial<Record<EarEvent, { det: EarDet; score: EarScore }>> = {}
  const luckiest: Partial<Record<EarEvent, number>> = {}
  let count = 0
  const proposed = (opts.extraCandidates ?? []).filter(c => Number.isFinite(c.window) && [0.4, 0.6, 1, 1.5, 2].includes(c.window) && ['all', 'rotation', 'attitude', 'acceleration', 'motion', 'posture'].includes(c.subset) && ['linear', 'logistic', 'network', 'tree'].includes(c.family)).slice(0, 48)
  const cfgs = [...proposed, ...candidates(max)].slice(0, max)
  for (const cfg of cfgs) {
    if (Date.now() >= deadline && count > 0) break
    const started = Date.now(); const scores: Partial<Record<EarEvent, EarScore>> = {}
    for (const event of EVENTS) {
      const checked = evaluateCandidate(recs, event, cfg, labels)
      if (!checked.det || !checked.score.windows) continue
      scores[event] = checked.score
      luckiest[event] = Math.max(luckiest[event] ?? 0.5, checked.score.chance)
      const old = best[event]
      if (!old || checked.score.auc - checked.score.chance > old.score.auc - old.score.chance) best[event] = { det: checked.det, score: checked.score }
    }
    const tried: EarTried = { name: candidateName(cfg), auc: scoreMean(scores), ms: Date.now() - started }
    board.push(tried); count++
    opts.onTried?.(tried)
  }
  const events: EarModel2['events'] = {}
  if (recs.length >= 2) {
    for (const event of EVENTS) { if (Date.now() >= deadline) break; const nested = nestedEvent(recs, labels, event, cfgs, deadline); if (nested) events[event] = { score: nested.score, det: nested.det } }
    // If the wall-clock budget was exhausted while fitting the nested folds, retain the best
    // deterministic detector already evaluated so the worker still returns a usable result.
    for (const event of EVENTS) if (!events[event] && best[event]) events[event] = { score: fair(best[event]!.score, luckiest[event] ?? 0.5), det: best[event]!.det }
  } else for (const event of EVENTS) { const pick = best[event]; if (pick) events[event] = { score: fair(pick.score, luckiest[event] ?? 0.5), det: pick.det } }
  const curve: NonNullable<EarModel2['curve']> = []
  for (let k = 1; k < recs.length; k++) {
    const prior = recs.slice(0, k); const next = recs[k]; const pl = labels.slice(0, k); const aucs: Partial<Record<EarEvent, number>> = {}
    for (const event of EVENTS) { if (Date.now() >= deadline) break; let inner: { det: EarDet; score: EarScore } | null = null; for (const cfg of cfgs.slice(0, 8)) { if (Date.now() >= deadline) break; const x = evaluateCandidate(prior, event, cfg, pl); if (x.det && x.score.windows && (!inner || x.score.auc - x.score.chance > inner.score.auc - inner.score.chance)) inner = { det: x.det, score: x.score } }; if (inner) aucs[event] = scoreForModel(next, event, inner.det, labels[k]).auc }
    curve.push({ minutes: k, auc: aucs })
  }
  board.sort((a, b) => b.auc - a.auc || a.ms - b.ms || a.name.localeCompare(b.name))
  return { model: describe(recs, 'sandbox', events, count, curve), board }
}

/**
 * The wider search has come back. What the device should run now, or null when what it has is newer (a minute
 * done since) or is this same search already. Row by row: the search's answer when it passed its check, else
 * the device's own when that passed, else the search's.
 */
export function adoptSearch(mine: EarModel2 | null, found: EarModel2): EarModel2 | null {
  if (!found || found.v !== 2 || !Object.keys(found.events).length) return null
  if (mine && Object.keys(mine.events).length) {
    if (mine.shell !== found.shell) return null
    if ((found.minutes ?? 1) < (mine.minutes ?? 1) || found.at < mine.at) return null
    if (mine.by === 'sandbox' && mine.at === found.at && (mine.minutes ?? 1) === (found.minutes ?? 1) && mine.tried === found.tried) return null
  }
  const events: EarModel2['events'] = {}
  for (const e of EVENTS) {
    const f = found.events[e]
    const d = mine?.by === 'device' ? mine.events[e] : undefined
    if (f?.score.ok) events[e] = f
    else if (d?.score.ok) events[e] = { ...d, by: 'device' }
    else if (f) events[e] = f
    else if (d) events[e] = { ...d, by: 'device' }
  }
  return { ...found, by: 'sandbox', events }
}

/** one number for a model: how well it told things apart on what it never saw, averaged over the things it has */
export function heldOutScore(model: EarModel2): number | null {
  const got = Object.values(model.events).filter(e => e && e.by !== 'device' && e.score.windows > 0).map(e => e!.score.auc)
  return got.length ? got.reduce((a, b) => a + b, 0) / got.length : null
}

export interface EarReader {
  push(h: HeadFrame): EarNow | null
  reset(): void
}

/** Streaming AirPods-only reader. It keeps no camera or microphone state. */
export function createEarReader(model: EarModel2 | null): EarReader {
  const rows: number[][] = []; const smooth: Partial<Record<EarEvent, number>> = {}; const states: Partial<Record<EarEvent, boolean>> = {}; const streak: Partial<Record<EarEvent, number>> = {}
  let lastT = -Infinity; let lastRun = -Infinity; let last: EarNow | null = null
  const reset = () => { rows.length = 0; lastT = -Infinity; lastRun = -Infinity; last = null; for (const e of EVENTS) { delete smooth[e]; delete states[e]; delete streak[e] } }
  const live = model ? EVENTS.filter(e => model.events[e]?.score.ok && (model.events[e]?.det as EarDet | undefined)?.mean?.length) : []
  return {
    reset,
    push(h) {
      if (!model || h.source !== 'airpods') return null
      if (lastT > -Infinity && (h.t - lastT > 600 || h.t <= lastT)) reset()
      lastT = h.t
      rows.push([h.t, h.pitch, h.yaw, h.roll, h.ax, h.ay, h.az, h.rx ?? 0, h.ry ?? 0, h.rz ?? 0])
      while (rows.length > 8 && h.t - rows[0][0] > CONTEXT_MS) rows.shift()
      if (!live.length) return null
      // the answer moves about twelve times a second; the samples in between repeat it
      if (h.t - lastRun < 80) return last ? { ...last, t: h.t } : null
      lastRun = h.t
      const ch = channelsFromRows(rows, model.gyro); const ts = rows.map(r => r[0]); const end = rows.length - 1
      const active: Partial<Record<EarEvent, number>> = {}; let have = false; const on: EarEvent[] = []
      for (const e of live) {
        const det = model.events[e]!.det as EarDet
        if (h.t - ts[0] < det.window * 1000 * 0.92) continue
        const p0 = predictDet(det, vectorAt(ch, ts, end, det.window, det.subset))
        // A nod is the head going up and down and a shake is it going side to side: without the swing, neither.
        const swing = (col: number) => { let lo = Infinity; let hi = -Infinity; for (let i = end; i >= 0 && h.t - ts[i] <= det.window * 1000; i--) { const v = ch[i][col]; if (v < lo) lo = v; if (v > hi) hi = v } return hi - lo }
        const gate = e === 'nod' ? swing(0) > 3.5 : e === 'shake' ? swing(1) > 3.5 : true
        const p = gate ? p0 : 0
        const old = smooth[e] ?? p; const q = old + (p - old) * 0.4; smooth[e] = q; active[e] = clamp(q); have = true
        const was = states[e] ?? false
        streak[e] = q >= det.on ? (streak[e] ?? 0) + 1 : 0
        states[e] = was ? q >= det.off : (streak[e] ?? 0) >= 2
        if (states[e]) on.push(e)
      }
      last = have ? { t: h.t, p: active, on } : null
      return last
    },
  }
}

export function loadEarModel(): EarModel2 | null {
  try {
    const storage = (globalThis as { localStorage?: LocalStore }).localStorage
    const m = JSON.parse(storage?.getItem(KEY) ?? 'null') as EarModel2 | null
    return m && m.v === 2 ? m : null
  } catch { return null }
}

export function saveEarModel(m: EarModel2 | null): void {
  try {
    const storage = (globalThis as { localStorage?: LocalStore }).localStorage
    if (!storage) return
    if (m) storage.setItem(KEY, JSON.stringify(m)); else storage.removeItem(KEY)
  } catch { /* private mode: the model lives for this visit */ }
}
