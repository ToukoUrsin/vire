// The sessions people do in their AirPods (see shared/earsession.ts): numbers only, one JSON file each, under the
// same folder and the same device keys as the teaching minutes. A device reads back what its own sessions did
// and what Vire has learned from them; the files themselves are read only with the worker's token.
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { learn } from '../shared/earlearn'
import type { Learned } from '../shared/earlearn'
import { SESSION_KINDS } from '../shared/earsession'
import type { EarSessionRec } from '../shared/earsession'
import { readSession } from '../shared/earsessionread'
import type { SessionRead } from '../shared/earsessionread'
import { ownerOf } from './ear'

const DIR = join(process.env.VIRE_EAR_DIR || '/bulk2/runs/depression/ear/recordings/', 'sessions')
const BY = join(DIR, 'by')
/** ten minutes of AirPods at 50 a second, or of camera pulse at 30 */
const MAX_ROWS = 30_000
const MAX_MS = 900_000
const ASKS = new Set(['rest', 'smile', 'relax', 'nod', 'shake'])
const MADE = new Set(['live', 'set', 'tone'])

const rows = (v: unknown, width: number): v is number[][] =>
  Array.isArray(v) && v.length <= MAX_ROWS && v.every((r) => Array.isArray(r) && r.length === width && r.every((n) => typeof n === 'number' && Number.isFinite(n)))
const span = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && b <= MAX_MS
const text = (v: unknown, max: number) => String(v ?? '').slice(0, max)

/** null when it is not a session */
export function checkEarSession(x: unknown): EarSessionRec | null {
  const s = x as EarSessionRec | null
  if (!s || typeof s !== 'object' || s.v !== 1 || !SESSION_KINDS.includes(s.kind)) return null
  if (!rows(s.head, 10) || !rows(s.pulse, 4) || !rows(s.airHr, 2)) return null
  const d = s.device
  if (!d || !['mac', 'ios', 'sim'].includes(d.shell) || typeof d.gyro !== 'boolean' || !Number.isFinite(d.hz) || d.hz < 0 || d.hz > 200) return null
  if (!Array.isArray(s.phases) || s.phases.length > 8 || !s.phases.every((p) => p && ['checkin', 'before', 'session', 'after'].includes(p.name) && span(p.t0, p.t1))) return null
  if (!Array.isArray(s.breaths) || s.breaths.length > 400 || !s.breaths.every((b) => b && span(b.t0, b.t1) && Number.isFinite(b.tMid) && b.tMid > b.t0 && b.tMid < b.t1 && Number.isFinite(b.perMin) && b.perMin > 1 && b.perMin < 40)) return null
  if (!Array.isArray(s.steps) || s.steps.length > 120 || !s.steps.every((p) => p && ASKS.has(p.ask) && span(p.t0, p.t1))) return null
  if (!Array.isArray(s.sound) || s.sound.length > 200 || !s.sound.every((p) => p && typeof p.id === 'string' && Number.isFinite(p.t) && MADE.has(p.made))) return null
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const adapt = Array.isArray(s.adapt)
    ? s.adapt
        .filter((a) => a && num(a.t) && num(a.from) && num(a.to) && ['breath', 'stillness', 'held'].includes(a.by))
        .slice(0, 200)
        .map((a) => ({ t: a.t, from: a.from, to: a.to, follows: !!a.follows, coherence: num(a.coherence) ? a.coherence : 0, readable: !!a.readable, moveDegS: num(a.moveDegS) ? a.moveDegS : null, by: a.by }))
    : null
  const hs = Array.isArray(s.heartSamples) ? s.heartSamples.filter((h) => h && Number.isFinite(h.t) && Number.isFinite(h.bpm)).slice(0, 4000) : null
  return {
    v: 1,
    at: typeof s.at === 'string' ? s.at.slice(0, 40) : new Date().toISOString(),
    kind: s.kind,
    device: { shell: d.shell, gyro: d.gyro, hz: d.hz, ua: text(d.ua, 200), ...(typeof d.route === 'string' && d.route ? { route: d.route.slice(0, 160) } : {}) },
    head: s.head,
    pulse: s.pulse,
    airHr: s.airHr,
    ...(hs ? { heartSamples: hs.map((h) => ({ t: h.t, bpm: h.bpm, src: text(h.src, 80), model: text(h.model, 40), n: Number.isFinite(h.n) ? h.n : 1 })) } : {}),
    ...(typeof s.heartState === 'string' ? { heartState: s.heartState.slice(0, 20) } : {}),
    phases: s.phases.map((p) => ({ name: p.name, t0: p.t0, t1: p.t1 })),
    breaths: s.breaths.map((b) => ({ t0: b.t0, tMid: b.tMid, t1: b.t1, perMin: b.perMin })),
    steps: s.steps.map((p) => ({ ask: p.ask, t0: p.t0, t1: p.t1 })),
    sound: s.sound.map((p) => ({ id: p.id.slice(0, 80), t: p.t, made: p.made })),
    ...(typeof s.day === 'number' && Number.isFinite(s.day) && s.day >= 1 && s.day <= 5000 ? { day: Math.round(s.day) } : {}),
    ...(typeof s.tzMin === 'number' && Number.isFinite(s.tzMin) && Math.abs(s.tzMin) <= 840 ? { tzMin: Math.round(s.tzMin) } : {}),
    ...(s.offered && typeof s.offered === 'object' && typeof s.offered.why === 'string' ? { offered: { rule: text(s.offered.rule, 20), why: text(s.offered.why, 200), byDefault: !!s.offered.byDefault } } : {}),
    ...(s.own && typeof s.own === 'object' && Number.isFinite(s.own.conf) ? { own: { perMin: typeof s.own.perMin === 'number' && Number.isFinite(s.own.perMin) ? s.own.perMin : null, conf: s.own.conf } } : {}),
    ...(adapt ? { adapt } : {}),
  }
}

export interface SessionKept extends SessionRead {
  id: string
}
export interface SessionsOf {
  sessions: SessionKept[]
  learned: Learned
}

/** what one device's sessions did, oldest first: one line each, written when the session arrived */
async function keptOf(owner: string): Promise<SessionKept[]> {
  try {
    const lines = (await readFile(join(BY, `${owner}.jsonl`), 'utf8')).split('\n').filter(Boolean)
    return lines.map((l) => JSON.parse(l) as SessionKept).filter((s) => s.heartSources !== undefined).sort((a, b) => a.at.localeCompare(b.at)).slice(-200)
  } catch {
    return []
  }
}
/** a practice that did not happen (a walk with no steps felt) teaches nothing about what helps */
const learnedFrom = (sessions: SessionKept[]) => learn(sessions.map((s) => ({ kind: s.kind, settle: s.happened === false ? null : s.settle, at: s.at })))

export async function saveSession(up: { key?: unknown; session?: unknown } | null): Promise<(SessionsOf & { id: string }) | null> {
  const rec = checkEarSession(up?.session)
  if (!rec) return null
  const owner = ownerOf(up?.key)
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`
  // the names Health gave for what measured the heart can carry a person's name ("Anna's AirPods Pro"): the
  // file keeps them for the check that the AirPods measured it, the line a device reads back keeps only the kind
  const read = readSession(rec)
  const kept: SessionKept = { id, ...read, heartSources: read.heartSources.map(plainSource) }
  await mkdir(BY, { recursive: true })
  await writeFile(join(DIR, `${id}.json`), JSON.stringify({ id, session: rec, owner, read }))
  if (owner) await appendFile(join(BY, `${owner}.jsonl`), `${JSON.stringify(kept)}\n`)
  const sessions = owner ? await keptOf(owner) : [kept]
  const learned = learnedFrom(sessions)
  newest = { id, arrivedAt: Date.now(), shell: rec.device.shell, read: kept, learned, practices: sessions.length, pieces: piecesOf(rec) }
  return { id, sessions, learned }
}

/** the newest session as the clinic's big screen may see it: what it did and what has been learned, never the rows */
export interface SessionLatest {
  id: string
  /** when it arrived here, ms */
  arrivedAt: number
  shell: EarSessionRec['device']['shell']
  read: SessionKept
  learned: Learned
  /** how many practices this device has sent */
  practices: number
  /** pieces of sound made on Modal that played: picked from the set, and made while the practice went on */
  pieces: { set: number; live: number }
}
const piecesOf = (rec: EarSessionRec) => ({ set: rec.sound.filter((x) => x.made === 'set').length, live: rec.sound.filter((x) => x.made === 'live').length })
let newest: SessionLatest | null | undefined

export async function latestSession(): Promise<SessionLatest | null> {
  if (newest !== undefined) return newest
  // after a restart: the newest file on disk
  newest = null
  try {
    const name = (await readdir(DIR)).filter((n) => n.endsWith('.json')).sort().pop()
    if (!name) return null
    const j = JSON.parse(await readFile(join(DIR, name), 'utf8')) as { id: string; session: EarSessionRec; owner: string | null; read: SessionRead }
    const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(j.id)
    const kept: SessionKept = { id: j.id, ...readSession(j.session), heartSources: j.read.heartSources.map(plainSource) }
    const sessions = j.owner ? await keptOf(j.owner) : [kept]
    newest = { id: j.id, arrivedAt: m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.now(), shell: j.session.device.shell, read: kept, learned: learnedFrom(sessions), practices: sessions.length, pieces: piecesOf(j.session) }
  } catch {
    /* no sessions yet */
  }
  return newest
}

/** "Anna's AirPods Pro, AirPodsPro3,1" is said as what it is, not whose */
export function plainSource(s: string): string {
  if (/airpods/i.test(s)) return 'AirPods'
  if (/watch/i.test(s)) return 'Apple Watch'
  if (/iphone/i.test(s)) return 'iPhone'
  return 'another device'
}

export async function mineSessions(key: unknown): Promise<SessionsOf | null> {
  const owner = ownerOf(key)
  if (!owner) return null
  const sessions = await keptOf(owner)
  return { sessions, learned: learnedFrom(sessions) }
}

export async function listSessions(): Promise<Array<{ id: string; at: string; kind: string; shell: string; hz: number; headRows: number; heartFrom: string | null }>> {
  let names: string[] = []
  try {
    names = (await readdir(DIR)).filter((n) => n.endsWith('.json')).sort()
  } catch {
    return []
  }
  const out = []
  for (const n of names.slice(-300)) {
    try {
      const j = JSON.parse(await readFile(join(DIR, n), 'utf8')) as { id: string; session: EarSessionRec; read: SessionRead }
      out.push({ id: j.id, at: j.session.at, kind: j.session.kind, shell: j.session.device.shell, hz: j.read.hz, headRows: j.session.head.length, heartFrom: j.read.heartFrom })
    } catch {
      /* half-written: skip */
    }
  }
  return out
}

export async function readSessionFile(id: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(id)) return null
  try {
    return await readFile(join(DIR, `${id}.json`), 'utf8')
  } catch {
    return null
  }
}
