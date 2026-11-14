// Which kind of session helps this person most: learned from their own sessions only. Each session is scored by
// how much stiller the head sat in the short check after it than in the same check before it (percent). Each kind
// keeps a belief about its usual score (a Normal-Gamma, as the dose learner does), and the next kind is picked by
// drawing once from each belief and taking the highest (Thompson sampling), after every kind was tried once.
// Pure: the phone, the server and the tests get the same answer from the same sessions.
import { SESSION_KINDS } from './earsession'
import type { SessionKind } from './earsession'

export interface Scored {
  kind: SessionKind
  /** percent less head movement after than before; null when a check had too few samples */
  settle: number | null
  at: string
}

export interface KindBelief {
  kind: SessionKind
  /** sessions of this kind that could be scored */
  n: number
  /** mean score of those sessions, percent; null when none */
  mean: number | null
  /** what the belief says after the sessions: its mean and how wide it still is */
  believed: number
  sd: number
}

export interface Learned {
  kinds: KindBelief[]
  /** sessions that could be scored, all kinds */
  total: number
  /** the kind with the highest believed score among those tried; null before any session */
  best: SessionKind | null
  /** how often `best` came out on top when every belief was drawn from 2,000 times, 0..1 */
  sure: number
  /** learned: said as a finding. leaning: said as "so far". early: nothing is said about what helps */
  said: 'learned' | 'leaning' | 'early'
  /** what to offer next, and why in a few words */
  next: SessionKind
  why: 'not tried yet' | 'helped most so far' | 'still comparing'
}

interface NG {
  mu: number
  kappa: number
  alpha: number
  beta: number
}
/** before any session: no change expected, and scores taken to scatter by about 20 points */
const PRIOR: NG = { mu: 0, kappa: 1, alpha: 2, beta: 400 }

function update(p: NG, xs: number[]): NG {
  const n = xs.length
  if (!n) return p
  const m = xs.reduce((a, b) => a + b, 0) / n
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0)
  const kappa = p.kappa + n
  return { mu: (p.kappa * p.mu + n * m) / kappa, kappa, alpha: p.alpha + n / 2, beta: p.beta + 0.5 * ss + (p.kappa * n * (m - p.mu) ** 2) / (2 * kappa) }
}

type Rng = () => number
function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function normal(rng: Rng): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}
/** Marsaglia and Tsang; alpha is at least 2 here */
function gamma(alpha: number, rng: Rng): number {
  const d = alpha - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    const x = normal(rng)
    const v = (1 + c * x) ** 3
    if (v <= 0) continue
    if (Math.log(Math.max(rng(), 1e-12)) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v
  }
}
const draw = (p: NG, rng: Rng) => p.mu + normal(rng) / Math.sqrt(p.kappa * (gamma(p.alpha, rng) / p.beta))

const round1 = (v: number) => Math.round(v * 10) / 10

export function learn(sessions: Scored[], kinds: readonly SessionKind[] = SESSION_KINDS): Learned {
  const scored = sessions.filter((s): s is Scored & { settle: number } => typeof s.settle === 'number' && Number.isFinite(s.settle) && kinds.includes(s.kind))
  const of = (k: SessionKind) => scored.filter((s) => s.kind === k).map((s) => s.settle)
  const post = new Map(kinds.map((k) => [k, update(PRIOR, of(k))]))
  const beliefs: KindBelief[] = kinds.map((kind) => {
    const xs = of(kind)
    const p = post.get(kind)!
    return { kind, n: xs.length, mean: xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null, believed: round1(p.mu), sd: round1(Math.sqrt(p.beta / (p.kappa * Math.max(p.alpha - 1, 0.5)))) }
  })
  const tried = beliefs.filter((b) => b.n > 0)
  const best = tried.length ? tried.reduce((a, b) => (b.believed > a.believed ? b : a)).kind : null
  // the same sessions always give the same draws, so the screen does not change its mind between two looks
  const rng = mulberry32(hash(scored.map((s) => `${s.kind}${s.at}${s.settle}`).join('|')))
  let wins = 0
  const DRAWS = 2000
  if (best && tried.length > 1) {
    for (let i = 0; i < DRAWS; i++) {
      let top: SessionKind = tried[0].kind
      let v = -Infinity
      for (const b of tried) {
        const x = draw(post.get(b.kind)!, rng)
        if (x > v) {
          v = x
          top = b.kind
        }
      }
      if (top === best) wins++
    }
  }
  const sure = best && tried.length > 1 ? Math.round((wins / DRAWS) * 100) / 100 : 0
  const bestN = beliefs.find((b) => b.kind === best)?.n ?? 0
  const compared = tried.filter((b) => b.n >= 2).length
  const said: Learned['said'] = best && bestN >= 3 && compared >= 2 && sure >= 0.8 ? 'learned' : best && tried.length >= 2 && scored.length >= 3 ? 'leaning' : 'early'
  // next: every kind once, then one draw from each belief and the highest wins
  const untried = beliefs.find((b) => b.n === 0)
  let next: SessionKind = untried?.kind ?? kinds[0]
  let why: Learned['why'] = 'not tried yet'
  if (!untried) {
    let v = -Infinity
    for (const k of kinds) {
      const x = draw(post.get(k)!, rng)
      if (x > v) {
        v = x
        next = k
      }
    }
    why = next === best ? 'helped most so far' : 'still comparing'
  }
  return { kinds: beliefs, total: scored.length, best, sure, said, next, why }
}

// ---- how long, and when ----

/** how long a breathing practice runs before anything is known about the person, seconds */
export const LENGTH_DEFAULT_S = 150
const LENGTH_MIN_S = 120
const LENGTH_MAX_S = 210

export interface LengthLearned {
  /** breathing practices in which the sound got down to the goal pace */
  n: number
  /** breathing practices in all */
  of: number
  /** seconds it typically took to get there (the middle one); null when it never has */
  reachS: number | null
  /** how long the next breathing practice runs, seconds */
  nextS: number
}

/**
 * How long this person's breathing practice should run. The sound only slows when the AirPods read the breath
 * following it (or a still head), so the time it took to reach the goal pace is the person's own. The next
 * practice runs that long plus a minute at the goal pace; a little longer than the default when the goal was
 * never reached; the default before any practice.
 */
export function learnLength(sessions: { kind: SessionKind; paceSlowest?: number | null; slowestAtS?: number | null }[], goal = 6): LengthLearned {
  const b = sessions.filter((s) => s.kind === 'breathe' && typeof s.paceSlowest === 'number' && typeof s.slowestAtS === 'number')
  const reached = b
    .filter((s) => s.paceSlowest! <= goal)
    .map((s) => s.slowestAtS!)
    .sort((x, y) => x - y)
  const reachS = reached.length ? (reached.length % 2 ? reached[reached.length >> 1] : Math.round((reached[(reached.length >> 1) - 1] + reached[reached.length >> 1]) / 2)) : null
  const nextS = !b.length ? LENGTH_DEFAULT_S : reachS === null ? 180 : Math.max(LENGTH_MIN_S, Math.min(LENGTH_MAX_S, Math.round((reachS + 60) / 10) * 10))
  return { n: reached.length, of: b.length, reachS, nextS }
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'
export const dayPart = (hour: number): DayPart => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 23 ? 'evening' : 'night')

export interface WhenLearned {
  /** the parts of the day with a scored practice, most practices first */
  parts: { part: DayPart; n: number; mean: number }[]
  /** scored practices whose time of day is known */
  total: number
  /** the part of the day that has helped most; only said when two parts have two practices each and one leads by ten points */
  best: DayPart | null
}

/** which time of day has suited this person: counted from their own scored practices only */
export function learnWhen(sessions: { hour?: number | null; settle: number | null; happened?: boolean }[]): WhenLearned {
  const by = new Map<DayPart, number[]>()
  for (const s of sessions) {
    if (typeof s.hour !== 'number' || typeof s.settle !== 'number' || s.happened === false) continue
    const p = dayPart(s.hour)
    by.set(p, [...(by.get(p) ?? []), s.settle])
  }
  const parts = [...by.entries()].map(([part, xs]) => ({ part, n: xs.length, mean: round1(xs.reduce((a, x) => a + x, 0) / xs.length) })).sort((a, b) => b.n - a.n)
  const enough = parts.filter((p) => p.n >= 2).sort((a, b) => b.mean - a.mean)
  const best = enough.length >= 2 && enough[0].mean - enough[1].mean >= 10 ? enough[0].part : null
  return { parts, total: parts.reduce((a, p) => a + p.n, 0), best }
}
