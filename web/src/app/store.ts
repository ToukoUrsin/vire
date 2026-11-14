// Identity, settings and the API with a local fallback. Everything the screens need from "outside".
import type {
  Channel,
  DoseResult,
  DoseSuggestion,
  DoseUpload,
  Echo,
  HeartSource,
  MoveSource,
  PingSetting,
  PingUpload,
  PingUploadExtras,
  PingTraces,
  PHQ2Check,
  PHQ2Upload,
} from '@shared/types'
import { api } from '../shared/api'
import { clearLocal, leaveOut, localDose, localEcho, localEchoes, rememberEcho } from './fallback'

const SAFE_CHANNELS = new Set(['smile', 'voice', 'heart', 'move'])
const SAFE_STATUS = new Set(['calibrating', 'steady', 'dipping', 'low'])
/** Server/storage data is untrusted: an older phone must survive a newer value. */
export function normalizeEcho(raw: unknown): Echo | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<Echo> & { components?: unknown[] }
  const components = (Array.isArray(x.components) ? x.components : []).flatMap((v) => {
    if (!v || typeof v !== 'object') return []
    const c = v as Partial<Echo['components'][number]>
    if (typeof c.channel !== 'string' || !SAFE_CHANNELS.has(c.channel)) return []
    return [{ channel: c.channel as Echo['components'][number]['channel'], value: typeof c.value === 'number' ? c.value : null, unit: typeof c.unit === 'string' ? c.unit : '', z: typeof c.z === 'number' ? c.z : null, strength: typeof c.strength === 'number' ? c.strength : 50, note: typeof c.note === 'string' ? c.note : '', reading: typeof c.reading === 'string' ? c.reading : undefined }]
  })
  if (typeof x.pingId !== 'string' || typeof x.at !== 'string') return null
  return { pingId: x.pingId, at: x.at, components, strength: typeof x.strength === 'number' ? x.strength : 50, drift: typeof x.drift === 'number' ? x.drift : 0, status: SAFE_STATUS.has(String(x.status)) ? x.status as Echo['status'] : 'calibrating', message: typeof x.message === 'string' ? x.message : '', suggestion: normalizeSuggestion(x.suggestion), stim: typeof x.stim === 'string' ? x.stim : undefined, wallCounted: typeof x.wallCounted === 'boolean' ? x.wallCounted : undefined, wobble: typeof x.wobble === 'number' ? x.wobble : undefined, pingsSoFar: typeof x.pingsSoFar === 'number' ? x.pingsSoFar : undefined }
}
function normalizeSuggestion(raw: unknown): DoseSuggestion | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<DoseSuggestion>
  if (!['breathe', 'smile', 'forest', 'walk', 'reach', 'wait'].includes(String(x.dose))) return null
  if (typeof x.reason !== 'string') return null
  return { dose: x.dose as DoseSuggestion['dose'], reason: x.reason, expected: typeof x.expected === 'number' ? x.expected : 0, uncertainty: typeof x.uncertainty === 'number' ? x.uncertainty : 0, wobble: typeof x.wobble === 'number' ? x.wobble : undefined, tooEarly: x.tooEarly === true }
}

const K = {
  user: 'vire.user',
  visitor: 'vire.visitor',
  setting: 'vire.setting',
  today: 'vire.today',
  queue: 'vire.queue',
  ids: 'vire.ids',
  reminder: 'vire.reminder.hour',
  check: 'vire.phq2.last',
}

/** the person this phone belongs to, or a hall guest trying it once (kept apart, so a guest never moves the owner's usual) */
export type Who = 'me' | 'visitor'

export interface Identity {
  userId: string
  name: string
  /** created while the server was unreachable; re-registered when it comes back */
  local?: boolean
  visitor?: boolean
}

export interface Notice {
  booster: boolean
  message: string | null
}

/** what the phone knows about one ping and the server does not say back: where the signals came from, what it could not read and why */
export interface PingMeta {
  head: MoveSource
  heart: HeartSource
  unreadable: Channel[]
  why: Partial<Record<Channel, string>>
  traces?: PingTraces
  stim?: string
  demo?: boolean
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v))
    return true
  } catch {
    /* private mode or full: keep going in memory */
    return false
  }
}
function drop(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const id = setTimeout(() => rej(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        res(v)
      },
      (e) => {
        clearTimeout(id)
        rej(e)
      },
    )
  })
}

/** true once any API call has answered; drives the tiny "kept on this phone" note */
export let serverSeen = false

async function call<T>(path: string, body: unknown, ms: number): Promise<T> {
  const v = await timeout(api<T>(path, body), ms)
  serverSeen = true
  return v
}

const keyOf = (who: Who) => (who === 'visitor' ? K.visitor : K.user)

export const loadIdentity = (who: Who = 'me'): Identity | null => read<Identity>(keyOf(who))

export async function register(name: string, clinicCode: string, who: Who = 'me'): Promise<Identity> {
  const visitor = who === 'visitor'
  let id: Identity
  try {
    const r = await call<{ userId: string; name: string }>(
      'users',
      { name: name || undefined, clinicCode: clinicCode || undefined, visitor: visitor || undefined },
      5000,
    )
    // the server's name is the one to show: the nickname cleaned up, or "guest N" for a hall guest who gave none
    id = { userId: r.userId, name: r.name ?? name }
  } catch {
    const rnd = Math.random().toString(36).slice(2, 10)
    id = { userId: `local${rnd}`, name: name || '', local: true }
  }
  if (visitor) id.visitor = true
  write(keyOf(who), id)
  return id
}

/** a local identity gets a real one as soon as the server answers */
export async function upgradeIdentity(id: Identity): Promise<Identity> {
  if (!id.local) return id
  try {
    const r = await call<{ userId: string; name: string }>('users', { name: id.name || undefined, visitor: id.visitor || undefined }, 4000)
    const next: Identity = { userId: r.userId, name: r.name ?? id.name }
    if (id.visitor) next.visitor = true
    write(keyOf(id.visitor ? 'visitor' : 'me'), next)
    return next
  } catch {
    return id
  }
}

/** forget everything this phone knows: both identities, today's echo, the local history and whatever was waiting to be sent */
export function resetAll() {
  for (const k of Object.values(K)) drop(k)
  clearLocal()
}

export const roomCode = (userId: string) => userId.slice(0, 6).toUpperCase()

export const getSetting = (): PingSetting => (read<PingSetting>(K.setting) === 'clinic' ? 'clinic' : 'home')
export const setSetting = (s: PingSetting) => write(K.setting, s)

export const getReminderHour = (): number | null => {
  const n = read<number>(K.reminder)
  return typeof n === 'number' && n >= 0 && n < 24 ? n : null
}
export const setReminderHour = (hour: number) => write(K.reminder, Math.max(0, Math.min(23, Math.round(hour))))
export const setReminderHourIfUnset = (at = new Date()) => {
  const old = getReminderHour()
  if (old != null) return old
  const hour = at.getHours()
  setReminderHour(hour)
  return hour
}
interface CheckStamp { at: string; skipped?: boolean }
export const getCheckStamp = (): CheckStamp | null => read<CheckStamp>(K.check)
export const checkDue = (at = new Date()): boolean => {
  const last = getCheckStamp()
  return !last || at.getTime() - Date.parse(last.at) >= 7 * 86400_000
}
export const rememberCheck = (at = new Date(), skipped = false) => write(K.check, { at: at.toISOString(), skipped })
export async function checkClinic(code: string): Promise<{ code: string; name: string } | null> {
  if (!code.trim()) return null
  try { return await call<{ code: string; name: string }>(`clinics/${encodeURIComponent(code.trim())}`, undefined, 4000) } catch { return null }
}

const dayKey = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`
}
export const isToday = (iso: string) => dayKey(iso) === dayKey(new Date())

interface Today {
  day: string
  echo: Echo
  meta?: PingMeta
}
const today = (): Today | null => {
  const t = read<Today>(K.today)
  return t && t.day === dayKey(new Date()) ? t : null
}
export const getToday = (): Echo | null => normalizeEcho(today()?.echo) ?? null
/** a dose has been taken since today's echo: what it offered then is out of date, so it stops being shown */
export function spendSuggestion() {
  const t = today()
  if (t?.echo.suggestion) write(K.today, { ...t, echo: { ...t.echo, suggestion: null } } satisfies Today)
}
export const getTodayMeta = (): PingMeta | null => today()?.meta ?? null

// ---- uploads, with a small queue for when the server cannot be reached ----

type Queued =
  | { k: 'ping'; who: Who; localId: string; u: PingUpload & PingUploadExtras; meta?: PingMeta; tries: number }
  | { k: 'dose'; who: Who; u: DoseUpload; tries: number }
  | { k: 'check'; who: Who; u: PHQ2Upload; tries: number }

const MAX_QUEUE = 16
const loadQueue = (): Queued[] => read<Queued[]>(K.queue) ?? []
function saveQueue(q: Queued[]) {
  let keep = q.slice(-MAX_QUEUE)
  if (write(K.queue, keep)) return
  // storage is full: the traces are the heavy part and only the clinician's detail view needs them
  keep = keep.map((x) => (x.k === 'ping' ? { ...x, u: { ...x.u, traces: undefined } } : x))
  write(K.queue, keep)
}
/** how many pings and doses are waiting for the server */
export const queued = (): number => loadQueue().length

/** local ping id -> the id the server gave it once it got through */
const idMap = (): Record<string, string> => read<Record<string, string>>(K.ids) ?? {}

/**
 * Sends the ping and returns the echo to show. With the server away, the echo is worked out on the phone and the
 * ping waits in the queue. Either way the channels the phone could not read stay out of what is shown.
 */
export async function postPing(u: PingUpload & PingUploadExtras, who: Who = 'me', meta?: PingMeta): Promise<Echo> {
  const visitor = who === 'visitor'
  let echo: Echo
  try {
    echo = normalizeEcho(await call<Echo>('pings', u, 9000)) ?? localEcho(u, visitor)
    rememberEcho(echo, u, visitor)
  } catch {
    echo = localEcho(u, visitor)
    const q = loadQueue()
    q.push({ k: 'ping', who, localId: echo.pingId, u, meta, tries: 0 })
    saveQueue(q)
  }
  echo = { ...leaveOut(echo, u.unreadable ?? [], meta?.why), stim: echo.stim ?? u.stim }
  if (u.kind === 'full' && !visitor) write(K.today, { day: dayKey(new Date()), echo, meta } satisfies Today)
  return echo
}

export async function postDose(u: DoseUpload): Promise<DoseResult> {
  const ids = idMap()
  const sent: DoseUpload = {
    ...u,
    prePingId: u.prePingId ? (ids[u.prePingId] ?? u.prePingId) : null,
    postPingId: u.postPingId ? (ids[u.postPingId] ?? u.postPingId) : null,
  }
  const waiting = [sent.prePingId, sent.postPingId].some((id) => id?.startsWith('local-'))
  try {
    // a dose that leans on a ping the server has not seen yet waits with it
    if (waiting) throw new Error('queued')
    return await call<DoseResult>('doses', sent, 9000)
  } catch {
    const q = loadQueue()
    q.push({ k: 'dose', who: 'me', u, tries: 0 })
    saveQueue(q)
    return localDose(u)
  }
}

export async function postCheck(u: PHQ2Upload, who: Who = 'me'): Promise<PHQ2Check | null> {
  try {
    const check = await call<PHQ2Check>('checks', u, 9000)
    rememberCheck(new Date(check.at))
    return check
  } catch {
    const q = loadQueue()
    q.push({ k: 'check', who, u, tries: 0 })
    saveQueue(q)
    rememberCheck(new Date(), false)
    return null
  }
}

let flushing: Promise<boolean> | null = null
/**
 * Sends what is waiting, oldest first. Resolves true when something got through (so the screen can reload).
 * Safe to call often: one run at a time, and it stops at the first thing the server does not take.
 */
export function flushQueue(): Promise<boolean> {
  flushing ??= flush().finally(() => {
    flushing = null
  })
  return flushing
}

async function flush(): Promise<boolean> {
  if (!loadQueue().length) return false
  let moved = false
  const real = new Map<Who, Identity | null>()
  const seen = new Map<string, Echo[]>()
  for (;;) {
    const q = loadQueue()
    const item = q[0]
    if (!item) break
    const done = () => {
      // re-read: a ping may have joined the queue while this one was on its way
      const now = loadQueue()
      const i = now.findIndex((x) => JSON.stringify(x) === JSON.stringify(item))
      if (i >= 0) now.splice(i, 1)
      saveQueue(now)
    }
    if (!real.has(item.who)) {
      const id = loadIdentity(item.who)
      real.set(item.who, id ? await upgradeIdentity(id) : null)
    }
    const id = real.get(item.who)
    if (!id) {
      done() // nobody to send it for (the phone was reset)
      continue
    }
    if (id.local) break // still no server
    try {
      if (item.k === 'ping') {
        const u = { ...item.u, userId: id.userId }
        // a ping whose answer got lost on the way back is already there: find it by its start time, do not send it twice
        if (!seen.has(id.userId)) seen.set(id.userId, await call<Echo[]>(`users/${id.userId}/echoes?all=1`, undefined, 6000))
        const at = Date.parse(u.startedAt)
        let echo = seen.get(id.userId)!.find((e) => Date.parse(e.at) === at) ?? null
        echo ??= await call<Echo>('pings', u, 9000)
        const ids = idMap()
        ids[item.localId] = echo.pingId
        const keys = Object.keys(ids)
        for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete ids[k]
        write(K.ids, ids)
        rememberEcho(echo, u, item.who === 'visitor', item.localId)
        const t = today()
        if (t && t.echo.pingId === item.localId) {
          write(K.today, { ...t, echo: leaveOut(echo, u.unreadable ?? [], item.meta?.why) } satisfies Today)
        }
      } else if (item.k === 'dose') {
        const ids = idMap()
        const fix = (pid: string | null) => (pid ? (ids[pid] ?? (pid.startsWith('local-') ? null : pid)) : null)
        await call<DoseResult>('doses', { ...item.u, userId: id.userId, prePingId: fix(item.u.prePingId), postPingId: fix(item.u.postPingId) }, 9000)
      } else {
        const prior = await call<PHQ2Check[]>(`users/${id.userId}/checks`, undefined, 6000)
        const same = prior.some((x) => x.at === item.u.at && x.items[0] === item.u.items[0] && x.items[1] === item.u.items[1])
        if (!same) await call<PHQ2Check>('checks', { ...item.u, userId: id.userId }, 9000)
        rememberCheck(new Date(item.u.at ?? Date.now()))
      }
      done()
      moved = true
    } catch {
      // give up on something the server keeps refusing, so it cannot block what comes after it
      const now = loadQueue()
      const i = now.findIndex((x) => JSON.stringify(x) === JSON.stringify(item))
      if (i >= 0) {
        if (item.tries >= 5) now.splice(i, 1)
        else now[i] = { ...item, tries: item.tries + 1 }
        saveQueue(now)
      }
      break
    }
  }
  return moved
}

export async function getEchoes(userId: string): Promise<Echo[]> {
  try {
    return (await call<Echo[]>(`users/${userId}/echoes`, undefined, 5000)).map(normalizeEcho).filter((x): x is Echo => !!x)
  } catch {
    return localEchoes().map(normalizeEcho).filter((x): x is Echo => !!x)
  }
}

export async function getSuggestion(userId: string): Promise<DoseSuggestion | null> {
  try {
    return await call<DoseSuggestion | null>(`users/${userId}/suggestion`, undefined, 5000)
  } catch {
    return null
  }
}

export async function getNotice(userId: string): Promise<Notice> {
  try {
    return await call<Notice>(`users/${userId}/notice`, undefined, 5000)
  } catch {
    return { booster: false, message: null }
  }
}

/** one echo per local day (the first of the day), for the last `days` days, oldest first */
export function byDay(echoes: Echo[], days: number): (Echo | null)[] {
  const map = new Map<string, Echo>()
  for (const e of echoes) {
    const k = dayKey(e.at)
    if (!map.has(k)) map.set(k, e)
  }
  const out: (Echo | null)[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    out.push(map.get(dayKey(d)) ?? null)
  }
  return out
}
