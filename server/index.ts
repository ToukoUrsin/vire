// Vire server: API, learning engine, synthetic cohort, live relay, static web build.
//   cd server && hsec exec --only CLIPROXY_API_KEY -- bun run index.ts     -> 127.0.0.1:8871
// Env: PORT (default 8871), VIRE_DB (default ./vire.sqlite), VIRE_LLM=off to skip the LLM polish.
// Test instances only: VIRE_WALL_LOCAL=1 counts pings from this machine on the hall wall (and trusts their startedAt),
// VIRE_WALL_T0=<ISO> moves the wall's hour zero, VIRE_RATE=off drops the per-address limits.
import type { ServerWebSocket } from 'bun'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from 'hono'
import type {
  Channel,
  DoseResult,
  DoseSuggestion,
  DoseUpload,
  Echo,
  LiveMessage,
  PatientDetail,
  PatientRow,
  PingTraces,
  PingUpload,
  PingUploadExtras,
  UserCreate,
  WallState,
  PHQ2Upload,
} from '../shared/types'
import { buildDetail, buildRow } from './clinic'
import { bookingStore, nextSlots, resolveBooking, seededBooking, slotOk } from './outerloop'
import type { RowFacts } from './clinic'
import { generateCohort, synthTraces } from './cohort'
import type { SynthPerson } from './cohort'
import {
  boosterSet,
  createUser,
  getBooster,
  getUser,
  insertDose,
  insertPing,
  listPatients,
  insertPHQ2,
  listPHQ2,
  listUsers,
  loadPerson,
  metaGet,
  metaSet,
  newId,
  pingMessages,
  pingTraces,
  setBooster,
  setPingMessage,
  wallRows,
  wallStarted,
  hallRows,
  db,
} from './db'
import type { Origin } from './db'
import { CHANNELS, DOSES, DOSE_LABEL, analyze, beliefs, channelValues, clamp, cohortPrior, dayKey, doseMessage, doseReward, echoMessage, hashSeed, mulberry32, suggest, toEcho } from './engine'
import type { Analysis, Person, Prior } from './engine'
import { llmStatus, polish, polished, warm } from './llm'
import { WALL_T0, absurd, buildWall, demoWall, deviceFamily, isTestUa } from './wall'
import type { WallInput } from './wall'
import { dailyAudio, dailyStatus, ensureDaily } from './daily'
import { appendHallLog, buildHallToday, hallDayStart, hallIsCounted } from './hall'
import { listEar, mineEar, ownerOf, readEar, readMine, saveEar } from './ear'
import type { EarUpload } from '../shared/ear'
import { claimEarJob, failEarJob, finishEarJob, getEarJob, landEarJob, latestEarJob, latestEarJobOf, noteDailyMinute, noteEarDays, queueEarJob, updateEarProgress } from './earjobs'
import { claimCohort, finishCohort, latestCohort, progressCohort, startCohort } from './cohortrun'
import { latestSession, listSessions, mineSessions, readSessionFile, saveSession } from './earsessions'
import { clearReplay, currentReplay, pickReplay } from './earreplay'
import { registerSoundRoutes } from './sound'
import { registerPassiveRoutes } from './earpassive'
import { registerEegRoutes } from './eeglog'

const PORT = Number(process.env.PORT ?? 8871)

// ---------- people ----------

interface Cohort {
  key: number
  people: SynthPerson[]
  byId: Map<string, { person: SynthPerson; analysis: Analysis }>
  prior: Prior
}
let cohortCache: Cohort | null = null
/** The synthetic cohort, regenerated every 10 minutes so "today" keeps moving. Same seed: same people, same history. */
function cohort(now = Date.now()): Cohort {
  const key = Math.floor(now / 600_000)
  if (cohortCache?.key === key) return cohortCache
  const people = generateCohort(now)
  const byId = new Map(people.map((person) => [person.id, { person, analysis: analyze(person.pings, person.course?.end) }]))
  cohortCache = { key, people, byId, prior: cohortPrior(people.flatMap((p) => p.doses)) }
  return cohortCache
}

function findPerson(id: string): { person: Person; analysis: Analysis } | null {
  const s = cohort().byId.get(id)
  if (s) return s
  const person = loadPerson(id)
  return person ? { person, analysis: analyze(person.pings, null) } : null
}

/** Thompson draw, seeded by the person's state so it only changes when they ping or take a dose. */
function suggestionFor(p: Person, now = Date.now()): DoseSuggestion {
  const wobble = analyze(p.pings, p.course?.end).wobble
  const seed = `${p.id}|${dayKey(now)}|${p.doses.length}|${p.pings.length}`
  const today = dayKey(now)
  const lastToday = [...p.doses].reverse().find((d) => dayKey(d.at) === today)?.dose
  let out = suggest(p.doses, cohort().prior, mulberry32(hashSeed(seed)), wobble)
  if (lastToday && out.dose === lastToday) {
    // A dose is a once-a-day experiment: keep today's pick out of the next card.
    for (let i = 1; i < 8 && out.dose === lastToday; i++) out = suggest(p.doses, cohort().prior, mulberry32(hashSeed(`${seed}|${i}`)), wobble)
    if (out.dose === lastToday) {
      const alt = DOSES.find((d) => d !== lastToday) ?? 'wait'
      out = { ...out, dose: alt, reason: `Try ${DOSE_LABEL[alt]} today; ${DOSE_LABEL[lastToday]} was already done today.` }
    }
  }
  return out
}

const iso = (s: unknown): string => {
  const t = typeof s === 'string' || typeof s === 'number' ? new Date(s).getTime() : NaN
  const now = Date.now()
  return new Date(Number.isFinite(t) && t < now + 300_000 ? t : now).toISOString()
}
const okId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s)
const roomOf = (userId: string) => userId.slice(0, 6).toUpperCase()

// Small built-in directory for the demo. Prefixes keep film, demo and automated test
// runs usable without adding fake clinics to the directory.
export const CLINICS: Record<string, string> = { AALTO: 'Aalto TMS clinic', 'AALTO-TMS': 'Aalto TMS clinic' }
function clinicName(code: string): string | null {
  const c = code.trim().toUpperCase()
  if (!c) return null
  if (CLINICS[c]) return CLINICS[c]!
  if (/^(FILM|DEMO|TEST)-/.test(c)) return 'Test clinic'
  return null
}

// ---------- live relay ----------

interface WsData {
  room: string
  role: 'sensor' | 'viewer'
  name: string
}
type WS = ServerWebSocket<WsData>
interface Room {
  code: string
  name: string
  since: string
  sensors: Set<WS>
  viewers: Set<WS>
}
const rooms = new Map<string, Room>()
/** viewers of room `*`: they get every room's messages as { room, name, msg } */
const wall = new Set<WS>()

function toViewers(room: Room, msg: LiveMessage | string): void {
  const raw = typeof msg === 'string' ? msg : JSON.stringify(msg)
  for (const v of room.viewers) v.send(raw)
  if (wall.size) {
    const wrapped = `{"room":${JSON.stringify(room.code)},"name":${JSON.stringify(room.name)},"msg":${raw}}`
    for (const v of wall) v.send(wrapped)
  }
}
const isLive = (userId: string) => (rooms.get(roomOf(userId))?.sensors.size ?? 0) > 0

const websocket = {
  open(ws: WS) {
    const { room: code, role, name } = ws.data
    if (role === 'viewer' && code === '*') {
      wall.add(ws)
      for (const r of rooms.values()) {
        if (r.sensors.size) ws.send(JSON.stringify({ room: r.code, name: r.name, msg: { type: 'hello', role: 'sensor', name: r.name } }))
      }
      return
    }
    let room = rooms.get(code)
    if (!room) {
      room = { code, name: name || code, since: new Date().toISOString(), sensors: new Set(), viewers: new Set() }
      rooms.set(code, room)
    }
    if (role === 'sensor') {
      if (!room.sensors.size) room.since = new Date().toISOString()
      if (name) room.name = name
      room.sensors.add(ws)
      toViewers(room, { type: 'hello', role: 'sensor', name: room.name })
    } else {
      room.viewers.add(ws)
      if (room.sensors.size) ws.send(JSON.stringify({ type: 'hello', role: 'sensor', name: room.name }))
    }
  },
  message(ws: WS, data: string | Buffer) {
    if (ws.data.role !== 'sensor') return
    const room = rooms.get(ws.data.room)
    if (!room) return
    const raw = typeof data === 'string' ? data : data.toString('utf8')
    try {
      JSON.parse(raw) // only well-formed JSON is relayed
    } catch {
      return
    }
    toViewers(room, raw)
  },
  close(ws: WS) {
    wall.delete(ws)
    const room = rooms.get(ws.data.room)
    if (!room) return
    room.viewers.delete(ws)
    if (room.sensors.delete(ws) && !room.sensors.size) toViewers(room, { type: 'phase', phase: 'idle', at: Date.now() })
    if (!room.sensors.size && !room.viewers.size) rooms.delete(room.code)
  },
}

// ---------- who is asking ----------
// The public mount (Tailscale funnel) sets X-Forwarded-For; a request without it comes from this machine (the team's
// dev servers and tests). Only public requests are limited, and only public pings count on the hall wall.

const LIMITS_ON = process.env.VIRE_RATE !== 'off'
const SALT = metaGet('salt') ?? (metaSet('salt', crypto.randomUUID()), metaGet('salt')!)
const tagOf = (s: string, len: number) => new Bun.CryptoHasher('sha256').update(`${SALT}|${s}`).digest('hex').slice(0, len)

interface Asker extends Origin {
  ip: string | null
}
function asker(c: Context, bodyUa?: unknown): Asker {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || null
  const test = isTestUa(c.req.header('user-agent') ?? '') || (typeof bodyUa === 'string' && isTestUa(bodyUa))
  return { ip, via: test ? 'test' : ip ? 'public' : 'local', src: ip ? tagOf(ip, 8) : null }
}

const WINDOW_MS = 600_000
const windows = new Map<string, { n: number; until: number }>()
/** At most `max` per ten minutes per source address. A whole hall can sit behind one address, so the caps are roomy. */
function allow(a: Asker, bucket: string, max: number): boolean {
  if (!a.ip || !LIMITS_ON) return true
  const now = Date.now()
  const k = `${bucket}|${a.ip}`
  const w = windows.get(k)
  if (!w || w.until <= now) {
    windows.set(k, { n: 1, until: now + WINDOW_MS })
    return true
  }
  return ++w.n <= max
}
setInterval(() => {
  const now = Date.now()
  for (const [k, w] of windows) if (w.until <= now) windows.delete(k)
}, 60_000)
const tooMany = (c: Context) => c.json({ error: 'too many requests from this network, try again in a few minutes' }, 429, { 'retry-after': '120' })
const LIMIT = { users: 60, pings: 300, pingsPerUser: 20 }

// ---------- API ----------

const app = new Hono()
app.use('/api/*', cors())
// When a phone last sent anything from a practice, a teaching minute or its day. The Mac that puts a new build on
// the iPhone asks this first, so that it never replaces the app while Vire is in use. The worker's own calls do
// not count. Seconds only: nothing about anyone.
let lastPhonePost = Date.now()
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'POST' && /^\/api\/(ear|sound)\//.test(c.req.path) && !c.req.header('authorization')) lastPhonePost = Date.now()
  await next()
})
app.get('/api/ear/quiet', (c) => c.json({ quietS: Math.round((Date.now() - lastPhonePost) / 1000) }))
app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}`, err)
  return c.json({ error: String(err instanceof Error ? err.message : err) }, 500)
})
registerSoundRoutes(app)

app.get('/api/health', (c) => c.json({ ok: true, via: asker(c).via }))

// Daily media is generated in the background. These routes are intentionally before
// the API catch-all so a phone can use a shipped clip while the morning generation runs.
app.get('/api/daily', async (c) => c.json(await dailyStatus()))
app.get('/api/daily/:kind', async (c) => {
  const kind = c.req.param('kind').replace(/\.mp3$/, '')
  if (kind !== 'laugh' && kind !== 'question') return c.text('not found', 404)
  try {
    const out = await dailyAudio(kind)
    return new Response(out.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-cache', 'content-length': String(out.body.byteLength) } })
  } catch {
    return c.text('audio unavailable', 503)
  }
})

app.get('/api/clinics/:code', (c) => {
  const code = c.req.param('code')
  const name = clinicName(code)
  return name ? c.json({ code, name }) : c.json({ error: 'Unknown clinic code' }, 404)
})

app.post('/api/users', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as UserCreate
  const a = asker(c)
  if (!allow(a, 'users', LIMIT.users)) return tooMany(c)
  const code = typeof body?.clinicCode === 'string' ? body.clinicCode.trim() : ''
  if (code && !clinicName(code)) return c.json({ error: 'Unknown clinic code' }, 400)
  const u = createUser(typeof body?.name === 'string' ? body.name : null, code || null, undefined, {
    visitor: body?.visitor === true,
    origin: a,
  })
  wallCache = null
  return c.json({ userId: u.id, name: u.name })
})

function patientFacts(echo: Echo, nFull: number) {
  return {
    status: echo.status,
    strength: Math.round(echo.strength),
    pingsSoFar: nFull,
    notes: echo.components.map((x) => x.note),
    suggestion: echo.suggestion?.dose ?? null,
  }
}

/** A hall guest has no "usual" to be told about: they are pointed at the wall instead. */
const visitorMessage = (nFull: number) =>
  nFull >= 2
    ? 'Welcome back. The wall now shows how you moved since your first ping.'
    : 'Thank you. Your echo is on the hall wall now. Come back in a few hours and it will show how you moved.'

app.post('/api/pings', async (c) => {
  const body = (await c.req.json().catch(() => null)) as (PingUpload & PingUploadExtras) | null
  if (!body || !okId(body.userId) || typeof body.features !== 'object' || !body.features) {
    return c.json({ error: 'userId and features are required' }, 400)
  }
  if (cohort().byId.has(body.userId)) return c.json({ error: 'synthetic patients are read-only' }, 400)
  const baseWho = asker(c, body.device?.ua)
  const who = body.test === true ? { ...baseWho, via: 'test' as const } : baseWho
  if (!allow(who, 'pings', LIMIT.pings) || !allow(who, `pings:${body.userId}`, LIMIT.pingsPerUser)) return tooMany(c)
  const kind = body.kind === 'mini' ? 'mini' : body.kind === 'hall' ? 'hall' : 'full'
  const setting = body.setting === 'clinic' ? 'clinic' : 'home'
  // the endpoint is public: a value no phone can produce, or a body far larger than a ping, is refused
  const vals = channelValues(body.features, kind)
  if (absurd(vals) || JSON.stringify(body.features).length > 20_000) return c.json({ error: 'values out of range' }, 400)
  // channels the phone could not measure are stored as null: they move neither the echo nor the baseline
  const unreadable: Channel[] = Array.isArray(body.unreadable) ? CHANNELS.filter((ch) => body.unreadable!.includes(ch)) : []
  for (const ch of unreadable) vals[ch] = null
  const traces = body.traces && JSON.stringify(body.traces).length <= 600_000 ? body.traces : undefined
  const device = {
    ua: String(body.device?.ua ?? c.req.header('user-agent') ?? '').slice(0, 400),
    native: body.device?.native === true,
    airpodsMotion: body.device?.airpodsMotion === true,
    airpodsHr: body.device?.airpodsHr === true,
  }
  if (!getUser(body.userId)) {
    // a phone with a stale id still works
    if (!allow(who, 'users', LIMIT.users)) return tooMany(c)
    createUser(null, null, body.userId, { visitor: body.visitor === true, origin: who })
  }
  const id = newId()
  insertPing(id, { ...body, kind, setting, traces, device }, iso(body.startedAt), vals, { origin: who, unreadable })
  wallCache = null

  const person = loadPerson(body.userId)!
  const a = analyze(person.pings)
  const calc = a.echoes.find((e) => e.pingId === id)!
  const suggestion = kind === 'full' ? suggestionFor(person) : null
  const visitor = getUser(body.userId)?.visitor === 1
  const fallback = visitor && (kind === 'full' || kind === 'hall') ? visitorMessage(a.nFull) : echoMessage(calc, a.nFull)
  const draft = toEcho(calc, fallback, suggestion, body.stim, a.wobble, a.nFull)
  // hall guests get the plain line at once: the model is kept for the people Vire is built for
  const message = kind === 'full' && !visitor ? await polish('patient', patientFacts(draft, a.nFull), fallback, 2500) : fallback
  setPingMessage(id, message)
  const counted = who.via === 'public' || (WALL_LOCAL && who.via === 'local')
  let hallGuest: number | undefined
  let hallCount: number | undefined
  if (kind === 'hall' && visitor) {
    const row = hallRows().find((r) => r.id === id)
    if (row && hallIsCounted(row)) {
      const today = buildHallToday(hallRows())
      hallGuest = today.people.find((p) => p.at === row.started_at)?.guest
      hallCount = today.count
      if (hallGuest != null) appendHallLog(row, hallGuest)
    }
  }
  const echo: Echo = { ...draft, message, stim: body.stim, ...(visitor ? { wallCounted: counted, hallGuest, hallCount } : {}) }
  const room = rooms.get(roomOf(body.userId))
  // the phone sends its own echo over the socket; only stand in for it when no sensor is connected
  if (room && !room.sensors.size && kind === 'full') toViewers(room, { type: 'echo', echo })
  return c.json(echo)
})

/** Weekly PHQ-2 answers. The app sends item scores only; the server stores the total for the clinic. */
app.post('/api/checks', async (c) => {
  const body = (await c.req.json().catch(() => null)) as PHQ2Upload | null
  if (!body || !okId(body.userId) || !Array.isArray(body.items) || body.items.length !== 2 || body.items.some((x) => !Number.isInteger(x) || x < 0 || x > 3)) {
    return c.json({ error: 'userId and two PHQ-2 answers (0 to 3) are required' }, 400)
  }
  if (cohort().byId.has(body.userId)) return c.json({ error: 'synthetic patients are read-only' }, 400)
  const who = asker(c)
  if (!getUser(body.userId)) {
    if (!allow(who, 'users', LIMIT.users)) return tooMany(c)
    createUser(null, null, body.userId, { origin: who })
  }
  const at = iso(body.at)
  const check = insertPHQ2(newId(), { userId: body.userId, items: [body.items[0]!, body.items[1]!] }, at)
  return c.json(check)
})

app.get('/api/users/:id/checks', (c) => c.json(listPHQ2(c.req.param('id'))))

app.get('/api/users/:id/echoes', (c) => {
  const id = c.req.param('id')
  const f = findPerson(id)
  if (!f) return c.json([])
  const all = c.req.query('all') != null // ?all=1 also returns the mini pings taken after a dose
  const messages = f.person.synthetic ? null : pingMessages(id)
  const shown = f.analysis.echoes.filter((e) => all || e.kind === 'full')
  const lastFull = shown.filter((e) => e.kind === 'full').at(-1)
  const echoes: Echo[] = shown.map((e) =>
    toEcho(e, messages?.get(e.pingId) ?? echoMessage(e, f.analysis.nFull), e === lastFull ? suggestionFor(f.person) : null, f.person.pings.find((p) => p.id === e.pingId)?.stim, f.analysis.wobble, f.analysis.nFull),
  )
  return c.json(echoes)
})

app.post('/api/doses', async (c) => {
  const body = (await c.req.json().catch(() => null)) as DoseUpload | null
  if (!body || !okId(body.userId) || !DOSES.includes(body.dose)) return c.json({ error: 'userId and a known dose are required' }, 400)
  if (cohort().byId.has(body.userId)) return c.json({ error: 'synthetic patients are read-only' }, 400)
  if (!getUser(body.userId)) {
    const who = asker(c)
    if (!allow(who, 'users', LIMIT.users)) return tooMany(c)
    createUser(null, null, body.userId, { origin: who })
  }
  const startedAt = iso(body.startedAt)
  const person = loadPerson(body.userId)!
  const a = analyze(person.pings)
  const byId = new Map(a.echoes.map((e) => [e.pingId, e]))
  const post = body.postPingId ? byId.get(body.postPingId) : null
  // no pre ping named: the last full ping before the mini ping (or before the dose) is the "before"
  const cutoff = new Date(post?.at ?? startedAt).getTime()
  const pre = body.prePingId
    ? byId.get(body.prePingId)
    : a.echoes.filter((e) => e.kind === 'full' && new Date(e.at).getTime() <= cutoff && e.pingId !== post?.pingId).at(-1)
  const felt = body.felt === 1 || body.felt === 0 || body.felt === -1 ? body.felt : null
  const measuredReward = doseReward(pre, post, felt)
  // Once the no-dose arm has two observations, every other lift is relative to
  // what two quiet minutes do on their own.
  const waits = person.doses.filter((d) => d.dose === 'wait' && d.reward != null).map((d) => d.reward as number)
  const waitMean = waits.length >= 2 ? waits.reduce((a, b) => a + b, 0) / waits.length : 0
  const reward = measuredReward == null ? null : body.dose === 'wait' || waits.length < 2 ? measuredReward : Math.round((measuredReward - waitMean) * 10) / 10
  insertDose(newId(), { ...body, felt }, startedAt, reward)
  const after = loadPerson(body.userId)!
  const result: DoseResult = { reward: reward ?? 0, change: measuredReward, beliefs: beliefs(after.doses, cohort().prior), message: doseMessage(body.dose, reward) }
  return c.json(result)
})

app.get('/api/users/:id/suggestion', (c) => {
  const f = findPerson(c.req.param('id'))
  return c.json(f ? suggestionFor(f.person) : null)
})

app.get('/api/users/:id/notice', (c) => {
  const booster = getBooster(c.req.param('id'))
  return c.json({
    booster,
    message: booster ? 'Your clinic would like to see you for a check-in. They will be in touch to find a time that suits you.' : null,
  })
})

// ---------- clinic ----------

// booster bookings made on the clinic screen; a simulated person's own story can carry one too (outerloop.ts)
const bookings = bookingStore(db)
const bookingOf = (person: Person) => resolveBooking(bookings.get(person.id), seededBooking(person))
function takenSlots(): string[] {
  const stored = bookings.all()
  const seeded = cohort().people.filter((p) => !stored.has(p.id)).map((p) => p.booster?.at)
  return [...[...stored.values()].map((b) => b?.at), ...seeded].filter((x): x is string => !!x)
}

function rowFor(person: Person, analysis: Analysis, boosters: Set<string>, now: number): { row: PatientRow; facts: RowFacts } {
  const { row, facts } = buildRow(person, analysis, { now, live: !person.synthetic && isLive(person.id), booster: boosters.has(person.id), booking: bookingOf(person) })
  return { row: { ...row, reason: polished('reason', reasonFacts(row, facts), row.reason) }, facts }
}
function reasonFacts(row: PatientRow, f: RowFacts) {
  return { status: row.status, drift: row.drift, strength: row.strength, adherence7: row.adherence7, ...f, draft: row.reason }
}

/** Names never go to the model: the draft carries a placeholder that is put back afterwards. */
function summaryArgs(person: Person, detail: PatientDetail, facts: RowFacts) {
  const draft = detail.summary.replaceAll(person.name, '[NAME]')
  return { facts: { course: detail.course && { sessions: detail.course.sessions }, beliefs: detail.beliefs, ...reasonFacts(detail, facts), draft: undefined }, draft }
}
async function summaryFor(person: Person, detail: PatientDetail, facts: RowFacts, ms: number): Promise<string> {
  const a = summaryArgs(person, detail, facts)
  return (await polish('summary', a.facts, a.draft, ms)).replaceAll('[NAME]', person.name)
}

function clinicRows(now = Date.now(), warmDetails = false, showTests = false): PatientRow[] {
  const boosters = boosterSet()
  const out: PatientRow[] = []
  const seen = new Set<string>()
  const add = (person: Person, analysis: Analysis) => {
    if (seen.has(person.id)) return
    seen.add(person.id)
    const { row, facts } = rowFor(person, analysis, boosters, now)
    const plain = buildRow(person, analysis, { now, live: row.live, booster: row.boosterRequested, booking: bookingOf(person) }).row
    warm('reason', reasonFacts(plain, facts), plain.reason)
    if (warmDetails) {
      const a = summaryArgs(person, buildDetail(person, analysis, plain, facts, cohort().prior), facts)
      warm('summary', a.facts, a.draft)
    }
    out.push(row)
  }
  for (const { person, analysis } of cohort(now).byId.values()) add(person, analysis)
  // hall guests (visitor = 1) are on the wall, never in the clinic lists
  for (const u of listPatients()) {
    // people made by an automated test are shown to that test only: the clinic's list holds no test runs
    if (u.via === 'test' && !showTests) continue
    const person = loadPerson(u.id)
    // someone who typed a name and never pinged is not a patient yet (they show while their first ping is live)
    if (person && (person.pings.length || isLive(person.id))) add(person, analyze(person.pings))
  }
  return out.sort((x, y) => y.priority - x.priority || x.name.localeCompare(y.name))
}

app.get('/api/clinic/patients', (c) => c.json(clinicRows(Date.now(), false, asker(c).via === 'test')))

function latestTraces(person: Person): PingTraces | null {
  const pings = [...person.pings].reverse()
  if (person.synthetic) {
    const p = pings.find((x) => x.kind === 'full')
    return p ? synthTraces(p, (p as { rest?: number }).rest) : null
  }
  for (const p of pings.slice(0, 5)) {
    const t = pingTraces(p.id) as PingTraces | null
    if (t) return t
  }
  return null
}

app.get('/api/clinic/patients/:id', async (c) => {
  const f = findPerson(c.req.param('id'))
  if (!f) return c.json({ error: 'unknown patient' }, 404)
  const now = Date.now()
  const { row, facts } = rowFor(f.person, f.analysis, boosterSet(), now)
  const detail: PatientDetail = buildDetail(f.person, f.analysis, row, facts, cohort().prior)
  // the cohort's summaries are warmed at startup; a fresh one gets 1.5 s, then the template stands until the next open
  const summary = await summaryFor(f.person, detail, facts, 1500)
  // latestTraces is an extra beyond PatientDetail: 10 Hz traces of the latest ping, for the clinician's close-up
  return c.json({ ...detail, summary, latestTraces: latestTraces(f.person), boosterSlots: nextSlots(now, takenSlots(), 3) })
})

// Book a booster session ({ on: true, at?: ISO slot }; without `at`, the next free slot) or cancel it ({ on: false }).
// The person's app shows a check-in notice while one is booked. Booking is the clinician's decision, made on this screen.
app.post('/api/clinic/patients/:id/booster', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { on?: boolean; at?: unknown }
  if (!findPerson(id)) return c.json({ error: 'unknown patient' }, 404)
  if (body?.on === false) {
    bookings.set(id, null)
    setBooster(id, false)
    return c.json({ ok: true, booking: null })
  }
  const now = Date.now()
  if (body?.at !== undefined && !slotOk(body.at, now)) return c.json({ error: 'Pick a time in the next 60 days' }, 400)
  const at = body?.at !== undefined ? (body.at as string) : nextSlots(now, takenSlots(), 1)[0]
  if (!at) return c.json({ error: 'No free slot in the next 60 days' }, 409)
  const booking = bookings.set(id, new Date(at).toISOString(), now)
  setBooster(id, true)
  return c.json({ ok: true, booking })
})

/** Extra: traces for one ping (synthetic pings are drawn on demand, real ones are what the phone uploaded). */
app.get('/api/pings/:id/traces', (c) => {
  const id = c.req.param('id')
  for (const { person } of cohort().byId.values()) {
    if (!id.startsWith(person.id)) continue
    const p = person.pings.find((x) => x.id === id)
    return c.json(p ? synthTraces(p, (p as { rest?: number }).rest) : null)
  }
  return c.json(pingTraces(id))
})

app.get('/api/live/rooms', (c) =>
  c.json(
    [...rooms.values()]
      .filter((r) => r.sensors.size)
      .sort((x, y) => (x.since < y.since ? 1 : -1))
      .map((r) => ({ code: r.code, name: r.name, since: r.since })),
  ),
)

app.get('/api/hall/today', (c) => {
  c.header('cache-control', 'no-store')
  return c.json(buildHallToday(hallRows()))
})
app.get('/api/hall/today.jsonl', (c) => {
  c.header('content-type', 'application/x-ndjson; charset=utf-8')
  c.header('content-disposition', 'attachment; filename="hall-today.jsonl"')
  const state = buildHallToday(hallRows())
  return c.body(state.people.map((p) => JSON.stringify(p)).join('\n') + (state.people.length ? '\n' : ''))
})

// ---------- teaching minutes (AirPods motion next to what the camera saw) ----------
// Anyone may send one. Reading them back needs the worker's token: they are a person's own movement.
const WORKER_TOKEN = process.env.VIRE_WORKER_TOKEN || ''
const isWorker = (c: Context) => !!WORKER_TOKEN && c.req.header('authorization') === `Bearer ${WORKER_TOKEN}`
registerPassiveRoutes(app, { allow, asker, tooMany, isWorker })
registerEegRoutes(app, { allow, asker, tooMany, isWorker })

app.post('/api/ear/recordings', async (c) => {
  if (!allow(asker(c), 'ear', 40)) return tooMany(c)
  if (Number(c.req.header('content-length') ?? 0) > 3_000_000) return c.json({ error: 'too large' }, 413)
  const body = (await c.req.json().catch(() => null)) as EarUpload | null
  const kept = body ? await saveEar(body) : null
  if (!kept) return c.json({ error: 'not a teaching minute' }, 400)
  if (kept.daily) {
    // the day's minute, camera off: kept, read against the usual, and no search (nothing in it teaches)
    await noteDailyMinute(ownerOf(body!.key), kept.id).catch((e) => console.error('[ear] daily minute not noted', e))
    return c.json(kept)
  }
  const job = queueEarJob(kept.id, Date.now(), ownerOf(body!.key))
  // the minute as the AirPods alone felt it, next to the person's earlier ones: for the clinic's screen
  await noteEarDays(job.id).catch((e) => console.error('[ear] days not worked out', e))
  return c.json({ ...kept, jobId: job.id })
})
// A device reads its own minutes back with the key it made for itself and sent with them. Nobody else's.
const earKey = (c: Context) => (c.req.header('authorization') ?? '').replace(/^Bearer /, '')
app.get('/api/ear/mine', async (c) => {
  if (!allow(asker(c), 'ear-mine', 120)) return tooMany(c)
  const minutes = await mineEar(earKey(c), c.req.header('user-agent') ?? '')
  return minutes ? c.json({ minutes }) : c.json({ error: 'not allowed' }, 401)
})
// the device's newest search, with the model it found: only the device that holds the key gets it
app.get('/api/ear/mine/job', (c) => {
  if (!allow(asker(c), 'ear-mine', 120)) return tooMany(c)
  const job = latestEarJobOf(ownerOf(earKey(c)))
  return job ? c.json(job) : c.json({ error: 'no search yet' }, 404)
})
// what this device's own sessions did, and what was learned from them (before /mine/:id, which would take it)
app.get('/api/ear/mine/sessions', async (c) => {
  if (!allow(asker(c), 'ear-mine', 120)) return tooMany(c)
  const mine = await mineSessions(earKey(c))
  return mine ? c.json(mine) : c.json({ error: 'not allowed' }, 401)
})
app.get('/api/ear/mine/:id', async (c) => {
  if (!allow(asker(c), 'ear-mine', 120)) return tooMany(c)
  const text = await readMine(earKey(c), c.req.param('id'))
  return text ? c.body(text, 200, { 'content-type': 'application/json' }) : c.json({ error: 'not found' }, 404)
})
app.get('/api/ear/recordings', async (c) => (isWorker(c) ? c.json(await listEar()) : c.json({ error: 'not allowed' }, 401)))
app.get('/api/ear/recordings/:id', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const text = await readEar(c.req.param('id'))
  return text ? c.body(text, 200, { 'content-type': 'application/json' }) : c.json({ error: 'not found' }, 404)
})
// the newest search, for the big screen: the board and the scores, not the model itself
app.get('/api/ear/jobs/latest', (c) => {
  const job = latestEarJob()
  return job ? c.json(job) : c.json({ error: 'no search yet' }, 404)
})
// the person's device says the model the search found is now the one it runs
app.post('/api/ear/jobs/:id/landed', (c) => {
  const job = landEarJob(c.req.param('id'))
  return job ? c.json({ id: job.id, landedAt: job.landedAt }) : c.json({ error: 'not found or not done' }, 404)
})
app.get('/api/ear/jobs/:id', (c) => {
  const job = getEarJob(c.req.param('id'))
  return job ? c.json(job) : c.json({ error: 'not found' }, 404)
})
app.post('/api/ear/jobs/claim', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const claimed = await claimEarJob()
  if (!claimed) return c.body(null, 204)
  return c.json({ ...claimed.job, recording: claimed.recording, minutes: claimed.minutes })
})
app.post('/api/ear/jobs/:id/progress', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const body = (await c.req.json().catch(() => null)) as { tried?: unknown; seconds?: unknown } | null
  const job = body ? updateEarProgress(c.req.param('id'), body.tried, body.seconds) : null
  return job ? c.json(job) : c.json({ error: 'invalid progress or job is not running' }, 400)
})
app.post('/api/ear/jobs/:id/done', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const body = (await c.req.json().catch(() => null)) as { model?: unknown; board?: unknown; error?: unknown } | null
  if (body && typeof body.error === 'string') {
    const job = failEarJob(c.req.param('id'), body.error)
    return job ? c.json(job) : c.json({ error: 'job is not running' }, 409)
  }
  const job = body ? finishEarJob(c.req.param('id'), body.model, body.board) : null
  return job ? c.json(job) : c.json({ error: 'invalid model, board, or job is not running' }, 400)
})

// ---------- sessions in the AirPods (sound in the ears, the AirPods read before, during and after) ----------
// Anyone may send one. A device reads back what its own sessions did with its key (GET /api/ear/mine/sessions, above).
app.post('/api/ear/sessions', async (c) => {
  if (!allow(asker(c), 'ear-session', 30)) return tooMany(c)
  if (Number(c.req.header('content-length') ?? 0) > 8_000_000) return c.json({ error: 'too large' }, 413)
  const kept = await saveSession((await c.req.json().catch(() => null)) as { key?: unknown; session?: unknown } | null)
  return kept ? c.json(kept) : c.json({ error: 'not a session' }, 400)
})
app.get('/api/ear/sessions', async (c) => (isWorker(c) ? c.json(await listSessions()) : c.json({ error: 'not allowed' }, 401)))
// the newest practice, for the big screen: what it did and what was learned, never the rows (before /sessions/:id)
app.get('/api/ear/sessions/latest', async (c) => {
  const got = await latestSession()
  return got ? c.json(got) : c.json({ error: 'no practice yet' }, 404)
})
app.get('/api/ear/sessions/:id', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const text = await readSessionFile(c.req.param('id'))
  return text ? c.body(text, 200, { 'content-type': 'application/json' }) : c.json({ error: 'not found' }, 404)
})
// "Watch a run" (#/watch): one stored session played back for anyone without AirPods. The worker picks which one,
// and says whether it is a person's own run; until then the scripted run (a stand-in in the AirPods) is served.
app.get('/api/ear/replay', async (c) => {
  const got = await currentReplay()
  return got ? c.json(got) : c.json({ error: 'no replay' }, 404)
})
app.post('/api/ear/replay', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const got = await pickReplay((await c.req.json().catch(() => null)) as { id?: unknown; real?: unknown } | null)
  return got ? c.json({ id: got.id, real: got.real, label: got.label, at: got.at }) : c.json({ error: 'no such session' }, 404)
})
app.delete('/api/ear/replay', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  await clearReplay()
  return c.json({ ok: true })
})

// ---------- the whole clinic re-trains at once (simulated patients, one sandbox each) ----------
// Anyone on the big screen may start one; the server caps them (see cohortrun.ts). The worker runs the sandboxes.
app.post('/api/ear/cohort', async (c) => {
  if (!allow(asker(c), 'cohort', 10)) return tooMany(c)
  const body = (await c.req.json().catch(() => ({}))) as { patients?: unknown } | null
  const got = startCohort(body?.patients)
  return 'run' in got ? c.json(got.run, 201) : c.json({ error: got.error }, got.status)
})
app.get('/api/ear/cohort/latest', (c) => {
  const run = latestCohort()
  return run ? c.json(run) : c.json({ error: 'no run yet' }, 404)
})
app.post('/api/ear/cohort/claim', (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const claimed = claimCohort()
  return claimed ? c.json(claimed) : c.body(null, 204)
})
app.post('/api/ear/cohort/:id/progress', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const run = progressCohort(c.req.param('id'), await c.req.json().catch(() => null))
  return run ? c.json(run) : c.json({ error: 'invalid progress or the run is not running' }, 400)
})
app.post('/api/ear/cohort/:id/done', async (c) => {
  if (!isWorker(c)) return c.json({ error: 'not allowed' }, 401)
  const run = finishCohort(c.req.param('id'), await c.req.json().catch(() => null))
  return run ? c.json(run) : c.json({ error: 'invalid result or the run is not running' }, 400)
})

// ---------- hall wall ----------
// Hall guests' full pings as raw values against the hall's own distribution (see wall.ts). Pings from the team's own
// machines and from automated agents are stored but kept off the wall, so it only ever shows the hall.

const HOUR = 3600_000
const WALL_LOCAL = process.env.VIRE_WALL_LOCAL === '1'
const T0 = Number.isFinite(Date.parse(process.env.VIRE_WALL_T0 ?? '')) ? Date.parse(process.env.VIRE_WALL_T0!) : WALL_T0
let wallCache: { at: number; input: Omit<WallInput, 'now' | 'me'>; state: WallState } | null = null

function wallInput(): Omit<WallInput, 'now' | 'me'> {
  const users = new Map<string, WallInput['users'][number]>()
  const pings: WallInput['pings'] = []
  for (const r of [...wallRows(), ...hallRows()]) {
    if (!users.has(r.user_id)) users.set(r.user_id, { id: r.user_id, label: r.name, key: tagOf(r.user_id, 10) })
    const started = Date.parse(r.started_at)
    const arrived = Date.parse(r.created_at)
    // the phone's clock says when the ping started, the server's when it arrived: the phone is trusted within two hours
    const t = WALL_LOCAL || (started <= arrived + 300_000 && started >= arrived - 2 * HOUR) ? started : arrived
    const device = (r.device ? JSON.parse(r.device) : null) as { ua?: string; native?: boolean } | null
    pings.push({
      userId: r.user_id,
      t,
      values: JSON.parse(r.vals),
      family: deviceFamily(device?.ua ?? '', device?.native === true),
      counted: r.via === 'public' || (WALL_LOCAL && r.via === 'local'),
    })
  }
  return { users: [...users.values()], pings, started: wallStarted(WALL_LOCAL ? ['public', 'local'] : ['public']), t0: T0 }
}

app.get('/api/wall', (c) => {
  const now = Date.now()
  const u = c.req.query('u')
  const demo = c.req.query('demo')
  c.header('cache-control', 'no-store')
  if (demo != null) {
    // made-up data for checking a layout; the page tags it "simulated". ?h= sets the hour of the weekend.
    const h = Number(c.req.query('h') ?? NaN)
    const n = Number(demo)
    const at = Number.isFinite(h) ? T0 + clamp(h, 0, 60) * HOUR : Math.floor(now / WINDOW_MS) * WINDOW_MS
    return c.json(demoWall(Number.isFinite(n) && demo !== '' && n !== 1 ? n : 60, at, { t0: T0, me: u != null }))
  }
  if (!wallCache || now - wallCache.at > 2000) {
    const input = wallInput()
    wallCache = { at: now, input, state: buildWall({ ...input, now }) }
  }
  return c.json(u && okId(u) ? buildWall({ ...wallCache.input, now, me: u }) : wallCache.state)
})

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

// ---------- static web build ----------

const DIST = process.env.VIRE_DIST ? normalize(process.env.VIRE_DIST + '/') : fileURLToPath(new URL('../web/dist/', import.meta.url))
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  wasm: 'application/wasm',
  task: 'application/octet-stream',
  bin: 'application/octet-stream',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain; charset=utf-8',
}
const isFile = (p: string) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function serveStatic(pathname: string, req: Request): Response {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 })
  let rel: string
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  } catch {
    return new Response('bad path', { status: 400 })
  }
  let full = normalize(join(DIST, rel))
  if (!full.startsWith(DIST) || rel.includes('\0')) return new Response('forbidden', { status: 403 })
  if (!rel || !isFile(full)) {
    // a missing asset is a 404 (so a missing mp3 fails cleanly); any other path is the single-page app
    if (/\.[a-z0-9]{2,11}$/i.test(rel) && !rel.endsWith('.html')) return new Response('not found', { status: 404 })
    full = join(DIST, 'index.html')
    if (!isFile(full)) return new Response('web/dist is not built yet: cd web && bun run build', { status: 404 })
  }
  const ext = full.slice(full.lastIndexOf('.') + 1).toLowerCase()
  const file = Bun.file(full)
  const size = file.size
  const hashed = /[\\/]assets[\\/]/.test(full)
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : ext === 'wasm' || ext === 'task' ? 'public, max-age=86400' : 'no-cache',
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
  if (range && (range[1] || range[2]) && size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    headers['content-range'] = `bytes ${start}-${end}/${size}`
    headers['content-length'] = String(end - start + 1)
    return new Response(req.method === 'HEAD' ? null : file.slice(start, end + 1), { status: 206, headers })
  }
  headers['content-length'] = String(size)
  return new Response(req.method === 'HEAD' ? null : file, { headers })
}

// ---------- serve ----------

const server = Bun.serve({
  hostname: process.env.HOST ?? '127.0.0.1', // 0.0.0.0 inside the container
  port: PORT,
  idleTimeout: 30,
  maxRequestBodySize: 2 * 1024 * 1024, // a ping with traces is about 40 kB
  fetch(req, srv) {
    const url = new URL(req.url)
    let path = url.pathname
    // the public mount is /vire; the proxy usually strips it, but accept both
    const prefixed = path === '/vire' || path.startsWith('/vire/')
    if (prefixed) path = path.slice(5) || '/'
    if (path === '/api/live' || path === '/api/live/') {
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket only', { status: 426 })
      const role = url.searchParams.get('role') === 'sensor' ? 'sensor' : 'viewer'
      const room = (url.searchParams.get('room') ?? '').trim().toUpperCase().slice(0, 32)
      if (!room) return new Response('room is required', { status: 400 })
      let name = (url.searchParams.get('name') ?? '').trim().slice(0, 60)
      if (!name && role === 'sensor') name = listUsers().find((u) => roomOf(u.id) === room)?.name ?? ''
      const data: WsData = { room, role, name }
      return srv.upgrade(req, { data }) ? undefined : new Response('upgrade failed', { status: 400 })
    }
    if (path === '/api' || path.startsWith('/api/')) {
      if (!prefixed) return app.fetch(req)
      url.pathname = path
      return app.fetch(new Request(url.toString(), req))
    }
    return serveStatic(path, req)
  },
  websocket,
})

console.log(`[vire] http://${server.hostname}:${server.port}  cohort ${cohort().people.length} synthetic patients  llm ${JSON.stringify(llmStatus())}`)
clinicRows(Date.now(), true) // warm the clinician texts so the first open of the clinic is already polished
ensureDaily()
// Helsinki midnight is the only boundary that matters. Checking hourly keeps the
// generation off the request path while still producing the new pair on the same day.
setInterval(ensureDaily, 60 * 60 * 1000)
