// The clinic re-trains every patient at once: one network-blocked sandbox per simulated patient, all started together
// by the ear worker (server/ear-worker.ts, sandbox/cohort_runner.py). This file keeps the runs and their caps.
// A run spends sandbox credits and the button sits on a public page, so the server caps it: one run at a time,
// two minutes between runs, and at most VIRE_COHORT_MAX_RUNS runs that a worker ever took.
// The patients are always simulated; nothing here holds anything of a person.
import { db } from './db'
import { COHORT_DEFAULT, COHORT_MAX, COHORT_SEED } from '../shared/cohort'
import { ROSTER, synthId } from './cohort'
import type { CohortClaim, CohortPatient, CohortPatientState, CohortRun, CohortWhere, CohortWorks } from '../shared/cohort'
import { SESSION_KINDS } from '../shared/earsession'
import type { SessionKind } from '../shared/earsession'

db.exec(`
  CREATE TABLE IF NOT EXISTS cohort_runs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    n INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    patients TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    beat_at INTEGER,
    seconds REAL NOT NULL DEFAULT 0,
    sandboxes INTEGER NOT NULL DEFAULT 0,
    peak INTEGER NOT NULL DEFAULT 0,
    tried INTEGER NOT NULL DEFAULT 0,
    refused INTEGER NOT NULL DEFAULT 0,
    place TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS cohort_runs_at ON cohort_runs (created_at);
`)

/** a run whose worker says nothing for this long fails; a run no worker takes in this long fails too */
const SILENT_MS = 3 * 60_000
/** at least this long between the starts of two runs */
const GAP_MS = 2 * 60_000
const MAX_TRIED = 5000
const STATES = new Set<CohortPatientState>(['waiting', 'running', 'done', 'failed'])
// Forty runs leaves room for judges to press the button; each run costs about $0.20 in sandbox time.
const maxRuns = () => {
  const v = Number(process.env.VIRE_COHORT_MAX_RUNS ?? 40)
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 40
}

type Row = {
  id: string
  state: CohortRun['state']
  n: number
  seed: number
  patients: string
  created_at: number
  started_at: number | null
  ended_at: number | null
  beat_at: number | null
  seconds: number
  sandboxes: number
  peak: number
  tried: number
  refused: number
  place: string | null
  error: string | null
}

const fresh = (n: number): CohortPatient[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, state: 'waiting', tried: 0, seconds: 0, auc: null }))

const publicRun = (r: Row): CohortRun => {
  let patients: CohortPatient[]
  try {
    patients = JSON.parse(r.patients) as CohortPatient[]
  } catch {
    patients = fresh(r.n)
  }
  if (r.seed === COHORT_SEED) {
    patients = patients.map((p) => {
      const person = ROSTER[p.n - 1]
      return person ? { ...p, name: person[0], id: synthId(person[0]) } : p
    })
  }
  const ended = r.state === 'done' || r.state === 'failed'
  return {
    id: r.id,
    state: r.state,
    simulated: true,
    patients,
    at: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    seconds: Math.round(r.seconds * 10) / 10,
    // nothing runs once the run is over, whatever the last word from the worker said
    sandboxes: ended ? 0 : r.sandboxes,
    peak: r.peak,
    tried: r.tried,
    where: r.place === 'modal' || r.place === 'local' ? r.place : null,
    refused: r.refused,
    ...(r.error ? { error: r.error } : {}),
  }
}

const row = (id: string) => db.query('SELECT * FROM cohort_runs WHERE id = ?').get(id) as Row | null

/** Fail runs nobody is working on: a worker silent for three minutes, or a run no worker took in three minutes. */
export function expireCohorts(now = Date.now()): void {
  db.query("UPDATE cohort_runs SET state = 'failed', ended_at = ?, sandboxes = 0, error = ? WHERE state = 'running' AND COALESCE(beat_at, started_at, created_at) <= ?").run(now, 'the worker went silent for 3 minutes', now - SILENT_MS)
  db.query("UPDATE cohort_runs SET state = 'failed', ended_at = ?, error = ? WHERE state = 'queued' AND created_at <= ?").run(now, 'no worker took the run within 3 minutes', now - SILENT_MS)
}

export type Started = { run: CohortRun } | { error: string; status: 409 | 429 | 400 }

/** Ask for a run of `patients` simulated patients. Refuses, in plain words, when a cap says no. */
export function startCohort(patients: unknown, now = Date.now()): Started {
  const n = patients === undefined || patients === null ? COHORT_DEFAULT : Number(patients)
  if (!Number.isInteger(n) || n < 1 || n > COHORT_MAX) return { error: `the number of patients must be between 1 and ${COHORT_MAX}`, status: 400 }
  expireCohorts(now)
  const going = db.query("SELECT id FROM cohort_runs WHERE state IN ('queued', 'running') LIMIT 1").get()
  if (going) return { error: 'A re-training run is already going. Start the next one when it is done.', status: 409 }
  const last = db.query('SELECT created_at FROM cohort_runs ORDER BY created_at DESC LIMIT 1').get() as { created_at: number } | null
  if (last && now - last.created_at < GAP_MS) {
    const wait = Math.ceil((GAP_MS - (now - last.created_at)) / 1000)
    return { error: `The last run started less than 2 minutes ago. The next one can start in ${wait} seconds.`, status: 429 }
  }
  // only runs a worker took cost anything: one that nobody took does not use up the cap
  const used = (db.query('SELECT COUNT(*) AS k FROM cohort_runs WHERE started_at IS NOT NULL').get() as { k: number }).k
  const max = maxRuns()
  if (used >= max) return { error: `This server has done all ${max} re-training runs it may: each one costs sandbox time.`, status: 429 }
  const id = `cr_${crypto.randomUUID().replace(/-/g, '')}`
  const seed = COHORT_SEED
  db.query('INSERT INTO cohort_runs (id, state, n, seed, patients, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'queued', n, seed, JSON.stringify(fresh(n)), now)
  return { run: publicRun(row(id)!) }
}

/** The newest run, for the big screen. */
export function latestCohort(now = Date.now()): CohortRun | null {
  expireCohorts(now)
  const r = db.query('SELECT * FROM cohort_runs ORDER BY created_at DESC, id DESC LIMIT 1').get() as Row | null
  return r ? publicRun(r) : null
}

export function getCohort(id: string): CohortRun | null {
  const r = row(id)
  return r ? publicRun(r) : null
}

/** The worker takes the oldest waiting run. */
export function claimCohort(now = Date.now()): CohortClaim | null {
  expireCohorts(now)
  const q = db.query("SELECT * FROM cohort_runs WHERE state = 'queued' ORDER BY created_at, id LIMIT 1").get() as Row | null
  if (!q) return null
  const changed = db.query("UPDATE cohort_runs SET state = 'running', started_at = ?, beat_at = ? WHERE id = ? AND state = 'queued'").run(now, now, q.id)
  if (!changed.changes) return null
  return { id: q.id, patients: q.n, seed: q.seed, now: q.created_at }
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const whole = (x: unknown, lo: number, hi: number): x is number => finite(x) && Number.isInteger(x) && x >= lo && x <= hi

const SAID = new Set<CohortWorks['said']>(['learned', 'leaning', 'early'])
const isKind = (x: unknown): x is SessionKind => SESSION_KINDS.includes(x as SessionKind)

/** what works for one patient, checked; anything off and the field is left out (the rest of the patient stays) */
export function checkWorks(x: unknown): CohortWorks | undefined {
  if (!x || typeof x !== 'object') return undefined
  const w = x as Record<string, unknown>
  if (!(w.best === null || isKind(w.best)) || !SAID.has(w.said as CohortWorks['said']) || !isKind(w.next)) return undefined
  if (!finite(w.sure) || w.sure < 0 || w.sure > 1 || !whole(w.total, 0, 10_000)) return undefined
  if (!Array.isArray(w.kinds) || w.kinds.length !== SESSION_KINDS.length) return undefined
  const kinds: CohortWorks['kinds'] = []
  for (const [i, item] of w.kinds.entries()) {
    const k = (item ?? {}) as Record<string, unknown>
    if (k.kind !== SESSION_KINDS[i] || !whole(k.n, 0, 10_000)) return undefined
    if (k.mean !== null && (!finite(k.mean) || Math.abs(k.mean) > 1000)) return undefined
    kinds.push({ kind: k.kind as SessionKind, n: k.n, mean: k.mean === null ? null : Math.round(k.mean * 10) / 10 })
  }
  if (kinds.reduce((a, k) => a + k.n, 0) !== w.total) return undefined
  if (w.best !== null && !kinds.find((k) => k.kind === w.best)?.n) return undefined
  return { best: w.best as SessionKind | null, said: w.said as CohortWorks['said'], sure: Math.round(w.sure * 100) / 100, next: w.next as SessionKind, total: w.total, kinds }
}

interface Checked {
  patients: CohortPatient[]
  seconds: number
  sandboxes: number
  peak: number
  where: CohortWhere
  refused: number
}

/** The worker's word on the run, checked at the boundary: one entry per patient, numbers in range. */
export function checkProgress(x: unknown, n: number): Checked | null {
  if (!x || typeof x !== 'object') return null
  const b = x as Record<string, unknown>
  if (!Array.isArray(b.patients) || b.patients.length !== n) return null
  const patients: CohortPatient[] = []
  for (const [i, item] of b.patients.entries()) {
    if (!item || typeof item !== 'object') return null
    const p = item as Record<string, unknown>
    if (p.n !== i + 1 || !STATES.has(p.state as CohortPatientState) || !whole(p.tried, 0, MAX_TRIED) || !finite(p.seconds) || p.seconds < 0 || p.seconds > 900) return null
    if (p.auc !== null && p.auc !== undefined && (!finite(p.auc) || p.auc < 0 || p.auc > 1)) return null
    if (p.error !== undefined && (typeof p.error !== 'string' || p.error.length > 300)) return null
    const works = checkWorks(p.works)
    patients.push({ n: i + 1, state: p.state as CohortPatientState, tried: p.tried, seconds: Math.round(p.seconds * 10) / 10, auc: finite(p.auc) ? Math.round(p.auc * 1000) / 1000 : null, ...(typeof p.error === 'string' && p.error ? { error: p.error } : {}), ...(works ? { works } : {}) })
  }
  if (!finite(b.seconds) || b.seconds < 0 || b.seconds > 900) return null
  if (!whole(b.sandboxes, 0, n) || !whole(b.peak, 0, n)) return null
  if (b.where !== 'modal' && b.where !== 'local') return null
  const refused = b.refused === undefined ? 0 : b.refused
  if (!whole(refused, 0, 100_000)) return null
  return { patients, seconds: b.seconds, sandboxes: b.sandboxes, peak: b.peak, where: b.where, refused }
}

function save(r: Row, c: Checked, now: number, extra = ''): void {
  const tried = Math.min(MAX_TRIED * r.n, c.patients.reduce((s, p) => s + p.tried, 0))
  db.query(`UPDATE cohort_runs SET patients = ?, seconds = ?, sandboxes = ?, peak = MAX(peak, ?), tried = MAX(tried, ?), refused = MAX(refused, ?), place = ?, beat_at = ?${extra} WHERE id = ? AND state = 'running'`).run(JSON.stringify(c.patients), c.seconds, c.sandboxes, Math.max(c.peak, c.sandboxes), tried, c.refused, c.where, now, r.id)
}

export function progressCohort(id: string, body: unknown, now = Date.now()): CohortRun | null {
  const r = row(id)
  if (!r || r.state !== 'running') return null
  const c = checkProgress(body, r.n)
  if (!c) return null
  save(r, c, now)
  return getCohort(id)
}

/** The run is over. With `error` it failed (what the patients got so far is kept); otherwise it is done. */
export function finishCohort(id: string, body: unknown, now = Date.now()): CohortRun | null {
  const r = row(id)
  if (!r || r.state !== 'running') return null
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const error = typeof b.error === 'string' && b.error.trim() ? b.error.trim().slice(0, 500) : null
  const c = checkProgress(body, r.n)
  if (!c && !error) return null
  if (c) save(r, c, now)
  db.query("UPDATE cohort_runs SET state = ?, ended_at = ?, sandboxes = 0, error = ? WHERE id = ? AND state = 'running'").run(error ? 'failed' : 'done', now, error, id)
  return getCohort(id)
}

export const cohortLimits = { silentMs: SILENT_MS, gapMs: GAP_MS, maxRuns }
