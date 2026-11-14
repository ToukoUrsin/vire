// Every teaching minute this person has done on this device. The model learns from all of them together, so
// each new minute makes it better instead of replacing the last one. The minutes are kept here (IndexedDB) and
// on the server under a key this device made for itself: with the key the device reads its own minutes back
// after a reinstall or a cleared page, and nobody else can.
import type { EarRecording, EarStored } from '@shared/ear'
import { apiUrl } from '../../shared/api'

const KEY = 'vire.ear.key'
const DB = 'vire-ear'
const STORE = 'minutes'
/** the newest minutes that are pulled back from the server: as many as one model learns from */
const PULL = 8
interface Kept { at: string; id: string | null; recording: EarRecording }

let memoryKey: string | null = null
/** this visit's copy: what the page works from when the browser will not keep anything */
const memory = new Map<string, Kept>()

function newKey(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** the key this device made for itself the first time it was asked */
export function earKey(): string {
  try {
    const have = localStorage.getItem(KEY)
    if (have && /^[a-f0-9]{32,64}$/.test(have)) return have
    const made = newKey()
    localStorage.setItem(KEY, made)
    return made
  } catch {
    return (memoryKey ??= newKey())
  }
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'at' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function store<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => { db.close(); resolve(req.result) }
      tx.onerror = () => { db.close(); resolve(null) }
      tx.onabort = () => { db.close(); resolve(null) }
    } catch {
      db.close()
      resolve(null)
    }
  })
}

async function all(): Promise<Kept[]> {
  const rows = (await store<Kept[]>('readonly', (s) => s.getAll() as IDBRequest<Kept[]>)) ?? []
  const by = new Map<string, Kept>()
  for (const k of rows) if (k?.recording?.v === 1) by.set(k.at, k)
  for (const k of memory.values()) if (!by.has(k.at)) by.set(k.at, k)
  return [...by.values()].sort((a, b) => a.at.localeCompare(b.at))
}

/** Keep one of this person's minutes. A scripted minute is never kept: it is not something a person did. */
export async function keepMinute(recording: EarRecording, id: string | null = null): Promise<void> {
  if (recording.device.shell === 'sim') return
  const k: Kept = { at: recording.at, id, recording }
  memory.set(k.at, k)
  await store('readwrite', (s) => s.put(k))
}

/** This person's minutes on this device, oldest first. */
export async function listMinutes(): Promise<EarRecording[]> {
  return (await all()).map((k) => k.recording)
}

/**
 * Bring back from the server any of this device's minutes that are not here (a cleared page, a new install).
 * Returns how many minutes are on the device afterwards. Quiet when the server cannot be reached.
 */
export async function syncMinutes(ms = 8000): Promise<number> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), ms)
  try {
    const headers = { authorization: `Bearer ${earKey()}` }
    const res = await fetch(apiUrl('ear/mine'), { headers, signal: stop.signal })
    if (res.ok) {
      const { minutes } = (await res.json()) as { minutes: EarStored[] }
      const have = await all()
      const ids = new Set(have.map((k) => k.id))
      const ats = new Set(have.map((k) => k.at))
      for (const m of minutes.filter((x) => x.shell !== 'sim').slice(-PULL)) {
        if (ids.has(m.id) || ats.has(m.at)) continue
        const one = await fetch(apiUrl(`ear/mine/${m.id}`), { headers, signal: stop.signal })
        if (!one.ok) continue
        const got = (await one.json()) as { id: string; recording: EarRecording }
        if (got?.recording?.v === 1) await keepMinute(got.recording, got.id)
      }
    }
  } catch {
    /* offline or slow: the minutes already here are enough to go on */
  } finally {
    clearTimeout(timer)
  }
  return (await all()).length
}

/**
 * Someone else is about to use this device: start with no minutes and a new key, so their model learns only
 * from them. The copies on the server stay where they are.
 */
export async function forgetMinutes(): Promise<void> {
  memory.clear()
  await store('readwrite', (s) => s.clear())
  try {
    localStorage.removeItem(KEY)
  } catch {
    memoryKey = null
  }
  memoryKey = null
}
