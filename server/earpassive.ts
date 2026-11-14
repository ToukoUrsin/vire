// The minute bins a device keeps while a Vire page is open and the AirPods stream (see shared/earpassive.ts):
// numbers only, one JSON file per device and day, under the same folder and the same device keys as the
// teaching minutes. The key never touches the disk: files are named by its hash. A device reads its own days
// and its usual back with its key; the list of what is kept needs the worker's token.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context, Hono } from 'hono'
import { binId, checkPassiveBin, isSim, keepBetter, summarizeDays, usualOf } from '../shared/earpassive'
import type { PassiveBin, PassiveMine } from '../shared/earpassive'
import { ownerOf } from './ear'

const dir = () => join(process.env.VIRE_EAR_DIR || '/bulk2/runs/depression/ear/recordings/', 'passive')
/** one post carries at most this many minutes (a device that was offline sends what it kept) */
const MAX_POST = 240
/** a day file holds at most this many minutes (more than 1440 only when a test shortens the minute) */
const MAX_DAY = 3000
/** the newest days a device reads back */
const MAX_DAYS = 60

export interface PassiveDeps<A> {
  asker: (c: Context) => A
  allow: (a: A, bucket: string, max: number) => boolean
  tooMany: (c: Context) => Response
  isWorker: (c: Context) => boolean
}

type DayFile = Record<string, PassiveBin>
const fileOf = (owner: string, day: string) => join(dir(), owner, `${day}.json`)
async function readDay(owner: string, day: string): Promise<DayFile> {
  try {
    return JSON.parse(await readFile(fileOf(owner, day), 'utf8')) as DayFile
  } catch {
    return {}
  }
}

/** one device's writes, one after another: two posts at once must not lose a minute */
const queues = new Map<string, Promise<unknown>>()
function inTurn<T>(owner: string, run: () => Promise<T>): Promise<T> {
  const prev = queues.get(owner) ?? Promise.resolve()
  const next = prev.then(run, run)
  queues.set(owner, next.catch(() => {}))
  void next.finally(() => {
    if (queues.get(owner) === next) queues.delete(owner)
  }).catch(() => {})
  return next
}

/** Keep these minutes for this device. The same minute sent again replaces the copy only when it has more in it. */
export async function savePassive(key: unknown, raw: unknown): Promise<{ kept: number; minutes: number } | null> {
  const owner = ownerOf(key)
  if (!owner || !Array.isArray(raw) || raw.length > MAX_POST) return null
  const bins = raw.map(checkPassiveBin)
  if (bins.some((b) => !b)) return null
  const byDay = new Map<string, PassiveBin[]>()
  for (const b of bins as PassiveBin[]) byDay.set(b.day, [...(byDay.get(b.day) ?? []), b])
  return inTurn(owner, async () => {
    await mkdir(join(dir(), owner), { recursive: true })
    let kept = 0
    let minutes = 0
    for (const [day, list] of byDay) {
      const file = await readDay(owner, day)
      for (const b of list) {
        const id = binId(b)
        const was = file[id]
        const now = keepBetter(was, b)
        if (now !== was) {
          if (!was && Object.keys(file).length >= MAX_DAY) continue
          file[id] = now
          kept++
        }
      }
      minutes += Object.keys(file).length
      const path = fileOf(owner, day)
      await writeFile(`${path}.tmp`, JSON.stringify(file))
      await rename(`${path}.tmp`, path)
    }
    return { kept, minutes }
  })
}

async function daysOf(owner: string): Promise<string[]> {
  try {
    return (await readdir(join(dir(), owner)))
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .map((n) => n.slice(0, 10))
      .sort()
      .slice(-MAX_DAYS)
  } catch {
    return []
  }
}

/** This device's days and its usual. `today` is the device's own date; the usual comes from the days before it. */
export async function minePassive(key: unknown, today?: string): Promise<PassiveMine | null> {
  const owner = ownerOf(key)
  if (!owner) return null
  const bins: PassiveBin[] = []
  for (const d of await daysOf(owner)) bins.push(...Object.values(await readDay(owner, d)))
  const days = summarizeDays(bins)
  const day = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : (days[days.length - 1]?.day ?? new Date().toISOString().slice(0, 10))
  return { days, usual: usualOf(days, day, false), simUsual: usualOf(days, day, true), today: day }
}

/** for the worker: which devices keep minutes, how many days and minutes, and whether they are a stand-in's */
export async function listPassive(): Promise<Array<{ owner: string; days: number; minutes: number; sim: number; last: string | null }>> {
  let owners: string[] = []
  try {
    owners = (await readdir(dir())).filter((n) => /^[a-f0-9]{40}$/.test(n))
  } catch {
    return []
  }
  const out = []
  for (const owner of owners) {
    const days = await daysOf(owner)
    let minutes = 0
    let sim = 0
    for (const d of days) {
      const bins = Object.values(await readDay(owner, d))
      minutes += bins.length
      sim += bins.filter((b) => isSim(b.shell)).length
    }
    out.push({ owner: owner.slice(0, 12), days: days.length, minutes, sim, last: days[days.length - 1] ?? null })
  }
  return out.sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))
}

export function registerPassiveRoutes<A>(app: Hono, deps: PassiveDeps<A>) {
  const keyOf = (c: Context) => (c.req.header('authorization') ?? '').replace(/^Bearer /, '')
  app.post('/api/ear/passive', async (c) => {
    if (!deps.allow(deps.asker(c), 'ear-passive', 600)) return deps.tooMany(c)
    if (Number(c.req.header('content-length') ?? 0) > 1_000_000) return c.json({ error: 'too large' }, 413)
    const body = (await c.req.json().catch(() => null)) as { key?: unknown; bins?: unknown } | null
    if (!ownerOf(body?.key)) return c.json({ error: 'not allowed' }, 401)
    const kept = await savePassive(body?.key, body?.bins)
    return kept ? c.json(kept) : c.json({ error: 'not minute bins' }, 400)
  })
  app.get('/api/ear/passive/mine', async (c) => {
    if (!deps.allow(deps.asker(c), 'ear-mine', 120)) return deps.tooMany(c)
    const mine = await minePassive(keyOf(c), c.req.query('today'))
    return mine ? c.json(mine) : c.json({ error: 'not allowed' }, 401)
  })
  app.get('/api/ear/passive', async (c) => (deps.isWorker(c) ? c.json(await listPassive()) : c.json({ error: 'not allowed' }, 401)))
}
