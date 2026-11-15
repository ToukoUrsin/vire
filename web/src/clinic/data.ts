// Clinic data access: the real API first, the typed mock behind `?mock=1` or when the API is unreachable.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { BoosterBooking, Channel, DoseKind, PatientRow, PingTraces, PracticeKind } from '@shared/types'
import { api } from '../shared/api'
import { mockPatient, mockPatients, mockSetBooster } from './mock'
import type { PatientDetailX } from './mock'

export type { PatientDetailX }
export type Source = 'api' | 'mock'

let stickyMock = false
/** `?mock=1` before or after the hash; sticky for the session once seen */
export function isMock(): boolean {
  if (stickyMock) return true
  if (typeof location === 'undefined') return false
  if (/[?&]mock=1\b/.test(location.search) || /[?&]mock=1\b/.test(location.hash)) stickyMock = true
  return stickyMock
}

/** Once the real server has answered in this tab, a dropped request never swaps sample people in for the real ones. */
let apiAnswered = false
/** a 404 is an answer ("nobody has that id"); anything else is the server not answering */
const notFound = (e: unknown) => e instanceof Error && /: 404\b/.test(e.message)

/** null = the request dropped and there is a real list on screen already: keep it */
export async function fetchPatients(): Promise<{ rows: PatientRow[]; source: Source } | null> {
  if (!isMock()) {
    try {
      // the public list is the simulated clinic; the team's own view (#/clinic?phones=1) adds the phones that did the camera check
      const rows = await api<PatientRow[]>(/[?&]phones=1\b/.test(location.hash + location.search) ? 'clinic/patients?phones=1' : 'clinic/patients')
      if (Array.isArray(rows)) {
        apiAnswered = true
        return { rows, source: 'api' }
      }
    } catch {
      /* fall through */
    }
    if (apiAnswered) return null
  }
  return { rows: mockPatients(), source: 'mock' }
}

/** 'offline' = the request dropped; the page keeps what it has and tries again */
export async function fetchPatient(id: string): Promise<{ detail: PatientDetailX | null; source: Source } | 'offline'> {
  if (!isMock()) {
    try {
      const raw = await api<PatientDetailX & { latestTraces?: PingTraces | null }>(`clinic/patients/${encodeURIComponent(id)}`)
      if (raw && typeof raw === 'object' && Array.isArray(raw.timeline)) {
        apiAnswered = true
        return { detail: { ...raw, traces: raw.traces ?? raw.latestTraces ?? null }, source: 'api' }
      }
    } catch (e) {
      if (notFound(e)) {
        apiAnswered = true
        return { detail: null, source: 'api' }
      }
    }
    if (apiAnswered) return 'offline'
  }
  return { detail: mockPatient(id), source: 'mock' }
}

/** traces of one ping: the server draws them for synthetic pings and returns the upload for real ones */
export async function fetchTraces(pingId: string, source: Source): Promise<PingTraces | null> {
  if (source === 'mock') return null
  try {
    const t = await api<PingTraces | null>(`pings/${encodeURIComponent(pingId)}/traces`)
    return t && Array.isArray(t.t) && t.t.length ? t : null
  } catch {
    return null
  }
}

/** book a booster session (at a slot, or the next free one) or cancel it */
export async function setBooster(id: string, on: boolean, source: Source, at?: string): Promise<BoosterBooking | null> {
  if (source === 'mock') return mockSetBooster(id, on, at)
  const r = await api<{ ok: true; booking?: BoosterBooking | null }>(`clinic/patients/${encodeURIComponent(id)}/booster`, at ? { on, at } : { on })
  return r?.booking ?? null
}

export function usePatients(pollMs = 15000) {
  const [state, setState] = useState<{ rows: PatientRow[] | null; source: Source; stale: boolean; at: number | null }>({
    rows: null,
    source: isMock() ? 'mock' : 'api',
    stale: false,
    at: null,
  })
  useEffect(() => {
    let dead = false
    const load = () =>
      fetchPatients().then((r) => {
        if (dead) return
        setState((s) => (r ? { ...r, stale: false, at: Date.now() } : { ...s, stale: true }))
      })
    load()
    const id = setInterval(load, pollMs)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [pollMs])
  return state
}

export function usePatient(id: string | undefined) {
  const [state, setState] = useState<{ detail: PatientDetailX | null; source: Source; loading: boolean; stale: boolean }>({
    detail: null,
    source: 'api',
    loading: true,
    stale: false,
  })
  const seq = useRef(0)
  const reload = useCallback(() => {
    if (!id) return Promise.resolve()
    const mine = ++seq.current
    return fetchPatient(id).then((r) => {
      if (mine !== seq.current) return
      // a dropped request keeps the person on screen (or the skeleton, on a first load) and is tried again soon
      if (r === 'offline') setState((s) => ({ ...s, stale: true }))
      else setState({ ...r, loading: false, stale: false })
    })
  }, [id])
  useEffect(() => {
    setState({ detail: null, source: 'api', loading: true, stale: false })
    void reload()
    const t = setInterval(reload, 20000)
    return () => clearInterval(t)
  }, [reload])
  // while the server is not answering, ask again every few seconds instead of every twenty
  useEffect(() => {
    if (!state.stale) return
    const t = setInterval(reload, 4000)
    return () => clearInterval(t)
  }, [state.stale, reload])
  return { ...state, reload, setDetail: (d: PatientDetailX) => setState((s) => ({ ...s, detail: d })) }
}

// ---- "Called" is clinic-local for now (no endpoint in the contract): one tick per person per day ----

const KEY = 'vire.clinic.called'
const listeners = new Set<() => void>()
let cache: Record<string, string> | null = null
function readCalled(): Record<string, string> {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    cache = {}
  }
  return cache
}
function writeCalled(next: Record<string, string>) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode: keep it in memory */
  }
  listeners.forEach((l) => l())
}
const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

export function useCalled() {
  const map = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    readCalled,
  )
  return {
    calledAt: (id: string): string | null => (map[id] && sameDay(map[id]) ? map[id] : null),
    toggle: (id: string) => {
      const cur = readCalled()
      const next = { ...cur }
      if (next[id] && sameDay(next[id])) delete next[id]
      else next[id] = new Date().toISOString()
      writeCalled(next)
    },
  }
}

// ---- shared vocabulary ----

export const DAY = 86_400_000
export type ViewStatus = 'low' | 'dipping' | 'quiet' | 'steady' | 'calibrating'
export const STATUS_ORDER: ViewStatus[] = ['low', 'dipping', 'quiet', 'steady', 'calibrating']
export const STATUS_LABEL: Record<ViewStatus, string> = { low: 'Low', dipping: 'Dipping', quiet: 'Quiet', steady: 'Steady', calibrating: 'Calibrating' }

/** The clinic and its patients live in Helsinki: days are cut there (winter time, as the server cuts them), whatever the viewer's own time zone. */
const CLINIC_TZ_MS = 2 * 3_600_000
const clinicDay = (ms: number) => Math.floor((ms + CLINIC_TZ_MS) / DAY)

/** whole days without a ping, counting today */
export function silentDays(lastPingAt: string | null, now = Date.now()): number | null {
  if (!lastPingAt) return null
  return Math.max(0, clinicDay(now) - clinicDay(Date.parse(lastPingAt)))
}

/** Silence is a signal: someone past calibration with no ping for 3+ days reads as "quiet" unless already low. */
export function viewStatus(row: Pick<PatientRow, 'status' | 'lastPingAt'>): ViewStatus {
  if (row.status === 'low') return 'low'
  if (row.status === 'calibrating') return 'calibrating'
  const s = silentDays(row.lastPingAt)
  if (s === null || s >= 3) return 'quiet'
  return row.status
}

export type Group = 'escalated' | 'call' | 'watch' | 'after' | 'new' | 'calm' | 'camera'
export function groupOf(row: PatientRow): Group {
  // real phones did the one-minute camera check at the event: not AirPods days, not in the loop with practices
  if (!row.synthetic) return 'camera'
  const st = row.outer?.state
  if (st === 'escalated' || st === 'booked') return 'escalated'
  if (st === 'after') return 'after'
  const vs = viewStatus(row)
  if (vs === 'calibrating') return 'new'
  if (row.priority >= 0.6 || vs === 'low') return 'call'
  if (vs === 'dipping' || vs === 'quiet' || row.priority >= 0.3) return 'watch'
  return 'calm'
}

export const CH_LABEL: Record<Channel, string> = { smile: 'Smile', voice: 'Voice', heart: 'Heart', move: 'Move' }
export const CH_WHAT: Record<Channel, string> = {
  smile: 'smile after laughter',
  voice: 'pitch movement in speech',
  heart: 'heart swing on slow breaths',
  move: 'nod speed',
}
/**
 * Simulated people are simulated days with AirPods in. Their four simulated signals carry the AirPods names, the same
 * mapping as server/clinic.ts (AIR_NAME, AIR_BELOW). The keys and the maths stay as they are; every simulated signal falls
 * with drift, so "below their usual" reads in the direction each name makes sense in. Head down and heart rate are drawn flipped:
 * the line goes up when the head is down longer or the heart rate is higher.
 * Real phones did the one-minute camera check, so their readings keep CH_LABEL: what was really measured.
 */
export const AIR_LABEL: Record<Channel, string> = { smile: 'Walks', voice: 'Head down', heart: 'Heart rate', move: 'Head movement' }
export const AIR_WHAT: Record<Channel, string> = {
  smile: 'walks, from the steps the AirPods feel',
  voice: 'how long the head is down',
  heart: 'while sitting still',
  move: 'how much the head moves',
}
export const AIR_FLIP: Record<Channel, 1 | -1> = { smile: 1, voice: -1, heart: -1, move: 1 }
/** [below their usual, above their usual], in the direction each name reads */
export const AIR_DIR: Record<Channel, [string, string]> = {
  smile: ['fewer walks', 'more walks'],
  voice: ['head down longer', 'head down less'],
  heart: ['heart rate higher', 'heart rate lower'],
  move: ['less head movement', 'more head movement'],
}
export const chLabel = (ch: Channel, air: boolean) => (air ? AIR_LABEL[ch] : CH_LABEL[ch])
/** a simulated signal against their usual, in words: "in their usual" or "fewer walks, 1.4 SD" */
export const airSaid = (ch: Channel, z: number | null) =>
  z == null ? 'not read' : Math.abs(z) < 0.75 ? 'in their usual' : `${AIR_DIR[ch][z < 0 ? 0 : 1]}, ${Math.abs(z).toFixed(1)} SD`
/** the words for what one mark is: a day with AirPods in, or a one-minute camera check */
export function words(air: boolean) {
  return air
    ? { one: 'day', many: 'days', last: 'Last day', lastIn: 'AirPods last in', none: 'no days with AirPods in yet', silent: (n: number) => `AirPods not in for ${n} ${n === 1 ? 'day' : 'days'}`, count: (n: number) => `${n} ${n === 1 ? 'day' : 'days'} with AirPods in` }
    : { one: 'check', many: 'checks', last: 'Last check', lastIn: 'Last checked', none: 'no camera checks yet', silent: (n: number) => `no camera check for ${n} ${n === 1 ? 'day' : 'days'}`, count: (n: number) => `${n} camera ${n === 1 ? 'check' : 'checks'}` }
}

export const CH_VAR: Record<Channel, string> = { smile: 'var(--ch-smile)', voice: 'var(--ch-voice)', heart: 'var(--ch-heart)', move: 'var(--ch-move)' }
export const DOSE_LABEL: Record<DoseKind, string> = { breathe: 'Slow breathing', smile: 'Smile along', forest: 'Forest', walk: 'Tempo walk', reach: 'Voice note to a friend', wait: 'Just wait' }

export const PRACTICE_LABEL: Record<PracticeKind, string> = { breathe: 'Breathing', scan: 'Body scan', walk: 'Walk' }

export const roomCode = (userId: string) => userId.slice(0, 6).toUpperCase()

const dFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Helsinki' })
const dyFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Helsinki' })
const wFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Helsinki' })
const tFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' })
export const fmtDay = (d: number | string | Date) => dFmt.format(new Date(d))
export const fmtDayYear = (d: number | string | Date) => dyFmt.format(new Date(d))
export const fmtWeekday = (d: number | string | Date) => wFmt.format(new Date(d))
export const fmtTime = (d: number | string | Date) => tFmt.format(new Date(d))
/** a booster slot: "Mon 16 Nov, 09:00" */
// slots are the clinic's own hours, so they are shown in the clinic's time zone wherever the screen is
const slotDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Helsinki' })
const slotTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' })
export const fmtSlot = (d: number | string | Date) => `${slotDay.format(new Date(d))}, ${slotTime.format(new Date(d))}`
export const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`

/** The clinic's one current number for the last day (or camera check), 0 to 100, 50 = their usual. Mini pings do not replace it. */
export function echoNow(detail: Pick<PatientDetailX, 'timeline'>): number | null {
  const latest = [...detail.timeline].reverse().find((p) => p.kind === 'full')
  return latest ? Math.round(latest.strength) : null
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const ms = now - Date.parse(iso)
  if (ms < 90_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`
  const s = silentDays(iso, now) ?? 0
  if (s === 0) return `today ${fmtTime(iso)}`
  if (s === 1) return 'yesterday'
  return `${s} days ago`
}

/** the server counts a person's practices as "sessions"; every screen calls them practices, so the clinic does too.
 *  Only a count in front of the word is touched: a "20-session TMS course" and a "booster session" keep their name. */
export const practiceWords = (text: string) => text.replace(/(\d+ of \d+|: \d+) session(s?)\b/g, '$1 practice$2')
