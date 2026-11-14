// The two ends of the search that runs in a person's sandbox. `dumpMinutes` writes what every candidate model
// is taught from: the same numbers the phone works out, for every window length, plus the raw motion for the conv
// nets, with what the camera said next to them. The search itself (sandbox/search.py) only ever reads those
// files, so a model it finds reads exactly what the phone will feed it. `finishSearch` takes what the search
// picked and gives it the same check the phone's own models get: the score on answers it never saw, what luck
// reaches, how many separate times, and it makes sure this code gets the same answers out of each model as the
// search did before anything goes back to the phone.
import type { EarAsk, EarEvent, EarModel2, EarRecording, EarScore, EarTried } from '@shared/ear'
import { APART_MS, auc, bestThreshold, luck, passes, predictDet, roundsOf, type EarDet } from './check'
import { CONTEXT_MS, buildFeatureWindows, subsetColumns, RAW_CH, RAW_HZ, type FeatureSubset } from './features'
import { makeEarLabels } from './labels'
import { describe, several } from './index'

// spelled out here: this file also runs under plain bun in the sandbox, where only types come from @shared
const EAR_EVENTS: EarEvent[] = ['smile', 'nod', 'shake', 'laugh', 'talk']
export const SEARCH_WINDOWS = [0.4, 0.6, 1, 1.5, 2]
export const SEARCH_RAW = [1, 2, 3.5]
const SUBSETS: FeatureSubset[] = ['all', 'motion', 'rotation', 'attitude', 'acceleration', 'posture']

interface SetMeta {
  kind: 'features' | 'raw'
  window: number
  file: string
  n: number
  d: number
  minute: number[]
  end: number[]
  y: Partial<Record<EarEvent, number[]>>
}
type Folds = { kind: 'minute' } | { kind: 'round'; minute: number; rounds: Array<{ t0: number; until: number }> }
export interface DumpMeta {
  minutes: number
  context: number
  hz: number
  channels: number
  subsets: Record<string, number[]>
  sets: SetMeta[]
  events: Partial<Record<EarEvent, Folds>>
}
export interface DumpFile { name: string; data: Float32Array }

const both = (y: number[]) => y.some(v => v > 0.5) && y.some(v => v >= 0 && v <= 0.5)

/** Everything the search is allowed to read, as one description and one flat file of numbers per window length. */
export function dumpMinutes(rec: EarRecording[]): { meta: DumpMeta; files: DumpFile[] } {
  const recs = several(rec)
  const labels = recs.map(r => makeEarLabels(r))
  const sets: SetMeta[] = []; const files: DumpFile[] = []
  const add = (kind: SetMeta['kind'], window: number) => {
    const subset: FeatureSubset = kind === 'raw' ? 'raw' : 'all'
    const per = recs.map(r => buildFeatureWindows(r, window, subset))
    const n = per.reduce((s, w) => s + w.length, 0)
    const d = per.find(w => w.length)?.[0].x.length ?? 0
    const data = new Float32Array(n * d)
    const minute: number[] = []; const end: number[] = []; const y: SetMeta['y'] = {}
    let at = 0
    per.forEach((ws, k) => {
      for (const w of ws) {
        data.set(w.x, at); at += d
        minute.push(k); end.push(Math.round(w.end))
        for (const e of EAR_EVENTS) (y[e] ??= []).push(labels[k][e][w.index] ?? -1)
      }
    })
    const file = `${kind === 'raw' ? 'r' : 'x'}-${window}.f32`
    sets.push({ kind, window, file, n, d, minute, end, y })
    files.push({ name: file, data })
  }
  for (const w of SEARCH_WINDOWS) add('features', w)
  for (const s of SEARCH_RAW) add('raw', s)

  // how each thing can be checked, decided once on the one-second windows: by whole minutes as soon as the teacher
  // saw it in two of them, else round by round inside the one minute it was seen in, else not at all
  const ref = sets.find(s => s.kind === 'features' && s.window === 1)!
  const events: DumpMeta['events'] = {}
  for (const e of EAR_EVENTS) {
    const y = ref.y[e] ?? []
    if (!both(y)) continue
    const seen = recs.map((_, k) => k).filter(k => both(y.filter((_, i) => ref.minute[i] === k)))
    if (seen.length >= 2) { events[e] = { kind: 'minute' }; continue }
    const k = seen[0] ?? 0
    const rounds = roundsOf(recs[k].steps)
    if (rounds.length >= 3) events[e] = { kind: 'round', minute: k, rounds: rounds.map(r => ({ t0: r.t0, until: r.until })) }
  }
  const subsets: Record<string, number[]> = {}
  for (const s of SUBSETS) subsets[s] = subsetColumns(s)
  return { meta: { minutes: recs.length, context: CONTEXT_MS, hz: RAW_HZ, channels: RAW_CH, subsets, sets, events }, files }
}

interface Answers { m: number[]; t: number[]; y: number[]; p: number[] }
export interface Picked {
  tried: number
  board: EarTried[]
  events: Partial<Record<EarEvent, {
    kind: 'minute' | 'round'
    det: EarDet
    /** answers from models that never saw the block they were asked about, the model for each block chosen without it */
    held: Answers
    /** the chosen model's own answers on blocks it never saw: where "now" is set */
    own: Answers
    /** what the search itself got out of the finished model on a few windows: this code must get the same */
    check: { m: number[]; i: number[]; p: number[] }
  }>>
}
export interface Finished { model: EarModel2; board: EarTried[]; notes: string[] }

/** The same check as the phone's own models get, on what the search picked. A model this code reads differently is dropped. */
export function finishSearch(rec: EarRecording[], picked: Picked, curve?: EarModel2['curve']): Finished {
  const recs = several(rec)
  const events: EarModel2['events'] = {}
  const notes: string[] = []
  for (const e of EAR_EVENTS) {
    const got = picked.events[e]
    if (!got) continue
    const det = got.det
    // the same answers out of the same model, here as there
    const windows = recs.map(r => buildFeatureWindows(r, det.window, det.subset))
    let worst = 0; let off = 0
    for (let j = 0; j < got.check.p.length; j++) {
      const w = windows[got.check.m[j]]?.[got.check.i[j]]
      const d = w ? Math.abs(predictDet(det, w.x) - got.check.p[j]) : 1
      if (d > worst) worst = d
      if (d > 0.005) off++
    }
    if (!got.check.p.length || worst > 0.05 || off > got.check.p.length * 0.02) { notes.push(`${e}: read differently here (${worst.toFixed(3)} apart on ${off} of ${got.check.p.length}), left out`); continue }

    const order = got.held.t.map((_, i) => i).sort((a, b) => got.held.m[a] - got.held.m[b] || got.held.t[a] - got.held.t[b])
    const m = order.map(i => got.held.m[i]); const t = order.map(i => got.held.t[i]); const y = order.map(i => got.held.y[i]); const p = order.map(i => got.held.p[i])
    if (!both(y)) continue
    let times = 0
    recs.forEach((r, k) => {
      for (const b of roundsOf(r.steps).flatMap(x => x.bouts[e as EarAsk] ?? [])) {
        let n = 0
        for (let i = 0; i < y.length; i++) if (m[i] === k && y[i] > 0.5 && t[i] >= b.t0 && t[i] < b.t1 + 700) n++
        if (n >= 2) times++
      }
    })
    const a = auc(y, p)
    const chance = luck(t.map((v, i) => m[i] * APART_MS + v), y, p)
    const score: EarScore = { auc: a, chance, windows: y.length, times, ok: passes(a, chance, times), held: got.kind }
    const thr = bestThreshold(got.own.y, got.own.p)
    det.threshold = thr
    det.on = Math.max(0.5, Math.min(0.9, thr + 0.05))
    det.off = Math.max(0.2, Math.min(det.on - 0.12, thr - 0.1))
    det.how = got.kind === 'minute' ? 'taught on all minutes but one, asked about the minute left out' : 'taught on all rounds but one, asked about the round left out'
    events[e] = { score, det }
  }
  return { model: describe(recs, 'sandbox', events, picked.tried, curve?.length ? curve : undefined), board: picked.board, notes }
}
