// /#/try: one minute of breathing with the sea, read from a phone's own motion sensor. Every try is kept as one
// line of try.jsonl beside the ear recordings: what the phone read at each check, what the sea did, and the motion
// rows themselves. A try is not a practice: it goes to no person, no big screen, no learner and no clinic list.
//   POST /api/try   the page, at the end of a try (and with a beacon when it is left mid-way)
//   GET  /api/try   worker only: how many, and the last 20 without their rows
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context, Hono } from 'hono'

const FILE = () => join(process.env.VIRE_EAR_DIR || '/bulk2/runs/depression/ear/recordings/', 'try.jsonl')
export const TRY_MAX_BYTES = 2_000_000
const MAX_ROWS = 12_000

export interface TryCheck {
  t: number
  t0?: number
  from: number
  to: number
  follows: boolean
  readable: boolean
  still: boolean
  coherence: number
  amplitudeDeg: number
  moveDegS: number | null
  perMin: number | null
  conf: number
  by: 'breath' | 'stillness' | 'held'
  /** the phone's readings stopped for a moment in this stretch */
  gap?: boolean
}
export interface TryLog {
  v: 1
  id: string
  /** when the sea began, on the phone's clock */
  at: string
  ua: string
  /** samples a second the phone's sensor gave, and what they were put on */
  sampleHz: number
  rowHz: number
  /** how it ended: the minute ran out, Done was tapped, the page was left, or the phone gave no motion */
  ended: 'time' | 'done' | 'left' | 'no-motion' | 'refused'
  ms: number
  checks: TryCheck[]
  result: { from: number; to: number; checks: number; followed: number; byStill: number; notFollowed: number; moving: number }
  /** the sea: pieces made on Modal, or the phone's own tone */
  sound: 'modal' | 'tone'
  pieces: { id: string; t: number; made: 'live' | 'set' }[]
  breaths: number[][]
  /** [tMs, tilt, tilt, tilt, gx, gy, gz, 0, 0, 0] */
  rows: number[][]
  /** [tMs, degrees a second about x, y, z] */
  gyro: number[][]
  /** rows were left out because the phone would not send that much on leaving */
  rowsLeftOut?: boolean
  speed?: number
  /** times the sensor stopped for over a second, and pauses of 0.3 to 1 second that were joined */
  holes?: number
  joined?: number
  screen?: string
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const numOrNull = (n: unknown): n is number | null => n === null || finite(n)
const table = (x: unknown, width: number): x is number[][] => Array.isArray(x) && x.length <= MAX_ROWS && x.every((r) => Array.isArray(r) && r.length === width && r.every(finite))
const count = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1000
const pace = (n: unknown): n is number => finite(n) && n >= 3 && n <= 30
const ENDED = ['time', 'done', 'left', 'no-motion', 'refused'] as const

export function checkTryLog(x: unknown): TryLog | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Partial<TryLog>
  if (r.v !== 1 || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(r.id) || typeof r.at !== 'string' || typeof r.ua !== 'string') return null
  if (!finite(r.sampleHz) || r.sampleHz < 0 || r.sampleHz > 2000 || !finite(r.rowHz) || r.rowHz < 0 || r.rowHz > 200) return null
  if (!finite(r.ms) || r.ms < 0 || r.ms > 3_600_000 || !ENDED.includes(r.ended as (typeof ENDED)[number])) return null
  if (!table(r.rows, 10) || !table(r.gyro, 4) || !table(r.breaths, 4) || !Array.isArray(r.checks) || r.checks.length > 200 || !Array.isArray(r.pieces) || r.pieces.length > 50) return null
  if (r.sound !== 'modal' && r.sound !== 'tone') return null
  const checks: TryCheck[] = []
  for (const c of r.checks) {
    if (!c || !finite(c.t) || !pace(c.from) || !pace(c.to) || typeof c.follows !== 'boolean' || typeof c.readable !== 'boolean' || typeof c.still !== 'boolean') return null
    if (!finite(c.coherence) || !finite(c.amplitudeDeg) || !numOrNull(c.moveDegS) || !numOrNull(c.perMin) || !finite(c.conf) || (c.by !== 'breath' && c.by !== 'stillness' && c.by !== 'held')) return null
    checks.push({ t: c.t, ...(finite(c.t0) ? { t0: c.t0 } : {}), from: c.from, to: c.to, follows: c.follows, readable: c.readable, still: c.still, coherence: c.coherence, amplitudeDeg: c.amplitudeDeg, moveDegS: c.moveDegS, perMin: c.perMin, conf: c.conf, by: c.by, ...((c as { gap?: unknown }).gap === true ? { gap: true } : {}) })
  }
  const k = r.result
  if (!k || !pace(k.from) || !pace(k.to) || !count(k.checks) || !count(k.followed) || !count(k.byStill) || !count(k.notFollowed) || !count(k.moving)) return null
  const pieces = r.pieces.filter((p) => !!p && typeof p.id === 'string' && p.id.length <= 120 && finite(p.t) && (p.made === 'live' || p.made === 'set')).map((p) => ({ id: p.id, t: p.t, made: p.made }))
  if (pieces.length !== r.pieces.length) return null
  return {
    v: 1,
    id: r.id,
    at: r.at.slice(0, 40),
    ua: r.ua.slice(0, 300),
    sampleHz: r.sampleHz,
    rowHz: r.rowHz,
    ended: r.ended as TryLog['ended'],
    ms: r.ms,
    checks,
    result: { from: k.from, to: k.to, checks: k.checks, followed: k.followed, byStill: k.byStill, notFollowed: k.notFollowed, moving: k.moving },
    sound: r.sound,
    pieces,
    breaths: r.breaths,
    rows: r.rows,
    gyro: r.gyro,
    ...(r.rowsLeftOut === true ? { rowsLeftOut: true } : {}),
    ...(finite(r.speed) && r.speed !== 1 ? { speed: r.speed } : {}),
    ...(count(r.holes) ? { holes: r.holes } : {}),
    ...(count(r.joined) ? { joined: r.joined } : {}),
    ...(typeof r.screen === 'string' ? { screen: r.screen.slice(0, 20) } : {}),
  }
}

export interface TryRouteDeps {
  allow: (a: unknown, bucket: string, max: number) => boolean
  asker: (c: Context, bodyUa?: unknown) => unknown
  tooMany: (c: Context) => Response
  isWorker: (c: Context) => boolean
}

type Kept = TryLog & { saved: string; via?: string; src?: string | null }

/** every line of the file that is a try, oldest first; a half-written last line is skipped */
async function readAll(): Promise<Kept[]> {
  let text = ''
  try {
    text = await readFile(FILE(), 'utf8')
  } catch {
    return []
  }
  const out: Kept[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const r = JSON.parse(line) as Kept
      if (r?.v === 1) out.push(r)
    } catch {
      /* half-written line */
    }
  }
  return out
}

export function registerTryRoutes(app: Hono, deps: TryRouteDeps): void {
  app.post('/api/try', async (c) => {
    const who = deps.asker(c) as { via?: string; src?: string | null } | undefined
    if (!deps.allow(who, 'try', 40)) return deps.tooMany(c)
    if (Number(c.req.header('content-length') ?? 0) > TRY_MAX_BYTES) return c.json({ error: 'too large' }, 413)
    const bytes = await c.req.arrayBuffer().catch(() => new ArrayBuffer(TRY_MAX_BYTES + 1))
    if (bytes.byteLength > TRY_MAX_BYTES) return c.json({ error: 'too large' }, 413)
    const body = (() => {
      try {
        return JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        return null
      }
    })()
    const log = checkTryLog(body)
    if (!log) return c.json({ error: 'not a try' }, 400)
    const kept: Kept = { ...log, saved: new Date().toISOString(), ...(who?.via ? { via: who.via } : {}), ...(who?.src ? { src: who.src } : {}) }
    await mkdir(join(FILE(), '..'), { recursive: true })
    await appendFile(FILE(), `${JSON.stringify(kept)}\n`)
    return c.json({ id: log.id, rows: log.rows.length, checks: log.checks.length })
  })
  app.get('/api/try', async (c) => {
    if (!deps.isWorker(c)) return c.json({ error: 'not allowed' }, 401)
    const all = await readAll()
    // a try left mid-way and then finished is two lines with one id: the later line is the try
    const byId = new Map<string, Kept>()
    for (const r of all) byId.set(r.id, r)
    const tries = [...byId.values()]
    const last = tries.slice(-20).reverse().map(({ rows, gyro, breaths, ...rest }) => ({ ...rest, rows: rows.length, gyro: gyro.length, breaths: breaths.length }))
    return c.json({ count: tries.length, lines: all.length, last })
  })
}
