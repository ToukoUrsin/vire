// How a stored run is played back in about 40 seconds: the still check before, the practice and the still check
// after, each squeezed into a few seconds, then what Today said and the clinic's screen. Pure: the page and the
// tests read the same moments.
import type { ReplayBundle } from '@shared/earreplay'
import type { PacedBreath } from '@shared/earsession'

export type Part = 'before' | 'practice' | 'after' | 'result' | 'clinic'
export interface Segment {
  part: 'before' | 'practice' | 'after'
  /** ms in the session */
  t0: number
  t1: number
  /** seconds in the replay */
  at: number
  dur: number
}
export interface Plan {
  segments: Segment[]
  /** replay seconds when the result shows, and when the clinic's screen shows */
  resultAt: number
  clinicAt: number
  /** replay seconds when it is over */
  end: number
}

export const DUR = { before: 6, practice: 25, after: 6, result: 5, clinic: 3 }

export function plan(b: Pick<ReplayBundle, 'phases' | 'steps'>): Plan {
  const ph = (n: string) => b.phases.find((p) => p.name === n)
  const before = ph('before')
  const session = ph('session')
  const after = ph('after')
  // the check after is its still stretch: the asked smiles that follow are not played
  const rest = after ? b.steps.find((s) => s.ask === 'rest' && s.t0 >= after.t0 - 1 && s.t1 <= after.t1 + 1) : undefined
  const segs: Segment[] = []
  let at = 0
  const add = (part: Segment['part'], t0: number | undefined, t1: number | undefined) => {
    if (t0 === undefined || t1 === undefined || t1 <= t0) return
    segs.push({ part, t0, t1, at, dur: DUR[part] })
    at += DUR[part]
  }
  add('before', before?.t0, before?.t1)
  add('practice', session?.t0, session?.t1)
  add('after', after?.t0, rest ? rest.t1 : after?.t1)
  return { segments: segs, resultAt: at, clinicAt: at + DUR.result, end: at + DUR.result + DUR.clinic }
}

/** where the replay is at `pos` seconds: which part, and the moment in the session (ms) while a check or the practice plays */
export function at(p: Plan, pos: number): { part: Part; seg: Segment | null; t: number | null } {
  for (const s of p.segments) if (pos < s.at + s.dur) return { part: s.part, seg: s, t: s.t0 + ((Math.max(pos, s.at) - s.at) / s.dur) * (s.t1 - s.t0) }
  return { part: pos < p.clinicAt ? 'result' : 'clinic', seg: null, t: null }
}

/** how much a segment is squeezed: session seconds per replay second */
export const squeeze = (s: Segment) => (s.t1 - s.t0) / 1000 / s.dur

/** "2 min 30 s" */
export const mmss = (sec: number) => {
  const s = Math.round(sec)
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`
}

/** the last row at or before t (rows sorted by time) */
export function lastAt<T extends { 0: number }>(rows: T[], t: number): T | null {
  let lo = 0
  let hi = rows.length - 1
  let got: T | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid][0] <= t) {
      got = rows[mid]
      lo = mid + 1
    } else hi = mid - 1
  }
  return got
}

/** the asked breath playing at t, and whether it is the in or the out part */
export function breathAt(breaths: PacedBreath[], t: number): { i: number; b: PacedBreath; phase: 'in' | 'out' } | null {
  for (let i = 0; i < breaths.length; i++) {
    const b = breaths[i]
    if (t >= b.t0 && t < b.t1) return { i, b, phase: t < b.tMid ? 'in' : 'out' }
  }
  return null
}

/** the pace the sound asked for at t: the breath playing, or the last one before */
export function paceAt(breaths: PacedBreath[], t: number): number | null {
  let pace: number | null = null
  for (const b of breaths) {
    if (b.t0 > t) break
    pace = b.perMin
  }
  return pace ?? breaths[0]?.perMin ?? null
}
