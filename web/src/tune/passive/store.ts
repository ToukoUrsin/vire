// The minute bins on this device (IndexedDB), and on the server under the device's own key (see ../ear/minutes.ts):
// with the key the device reads its days and its usual back after a cleared page. Quiet when the browser keeps
// nothing or the server cannot be reached: the bins of this visit are kept in memory and sent again later.
import { binId, keepBetter } from '@shared/earpassive'
import type { PassiveBin, PassiveMine } from '@shared/earpassive'
import { apiUrl } from '../../shared/api'
import { earKey } from '../ear/minutes'

const DB = 'vire-passive'
const STORE = 'bins'
/** the newest days kept on the device */
const KEEP_DAYS = 60
/** `sent`: how many samples the copy on the server has (0: none there yet) */
interface Kept { id: string; sent: number; bin: PassiveBin }

const memory = new Map<string, Kept>()

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function run<T>(mode: IDBTransactionMode, go: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = go(tx.objectStore(STORE))
      tx.oncomplete = () => { db.close(); resolve(req ? req.result : null) }
      tx.onerror = () => { db.close(); resolve(null) }
      tx.onabort = () => { db.close(); resolve(null) }
    } catch {
      db.close()
      resolve(null)
    }
  })
}

async function all(): Promise<Kept[]> {
  const rows = (await run<Kept[]>('readonly', (s) => s.getAll() as IDBRequest<Kept[]>)) ?? []
  const by = new Map<string, Kept>()
  for (const k of rows) if (k?.bin?.v === 1) by.set(k.id, k)
  for (const k of memory.values()) {
    const have = by.get(k.id)
    if (!have || k.bin.samples > have.bin.samples || k.sent > have.sent) by.set(k.id, k)
  }
  return [...by.values()].sort((a, b) => a.bin.at - b.bin.at)
}

/** keep these minutes; a minute already kept is replaced only by a fuller copy of it */
export async function keepBins(bins: PassiveBin[]): Promise<void> {
  await update(bins, (was, bin) => ({ id: binId(bin), sent: was?.sent ?? 0, bin: keepBetter(was?.bin, bin) }))
}

/** the server now has these copies */
async function markSent(bins: PassiveBin[]): Promise<void> {
  await update(bins, (was, bin) => ({ id: binId(bin), sent: Math.max(was?.sent ?? 0, bin.samples), bin: keepBetter(was?.bin, bin) }))
}

async function update(bins: PassiveBin[], next: (was: Kept | undefined, bin: PassiveBin) => Kept): Promise<void> {
  if (!bins.length) return
  const have = new Map((await all()).map((k) => [k.id, k]))
  const put: Kept[] = []
  for (const bin of bins) {
    const was = have.get(binId(bin))
    const k = next(was, bin)
    if (was && was.sent === k.sent && was.bin === k.bin) continue
    memory.set(k.id, k)
    have.set(k.id, k)
    put.push(k)
  }
  if (put.length) await run('readwrite', (s) => void put.forEach((k) => s.put(k)))
}

/** this device's minutes, oldest first; the oldest days beyond 60 are let go */
export async function listBins(): Promise<PassiveBin[]> {
  const kept = await all()
  const days = [...new Set(kept.map((k) => k.bin.day))].sort()
  if (days.length > KEEP_DAYS) {
    const from = days[days.length - KEEP_DAYS]
    const old = kept.filter((k) => k.bin.day < from)
    for (const k of old) memory.delete(k.id)
    await run('readwrite', (s) => void old.forEach((k) => s.delete(k.id)))
    return kept.filter((k) => k.bin.day >= from).map((k) => k.bin)
  }
  return kept.map((k) => k.bin)
}

/** send every minute the server does not have yet; `leaving` uses a request that outlives the page */
export async function sendBins(leaving = false): Promise<number> {
  const unsent = (await all()).filter((k) => k.bin.samples > k.sent).slice(-240)
  if (!unsent.length) return 0
  try {
    const res = await fetch(apiUrl('ear/passive'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: earKey(), bins: unsent.map((k) => k.bin) }),
      keepalive: leaving,
    })
    if (!res.ok) return 0
    await markSent(unsent.map((k) => k.bin))
    return unsent.length
  } catch {
    return 0
  }
}

/** this device's days and usual from the server; null when it cannot be reached */
export async function fetchMine(today: string, ms = 8000): Promise<PassiveMine | null> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), ms)
  try {
    const res = await fetch(apiUrl(`ear/passive/mine?today=${today}`), { headers: { authorization: `Bearer ${earKey()}` }, signal: stop.signal })
    return res.ok ? ((await res.json()) as PassiveMine) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
