// Persistence for real people: users, pings, doses, booster flags, and the LLM text cache.
import { Database } from 'bun:sqlite'
import { fileURLToPath } from 'node:url'
import type { Channel, DoseKind, DoseUpload, PHQ2Check, PHQ2Upload, PingUpload } from '../shared/types'
import type { DoseRec, Person, PingRec } from './engine'
import { cleanNick } from './wall'

const path = process.env.VIRE_DB ?? fileURLToPath(new URL('./vire.sqlite', import.meta.url))
export const db = new Database(path, { create: true })
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, clinic_code TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pings (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, setting TEXT NOT NULL, started_at TEXT NOT NULL,
    vals TEXT NOT NULL, features TEXT NOT NULL, traces TEXT, device TEXT, message TEXT, stim TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS pings_user ON pings (user_id, started_at);
  CREATE TABLE IF NOT EXISTS doses (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, dose TEXT NOT NULL, started_at TEXT NOT NULL, duration_s REAL,
    pre_ping_id TEXT, post_ping_id TEXT, felt INTEGER, metrics TEXT, reward REAL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS doses_user ON doses (user_id, started_at);
  CREATE TABLE IF NOT EXISTS checks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, answered_at TEXT NOT NULL,
    item1 INTEGER NOT NULL, item2 INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS checks_user ON checks (user_id, answered_at);
  CREATE TABLE IF NOT EXISTS boosters (patient_id TEXT PRIMARY KEY, is_on INTEGER NOT NULL, at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS llm_cache (hash TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`)

// Round 2 migrations. The file holds real data from now on: only ever ADD a column, never drop or rewrite one.
function addColumn(table: 'users' | 'pings', column: string, decl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
}
addColumn('users', 'visitor', 'INTEGER NOT NULL DEFAULT 0') // 1 = hall guest: on the wall, never in the clinic lists
addColumn('users', 'hidden', 'INTEGER NOT NULL DEFAULT 0') // 1 = taken off the wall by hand (wall-admin.ts)
addColumn('users', 'via', 'TEXT') // 'public' (through the funnel) | 'local' (dev machines) | 'test' (automated agent)
addColumn('users', 'src', 'TEXT') // salted tag of the source address, to take one flooder off the wall in one go
addColumn('pings', 'via', 'TEXT')
addColumn('pings', 'src', 'TEXT')
addColumn('pings', 'unreadable', 'TEXT') // JSON list of the channels the phone flagged as unreadable
addColumn('pings', 'stim', 'TEXT')
addColumn('pings', 'step_readings', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS users_visitor ON users (visitor, created_at)')

const now = () => new Date().toISOString()
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export interface UserRow {
  id: string
  name: string
  clinic_code: string | null
  created_at: string
  visitor: number
  hidden: number
  via: string | null
  src: string | null
}
/** where a request came from: kept with the row so test traffic can be told from the hall */
export interface Origin {
  via: 'public' | 'local' | 'test'
  src: string | null
}

export function createUser(name?: string | null, clinicCode?: string | null, id = newId(), o: { visitor?: boolean; origin?: Origin } = {}): UserRow {
  // a hall guest's name goes up on the wall: a clean nickname, or the next guest number
  const clean = o.visitor
    ? (cleanNick(name) ?? `guest ${visitorCount() + 1}`)
    : (name ?? '').trim().slice(0, 24) || `Guest ${Math.floor(10 + Math.random() * 90)}`
  db.query('INSERT OR IGNORE INTO users (id, name, clinic_code, created_at, visitor, via, src) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    clean,
    clinicCode?.trim().slice(0, 40) || null,
    now(),
    o.visitor ? 1 : 0,
    o.origin?.via ?? null,
    o.origin?.src ?? null,
  )
  return getUser(id)!
}
export const getUser = (id: string) => db.query('SELECT * FROM users WHERE id = ?').get(id) as UserRow | null
export const listUsers = () => db.query('SELECT * FROM users ORDER BY created_at').all() as UserRow[]
/** everyone the clinic may see: hall guests are left out */
export const listPatients = () => db.query('SELECT * FROM users WHERE visitor = 0 ORDER BY created_at').all() as UserRow[]
export const visitorCount = () => (db.query('SELECT COUNT(*) AS n FROM users WHERE visitor = 1').get() as { n: number }).n

export function insertPHQ2(id: string, p: PHQ2Upload, answeredAt: string): PHQ2Check {
  const [item1, item2] = p.items
  const total = item1 + item2
  db.query('INSERT INTO checks (id, user_id, answered_at, item1, item2, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, p.userId, answeredAt, item1, item2, total, now())
  return { id, userId: p.userId, at: answeredAt, items: [item1, item2], total }
}

export function listPHQ2(userId: string): PHQ2Check[] {
  return (db.query('SELECT id, user_id, answered_at, item1, item2, total FROM checks WHERE user_id = ? ORDER BY answered_at, created_at').all(userId) as { id: string; user_id: string; answered_at: string; item1: number; item2: number; total: number }[]).map((r) => ({ id: r.id, userId: r.user_id, at: r.answered_at, items: [r.item1, r.item2], total: r.total }))
}

export function insertPing(
  id: string,
  p: PingUpload,
  startedAt: string,
  vals: Record<Channel, number | null>,
  o: { origin?: Origin; unreadable?: Channel[] } = {},
): void {
  db.query(
    'INSERT INTO pings (id, user_id, kind, setting, started_at, vals, features, traces, device, created_at, via, src, unreadable, stim, step_readings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    p.userId,
    p.kind,
    p.setting,
    startedAt,
    JSON.stringify(vals),
    JSON.stringify(p.features ?? {}),
    p.traces ? JSON.stringify(p.traces) : null,
    JSON.stringify(p.device ?? null),
    now(),
    o.origin?.via ?? null,
    o.origin?.src ?? null,
    o.unreadable?.length ? JSON.stringify(o.unreadable) : null,
    p.stim ?? null,
    p.stepReadings ? JSON.stringify(p.stepReadings) : null,
  )
}

/** Hall guests and their full pings, oldest first: the raw material of the wall. */
export interface WallRow {
  user_id: string
  name: string
  started_at: string
  created_at: string
  vals: string
  device: string | null
  via: string | null
}
export interface HallRow extends WallRow {
  id: string
  features: string
  unreadable: string | null
  step_readings: string | null
  created_at: string
}
export const hallRows = () =>
  db.query(
    `SELECT p.id, p.user_id, u.name, p.started_at, p.created_at, p.vals, p.features, p.device, p.via, p.unreadable, p.step_readings
     FROM pings p JOIN users u ON u.id = p.user_id
     WHERE u.visitor = 1 AND u.hidden = 0 AND p.kind = 'hall' ORDER BY p.started_at, p.created_at`,
  ).all() as HallRow[]
export const wallRows = () =>
  db
    .query(
      `SELECT p.user_id, u.name, p.started_at, p.created_at, p.vals, p.device, p.via FROM pings p JOIN users u ON u.id = p.user_id
       WHERE u.visitor = 1 AND u.hidden = 0 AND p.kind = 'full' ORDER BY p.started_at, p.created_at`,
    )
    .all() as WallRow[]
export const wallStarted = (vias: string[]) =>
  (db.query(`SELECT COUNT(*) AS n FROM users WHERE visitor = 1 AND hidden = 0 AND via IN (${vias.map(() => '?').join(',')})`).get(...vias) as { n: number }).n

export const metaGet = (k: string) => (db.query('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | null)?.v ?? null
export const metaSet = (k: string, v: string) => db.query('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(k, v)
export const setPingMessage = (id: string, message: string) => db.query('UPDATE pings SET message = ? WHERE id = ?').run(message, id)
export const pingMessages = (userId: string) =>
  new Map((db.query('SELECT id, message FROM pings WHERE user_id = ?').all(userId) as { id: string; message: string | null }[]).map((r) => [r.id, r.message]))
export function pingTraces(id: string): unknown | null {
  const r = db.query('SELECT traces FROM pings WHERE id = ?').get(id) as { traces: string | null } | null
  return r?.traces ? JSON.parse(r.traces) : null
}

export function insertDose(id: string, d: DoseUpload, startedAt: string, reward: number | null): void {
  db.query(
    'INSERT INTO doses (id, user_id, dose, started_at, duration_s, pre_ping_id, post_ping_id, felt, metrics, reward, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, d.userId, d.dose, startedAt, d.durationS ?? null, d.prePingId ?? null, d.postPingId ?? null, d.felt ?? null, JSON.stringify(d.metrics ?? {}), reward, now())
}

/** A real person as the engine sees them. */
export function loadPerson(id: string): Person | null {
  const u = getUser(id)
  if (!u) return null
  const pings = (
    db.query('SELECT id, kind, setting, started_at, vals, features, stim FROM pings WHERE user_id = ? ORDER BY started_at, created_at').all(id) as {
      id: string
      kind: PingRec['kind']
      setting: PingRec['setting']
      started_at: string
      vals: string
      features: string
      stim: string | null
    }[]
  ).map((r): PingRec => {
    const f = JSON.parse(r.features ?? '{}') as { smile?: { alreadySmiling?: boolean; latencyMs?: number | null }; heart?: { swingSe?: number | null } }
    return { id: r.id, at: r.started_at, setting: r.setting, kind: r.kind, values: JSON.parse(r.vals), stim: r.stim ?? undefined, alreadySmiling: f.smile?.alreadySmiling === true, smileLatencyMs: typeof f.smile?.latencyMs === 'number' ? f.smile.latencyMs : null, heartSwingSe: typeof f.heart?.swingSe === 'number' ? f.heart.swingSe : null }
  })
  const doses = (
    db.query('SELECT dose, started_at, reward, felt FROM doses WHERE user_id = ? ORDER BY started_at, created_at').all(id) as {
      dose: DoseKind
      started_at: string
      reward: number | null
      felt: number | null
    }[]
  ).map((r): DoseRec => ({ at: r.started_at, dose: r.dose, reward: r.reward, felt: r.felt }))
  return { id: u.id, name: u.name, synthetic: false, course: null, pings, doses, phq2: listPHQ2(id), createdAt: u.created_at }
}

export const setBooster = (id: string, on: boolean) =>
  db.query('INSERT INTO boosters (patient_id, is_on, at) VALUES (?, ?, ?) ON CONFLICT (patient_id) DO UPDATE SET is_on = excluded.is_on, at = excluded.at').run(id, on ? 1 : 0, now())
export const getBooster = (id: string) => ((db.query('SELECT is_on FROM boosters WHERE patient_id = ?').get(id) as { is_on: number } | null)?.is_on ?? 0) === 1
export const boosterSet = () => new Set((db.query('SELECT patient_id FROM boosters WHERE is_on = 1').all() as { patient_id: string }[]).map((r) => r.patient_id))

export const cacheGet = (hash: string) => (db.query('SELECT text FROM llm_cache WHERE hash = ?').get(hash) as { text: string } | null)?.text ?? null
export const cachePut = (hash: string, text: string) => db.query('INSERT OR REPLACE INTO llm_cache (hash, text, created_at) VALUES (?, ?, ?)').run(hash, text, now())
