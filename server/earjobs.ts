import { db } from './db'
import { minutesWith } from './ear'
import { EAR_EVENTS } from '../shared/ear'
import { earMeasures } from '../shared/earday'
import type { EarDay } from '../shared/earday'
import type { EarEvent, EarJob, EarModel2, EarRecording, EarTried } from '../shared/ear'

/** Persistent queue for the per-person ear search. The recording itself stays in VIRE_EAR_DIR. */
db.exec(`
  CREATE TABLE IF NOT EXISTS ear_jobs (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    state TEXT NOT NULL,
    board TEXT NOT NULL,
    tried INTEGER NOT NULL DEFAULT 0,
    seconds REAL NOT NULL DEFAULT 0,
    model TEXT,
    error TEXT,
    claimed_at INTEGER,
    requeues INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ear_jobs_queue ON ear_jobs (state, created_at);
`)
// added after the first jobs were stored
for (const col of ['minutes INTEGER NOT NULL DEFAULT 1', 'landed_at INTEGER', 'owner TEXT', 'days TEXT', 'demo INTEGER', 'daily_at INTEGER']) {
  try {
    db.exec(`ALTER TABLE ear_jobs ADD COLUMN ${col}`)
  } catch {
    /* already there */
  }
}

const MAX_BOARD = 12
const MAX_TRIED = 2000
const STALE_MS = 3 * 60_000
const EVENTS = new Set<string>(EAR_EVENTS)

type JobRow = {
  id: string
  recording_id: string
  state: EarJob['state']
  board: string
  tried: number
  seconds: number
  model: string | null
  error: string | null
  claimed_at: number | null
  requeues: number
  created_at: number
  minutes: number
  landed_at: number | null
  days: string | null
  demo: number | null
  daily_at: number | null
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const asBoard = (x: unknown): EarTried[] | null => {
  if (!Array.isArray(x) || x.length > MAX_TRIED) return null
  const out: EarTried[] = []
  for (const item of x) {
    if (!item || typeof item !== 'object') return null
    const v = item as Partial<EarTried>
    if (typeof v.name !== 'string' || v.name.length === 0 || v.name.length > 180 || !finite(v.auc) || !finite(v.ms)) return null
    if (v.auc < 0 || v.auc > 1 || v.ms < 0 || v.ms > 600_000) return null
    out.push({ name: v.name, auc: v.auc, ms: v.ms })
  }
  return out
}

function boardFor(x: unknown): EarTried[] | null {
  const board = asBoard(x)
  if (!board) return null
  return board
    .slice()
    .sort((a, b) => b.auc - a.auc || a.ms - b.ms || a.name.localeCompare(b.name))
    .slice(0, MAX_BOARD)
}

function scoreOk(score: unknown): boolean {
  if (!score || typeof score !== 'object') return false
  const s = score as Record<string, unknown>
  const raw = s.score
  if (!raw || typeof raw !== 'object') return false
  const value = raw as Record<string, unknown>
  return (
    finite(value.auc) && finite(value.chance) &&
    typeof value.windows === 'number' && Number.isInteger(value.windows) && typeof value.times === 'number' && Number.isInteger(value.times) &&
    typeof value.ok === 'boolean' &&
    value.auc >= 0 && value.auc <= 1 && value.chance >= 0 && value.chance <= 1 &&
    value.windows >= 0 && value.times >= 0
  )
}

/** Validate the model at the server boundary. `det` is opaque to the server but must be JSON data. */
export function checkEarModel(x: unknown): EarModel2 | null {
  if (!x || typeof x !== 'object') return null
  const m = x as Partial<EarModel2>
  if (m.v !== 2 || !['device', 'sandbox'].includes(String(m.by)) || !['mac', 'ios', 'sim'].includes(String(m.shell))) return null
  if (typeof m.at !== 'string' || m.at.length > 80 || !finite(m.hz) || m.hz < 0 || m.hz > 200 || typeof m.gyro !== 'boolean' || !Number.isInteger(m.tried) || (m.tried ?? -1) < 0 || (m.tried ?? MAX_TRIED + 1) > MAX_TRIED) return null
  if (!m.events || typeof m.events !== 'object' || Array.isArray(m.events)) return null
  for (const [event, value] of Object.entries(m.events)) {
    if (!EVENTS.has(event) || !scoreOk(value)) return null
    try {
      if (JSON.stringify((value as { det: unknown }).det).length > 500_000) return null
    } catch {
      return null
    }
  }
  try {
    if (JSON.stringify(m).length > 1_000_000) return null
  } catch {
    return null
  }
  return m as EarModel2
}

/** stored by this server itself; still read with care, an old row may hold anything */
function daysOf(text: string | null): EarDay[] | null {
  if (!text) return null
  try {
    const x = JSON.parse(text) as unknown
    return Array.isArray(x) && x.length ? (x as EarDay[]) : null
  } catch {
    return null
  }
}

const publicJob = (r: JobRow): EarJob => ({
  id: r.id,
  state: r.state,
  board: boardFor(JSON.parse(r.board)) ?? [],
  tried: Math.max(0, Math.min(MAX_TRIED, Math.trunc(r.tried))),
  seconds: Number.isFinite(r.seconds) ? Math.max(0, Math.min(600, r.seconds)) : 0,
  model: r.model ? checkEarModel(JSON.parse(r.model)) : null,
  ...(r.error ? { error: r.error } : {}),
  minutes: Math.max(1, r.minutes ?? 1),
  ...(r.landed_at ? { landedAt: r.landed_at } : {}),
  at: r.created_at,
  ...(daysOf(r.days) ? { days: daysOf(r.days)! } : {}),
  ...(r.demo ? { demo: true } : {}),
  ...(r.daily_at ? { dailyAt: r.daily_at } : {}),
})

const row = (id: string) => db.query('SELECT * FROM ear_jobs WHERE id = ?').get(id) as JobRow | null

/**
 * One search per new minute. `owner` is the hash of the device's key (see ear.ts): with it the device can ask
 * for its newest search, and a search that has not started yet gives way to the one for a newer minute, which
 * learns from every minute anyway.
 */
export function queueEarJob(recordingId: string, now = Date.now(), owner: string | null = null): EarJob {
  const id = `ej_${crypto.randomUUID().replace(/-/g, '')}`
  if (owner) db.query("UPDATE ear_jobs SET state = 'failed', error = ? WHERE owner = ? AND state = 'queued'").run('a newer minute arrived: its search learns from this one too', owner)
  db.query('INSERT INTO ear_jobs (id, recording_id, state, board, created_at, owner) VALUES (?, ?, ?, ?, ?, ?)').run(id, recordingId, 'queued', '[]', now, owner)
  return publicJob(row(id)!)
}

/** The newest search of one device (by the hash of its key), with the model: it is that device's own. */
export function latestEarJobOf(owner: string | null): EarJob | null {
  if (!owner) return null
  const r = db.query('SELECT * FROM ear_jobs WHERE owner = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(owner) as JobRow | null
  return r ? publicJob(r) : null
}

/** Requeue one silent claim once; a second silent claim fails the job. Exported for the fake-clock test. */
export function expireEarJobs(now = Date.now()): void {
  const stale = db.query("SELECT id, requeues FROM ear_jobs WHERE state = 'running' AND claimed_at IS NOT NULL AND claimed_at <= ?").all(now - STALE_MS) as { id: string; requeues: number }[]
  for (const r of stale) {
    if (r.requeues < 1) {
      db.query("UPDATE ear_jobs SET state = 'queued', claimed_at = NULL, requeues = requeues + 1 WHERE id = ? AND state = 'running'").run(r.id)
    } else {
      db.query("UPDATE ear_jobs SET state = 'failed', error = ?, claimed_at = NULL WHERE id = ? AND state = 'running'").run('worker went silent twice', r.id)
    }
  }
}

/**
 * What each of this person's minutes looked like from the AirPods alone, kept with the search so the clinic's
 * screen can show the newest minute against the person's own earlier ones. No camera number goes in.
 */
export async function noteEarDays(id: string): Promise<void> {
  const r = row(id)
  if (!r) return
  // every minute counts for the usual, the camera-off ones too; only the camera's minutes are learned from
  const minutes = await minutesWith(r.recording_id, true).catch(() => [])
  if (!minutes.length) return
  const demo = minutes[minutes.length - 1]!.device.shell === 'sim' ? 1 : 0
  const taught = minutes.filter((m) => m.kind !== 'daily').length
  db.query('UPDATE ear_jobs SET days = ?, demo = ?, minutes = MAX(minutes, ?) WHERE id = ?').run(JSON.stringify(minutes.slice(-30).map(earMeasures)), demo, taught, id)
}

/**
 * A camera-off daily minute arrived. It starts no search (nothing in it teaches). The person's newest search
 * gets the minute at the end of its days, so the clinic's screen shows today against their usual again.
 * Returns that search's id, or null when this device has had no search yet.
 */
export async function noteDailyMinute(owner: string | null, recordingId: string, now = Date.now()): Promise<string | null> {
  if (!owner) return null
  const r = db.query('SELECT * FROM ear_jobs WHERE owner = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(owner) as JobRow | null
  if (!r) return null
  const minutes = await minutesWith(recordingId, true).catch(() => [])
  if (!minutes.length) return null
  db.query('UPDATE ear_jobs SET days = ?, daily_at = ? WHERE id = ?').run(JSON.stringify(minutes.slice(-30).map(earMeasures)), now, r.id)
  return r.id
}

export function getEarJob(id: string): EarJob | null {
  const r = row(id)
  return r ? publicJob(r) : null
}

/**
 * The newest search, for the big screen: the board, the count and the scores, never how the model computes
 * (that goes only to the device that holds the job's id).
 */
export function latestEarJob(): EarJob | null {
  // newest by what happened last: its minute arriving, or a daily minute of the same person after it
  const r = db.query('SELECT * FROM ear_jobs ORDER BY MAX(created_at, COALESCE(daily_at, 0)) DESC, id DESC LIMIT 1').get() as JobRow | null
  if (!r) return null
  const job = publicJob(r)
  if (job.model) job.model = { ...job.model, events: Object.fromEntries(Object.entries(job.model.events).map(([e, v]) => [e, { score: v!.score, det: null }])) }
  return job
}

/** The person's device says it now runs the model this search found. */
export function landEarJob(id: string, now = Date.now()): EarJob | null {
  const r = row(id)
  if (!r || r.state !== 'done') return null
  if (!r.landed_at) db.query('UPDATE ear_jobs SET landed_at = ? WHERE id = ?').run(now, id)
  return getEarJob(id)
}

export interface ClaimedEarJob {
  job: EarJob
  /** the minute that started the search */
  recording: EarRecording
  /** every minute of that person, oldest first, the one above last: the search learns from all of them */
  minutes: EarRecording[]
}

/** Claim the oldest queued job. The recording is read only after the durable claim. */
export async function claimEarJob(now = Date.now()): Promise<ClaimedEarJob | null> {
  expireEarJobs(now)
  const queued = db.query("SELECT * FROM ear_jobs WHERE state = 'queued' ORDER BY created_at, id LIMIT 1").get() as JobRow | null
  if (!queued) return null
  const changed = db.query("UPDATE ear_jobs SET state = 'running', claimed_at = ?, seconds = 0 WHERE id = ? AND state = 'queued'").run(now, queued.id)
  if (!changed.changes) return null
  const minutes = await minutesWith(queued.recording_id).catch(() => [])
  if (!minutes.length) {
    db.query("UPDATE ear_jobs SET state = 'failed', error = ?, claimed_at = NULL WHERE id = ?").run('recording is missing or invalid', queued.id)
    return null
  }
  db.query('UPDATE ear_jobs SET minutes = ? WHERE id = ?').run(minutes.length, queued.id)
  return { job: getEarJob(queued.id)!, recording: minutes[minutes.length - 1]!, minutes }
}

export function updateEarProgress(id: string, tried: unknown, seconds: unknown): EarJob | null {
  const board = boardFor(tried)
  if (!board || !finite(seconds) || seconds < 0 || seconds > 600) return null
  const r = row(id)
  if (!r || r.state !== 'running') return null
  const total = Math.max(r.tried, Array.isArray(tried) ? tried.length : 0)
  // every word from the worker is a sign of life: a long search is not taken for a silent one
  db.query('UPDATE ear_jobs SET board = ?, tried = ?, seconds = ?, claimed_at = ? WHERE id = ? AND state = ?').run(JSON.stringify(board), Math.min(MAX_TRIED, total), seconds, Date.now(), id, 'running')
  return getEarJob(id)
}

export function finishEarJob(id: string, modelInput: unknown, boardInput: unknown): EarJob | null {
  const model = checkEarModel(modelInput)
  const board = boardFor(boardInput)
  const r = row(id)
  if (!model || !board || !r || r.state !== 'running') return null
  db.query('UPDATE ear_jobs SET state = ?, model = ?, board = ?, tried = ?, claimed_at = NULL WHERE id = ? AND state = ?').run('done', JSON.stringify(model), JSON.stringify(board), Math.max(r.tried, model.tried), id, 'running')
  return getEarJob(id)
}

export function failEarJob(id: string, message: unknown): EarJob | null {
  const r = row(id)
  if (!r || r.state !== 'running') return null
  const error = typeof message === 'string' && message.trim() ? message.trim().slice(0, 500) : 'sandbox search failed'
  db.query("UPDATE ear_jobs SET state = 'failed', error = ?, claimed_at = NULL WHERE id = ? AND state = 'running'").run(error, id)
  return getEarJob(id)
}

export const earJobLimits = { staleMs: STALE_MS, maxBoard: MAX_BOARD, maxTried: MAX_TRIED }
