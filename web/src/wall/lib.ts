// Words, time and small maths for the hall wall. Everything here is raw channel values against the hall's own
// spread: a hall guest has one or two pings, so there is no personal baseline to speak of.
import { useEffect, useRef, useState } from 'react'
import type { Channel, WallState } from '@shared/types'
import { api } from '../shared/api'

export const CHANNELS: Channel[] = ['smile', 'voice', 'heart', 'move']

export const CH: Record<Channel, { name: string; what: string; unit: string; color: string; more: string; less: string; fell: string; rose: string }> = {
  smile: { name: 'Smile', what: 'how much you smile back at a laugh', unit: 'smile-seconds', color: 'var(--ch-smile)', more: 'A fuller smile', less: 'A quieter smile', fell: 'smiled less', rose: 'smiled more' },
  voice: { name: 'Voice', what: 'how much your pitch moves as you speak', unit: 'semitones', color: 'var(--ch-voice)', more: 'A livelier voice', less: 'A flatter voice', fell: 'spoke flatter', rose: 'spoke livelier' },
  heart: { name: 'Heart', what: 'how far your pulse swings on a slow breath', unit: 'bpm', color: 'var(--ch-heart)', more: 'A bigger heart swing', less: 'A smaller heart swing', fell: 'swung less', rose: 'swung more' },
  move: { name: 'Move', what: 'how fast you nod', unit: '°/s', color: 'var(--ch-move)', more: 'A quicker nod', less: 'A slower nod', fell: 'nodded slower', rose: 'nodded quicker' },
}

/** The one line every view of the wall carries. */
export const HONEST = 'This wall shows how a hackathon weekend wears people down: tiredness and too little sleep. It is not a diagnosis of anything.'
export const NUMBERS_ONLY = 'Only numbers leave the phone. No video, no audio, no faces.'
export const TABLE = 'Table A157'

/** `?demo=`, `?u=`, `?base=` may sit before or after the hash */
export function param(name: string): string | null {
  const hash = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''
  return new URLSearchParams(hash).get(name) ?? new URLSearchParams(location.search).get(name)
}

/** Where the QR sends a phone. `?base=` overrides the page's own address (for printing the poster from a dev build). */
export function baseUrl(): string {
  const b = param('base')
  try {
    if (b) return new URL(b.endsWith('/') ? b : `${b}/`).toString()
  } catch {
    /* fall through to the page's own base */
  }
  return new URL('./', document.baseURI).toString().replace(/[?#].*$/, '')
}
export const visitUrl = () => new URL('#/visit', baseUrl()).toString()
export const bare = (url: string) => url.replace(/^https?:\/\//, '')

// ---- numbers ----

export const fmt = (v: number, ch: Channel) => (ch === 'move' || ch === 'heart' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : v.toFixed(2))
export const signed = (v: number, ch: Channel) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v), ch)}`
export const pct = (x: number | null) => (x == null ? null : `${Math.round(x * 100)}%`)

function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export interface Block {
  h0: number
  h1: number
  n: number
  median: number
  q1: number
  q3: number
}
/** how wide a block has to be before most of them hold three pings */
export const blockWidth = (pings: number): number => (pings >= 600 ? 1 : pings >= 160 ? 2 : pings >= 60 ? 3 : 6)
/** the hall per block of `width` hours: only blocks with a reading are returned, each with its n */
export function blocks(h: number[], v: (number | null)[], width: number): Block[] {
  const by = new Map<number, number[]>()
  h.forEach((x, i) => {
    const val = v[i]
    if (val == null || x < 0) return
    const k = Math.floor(x / width)
    const list = by.get(k)
    if (list) list.push(val)
    else by.set(k, [val])
  })
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, xs]) => {
      const s = xs.sort((a, b) => a - b)
      return { h0: k * width, h1: (k + 1) * width, n: s.length, median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75) }
    })
}

/**
 * The drawing range for one channel, with its tick values. With few readings it is the server's plausible range from 0.
 * From eight readings on it closes in on where the hall actually is (2nd to 98th percentile plus air), so a slow drift
 * over the weekend is visible; the rare value outside is drawn at the edge. `keep` values always stay inside.
 */
export function focus(values: (number | null)[], plausible: [number, number], keep: (number | null)[] = []): { lo: number; hi: number; ticks: number[] } {
  const s = values.filter((v): v is number => v != null).sort((a, b) => a - b)
  let lo = plausible[0]
  let hi = plausible[1] || 1
  let air = hi * 0.03
  if (s.length >= 8) {
    const a = quantile(s, 0.02)
    const b = quantile(s, 0.98)
    air = Math.max((b - a) * 0.15, hi * 0.03)
    lo = Math.max(0, a - air)
    hi = b + air
  }
  // the visitor's own dot is never pinned to the edge of its axis, on the first ping of the weekend either
  for (const k of keep) {
    if (k == null) continue
    lo = Math.max(0, Math.min(lo, k - air * 0.5))
    hi = Math.max(hi, k + air * 0.5)
  }
  const want = (hi - lo) / 4
  const mag = 10 ** Math.floor(Math.log10(want))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= want * 0.999) ?? want
  lo = Math.floor(lo / step + 1e-9) * step
  hi = Math.ceil(hi / step - 1e-9) * step
  const ticks: number[] = []
  for (let t = lo; t <= hi + step * 1e-6; t += step) ticks.push(Number(t.toFixed(6)))
  return { lo, hi, ticks }
}
export const tickLabel = (v: number) => String(Number(v.toFixed(2)))

/** "A fuller smile than 7 in 10 people here." */
export function sits(ch: Channel, p: number): string {
  if (p >= 45 && p <= 55) return 'Right in the middle of the hall.'
  const hi = p > 55
  const tenths = Math.min(9, Math.max(1, Math.round((hi ? p : 100 - p) / 10)))
  if ((hi ? p : 100 - p) >= 95) return `${hi ? CH[ch].more : CH[ch].less} than almost everyone here.`
  return `${hi ? CH[ch].more : CH[ch].less} than ${tenths} in 10 people here.`
}

// ---- time: always Helsinki, whatever the wall computer thinks ----

const HEL = 'Europe/Helsinki'
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: HEL, weekday: 'short' })
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: HEL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: HEL, hour: 'numeric', hourCycle: 'h23' })
export const day = (t: number) => dayFmt.format(t)
export const clock = (t: number) => clockFmt.format(t)
export const hourOf = (t: number) => Number(hourFmt.format(t))
export const HOUR = 3600_000

export function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : `${day(Date.parse(iso))} ${clock(Date.parse(iso))}`
}
export function hoursWord(h: number): string {
  if (h < 1) return 'less than an hour'
  const r = Math.round(h)
  return r === 1 ? 'an hour' : `${r} hours`
}

/** The line that makes a hacker stop. It counts the hours with them. */
export function headline(w: WallState | null): string {
  if (!w) return 'How is your echo right now?'
  const total = (Date.parse(w.until) - Date.parse(w.since)) / HOUR
  if (w.hoursIn < 0) return 'How is your echo tonight?'
  if (w.hoursIn > total) return 'How was your echo this weekend?'
  if (w.hoursIn < 1.5) return 'How is your echo, one hour in?'
  return `How is your echo, ${Math.floor(w.hoursIn)} hours in?`
}

// ---- data ----

export interface WallFeed {
  wall: WallState | null
  /** the server has not answered for a while: the last picture stays up */
  stale: boolean
  /** `points.h` above this arrived since the previous look: they get the arrival pulse */
  freshAfter: number
}
const FRESH_MS = 30_000
/** Polls `GET /api/wall`. `?demo=<n>` (and `&h=<hour>`) asks the server for simulated data, which comes back flagged. */
export function useWall(u: string | null, everyMs = 5000): WallFeed {
  const [feed, setFeed] = useState<WallFeed>({ wall: null, stale: false, freshAfter: Infinity })
  // the newest `points.h` at each look: a dot counts as new for FRESH_MS after it first shows up
  const looks = useRef<{ t: number; top: number }[]>([])
  const fails = useRef(0)
  useEffect(() => {
    let dead = false
    const q = new URLSearchParams()
    if (u) q.set('u', u)
    const demo = param('demo')
    if (demo != null) {
      q.set('demo', demo)
      const h = param('h')
      if (h != null) q.set('h', h)
    }
    const path = `wall${q.size ? `?${q}` : ''}`
    const load = async () => {
      try {
        const wall = await api<WallState>(path)
        if (dead || !wall || !Array.isArray(wall.channels)) return
        fails.current = 0
        const top = wall.points.h.length ? wall.points.h[wall.points.h.length - 1] : -Infinity
        const t = Date.now()
        const seen = looks.current
        seen.push({ t, top })
        while (seen.length > 1 && seen[1].t <= t - FRESH_MS) seen.shift()
        const freshAfter = seen[0].top
        setFeed({ wall, stale: false, freshAfter })
      } catch {
        if (!dead && ++fails.current >= 3) setFeed((f) => ({ ...f, stale: true }))
      }
    }
    void load()
    const id = setInterval(load, everyMs)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [u, everyMs])
  return feed
}
