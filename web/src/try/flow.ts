// The minute on /#/try, as plain steps with no screen and no clock of its own: which breath the sea plays next,
// when a stretch is long enough to read, what was read in it, what the sea does then, and the words for it. The
// reading and the deciding are Today's own (breath.ts, pace.ts); only the sensor differs. Pure, so the same code
// runs under the page and under the tests.
import type { BreathRead, PaceFollow } from '@shared/earsession'
import { breathRate, followsPace, gapsOf, stillness } from '../tune/session/breath'
import { IN_SHARE, PACE_GOAL, breathsAt, decide, newPacer, startPace } from '../tune/session/pace'
import type { Pacer } from '../tune/session/pace'

export const TRY = {
  /** the first seconds, while the phone is being put against the chest, are left out of the first reading */
  settleMs: 3500,
  /** a stretch must be this long to be read (breath.ts needs 20 seconds) */
  readMs: 20_200,
  /** after this, one more breath at the pace just decided, then the end */
  wrapMs: 60_000,
  /** the end, whatever was read */
  maxMs: 85_000,
  /** a phone on a chest tilts 1 to 4 degrees with a breath: less than this, peak to trough, is not called a breath */
  minTiltDeg: 0.3,
  /** the pace read blind must be this close to the sea's, breaths a minute, to count as following */
  nearPerMin: 1.5,
  /** slow tilt, degrees a second: at or under this the phone is called still (Today's own floor for a head) */
  stillDegS: 1.5,
} as const

export interface TryBreath {
  t0: number
  tMid: number
  t1: number
  perMin: number
}

export interface TryCheck {
  /** when it was read, and the stretch it was read in */
  t: number
  t0: number
  from: number
  to: number
  follows: boolean
  readable: boolean
  still: boolean
  coherence: number
  amplitudeDeg: number
  moveDegS: number | null
  /** the pace read blind in that stretch, when one could be */
  perMin: number | null
  conf: number
  by: 'breath' | 'stillness' | 'held'
  /** the phone's readings stopped for a moment in this stretch */
  gap?: boolean
  line: string
}

export interface TryState {
  pacer: Pacer
  breaths: TryBreath[]
  checks: TryCheck[]
  /** breaths played at the pace now playing */
  atPace: number
  /** set once the minute is long enough: the breath now playing is the last */
  wrap: boolean
}

export interface TryCounts {
  from: number
  to: number
  checks: number
  /** the breath was read following the sea */
  followed: number
  /** no breath could be read and the phone was still */
  byStill: number
  /** a breath was read, at another pace than the sea's */
  notFollowed: number
  /** no breath could be read and the phone was moving, or its readings stopped for a moment */
  moving: number
}

const r3 = (v: number) => Math.round(v * 1000) / 1000
/** 8.5 stays 8.5, 7 stays 7 */
export const paceWord = (p: number) => String(Math.round(p * 10) / 10)

export const newTry = (own?: BreathRead | null): TryState => ({ pacer: newPacer(startPace(own)), breaths: [], checks: [], atPace: 0, wrap: false })

/** the breath the sea plays from `t`: in for 40 % of it, out for the rest */
export function planBreath(s: TryState, t: number): TryBreath {
  const dur = 60_000 / s.pacer.pace
  return { t0: t, tMid: t + dur * IN_SHARE, t1: t + dur, perMin: s.pacer.pace }
}

/** how high the sea is at `t`, 0 to 1: it rises through the in-breath and falls through the out-breath */
export function seaAt(breaths: TryBreath[], t: number): number {
  for (let i = breaths.length - 1; i >= 0; i--) {
    const b = breaths[i]!
    if (t < b.t0) continue
    if (t > b.t1) return 0
    return t <= b.tMid ? (t - b.t0) / Math.max(1, b.tMid - b.t0) : 1 - (t - b.tMid) / Math.max(1, b.t1 - b.tMid)
  }
  return 0
}

export function lineFor(c: Pick<TryCheck, 'from' | 'to' | 'by' | 'readable' | 'gap'>): string {
  const to = paceWord(c.to)
  if (c.by === 'breath') return c.to < c.from ? `Your breath followed. Slower now: ${to} a minute.` : `Your breath followed. Staying at ${to}.`
  if (c.by === 'stillness') return c.to < c.from ? `No breath read. The phone was still, so slower anyway: ${to} a minute.` : `No breath read. The phone was still. Staying at ${to}.`
  if (c.to > c.from) return `Your breath did not follow twice. Back to ${to} a minute.`
  if (c.readable) return `Your breath did not follow. Staying at ${to}.`
  return c.gap ? `No breath read: the phone's motion readings stopped for a moment. Staying at ${to}.` : `No breath read, the phone was moving. Staying at ${to}.`
}

/**
 * Read one stretch and decide. The rules are Today's: the breath follows when the slow tilt sits at the sea's
 * pace; when no breath can be read at all, a still phone counts instead; otherwise the sea holds.
 */
export function readStretch(rows: number[][], t0: number, t1: number, pacer: Pacer): { check: TryCheck; next: Pacer } {
  const at: PaceFollow = followsPace(rows, t0, t1, pacer.pace, TRY.minTiltDeg)
  const read = breathRate(rows, t0, t1)
  // A hand-held phone drifts more than a head. Here the breath only counts as following when the pace read blind,
  // without knowing what the sea asked, also lands on the sea's pace.
  const f: PaceFollow = { ...at, follows: at.follows && read.perMin !== null && Math.abs(read.perMin - pacer.pace) <= TRY.nearPerMin }
  const mv = stillness(rows, t0, t1)
  // A hand drifts slowly even when no breath reaches the phone, and a drift can look like a pace. A pace read
  // blind only counts as a breath when the tilt at that pace is as large as a breath's.
  const swing = read.perMin !== null && read.conf >= 0.35 ? followsPace(rows, t0, t1, read.perMin, TRY.minTiltDeg).amplitudeDeg : 0
  const readable = f.follows || swing >= TRY.minTiltDeg
  // a stretch in which the phone's readings stopped cannot be read, and is not called still either
  const gap = gapsOf(rows.filter((row) => row[0]! >= t0 && row[0]! <= t1)).length > 0
  const still = !gap && mv !== null && mv <= TRY.stillDegS
  const d = decide(pacer, { follows: f.follows, readable, still })
  const c = { from: pacer.pace, to: d.next.pace, by: d.by, readable, ...(gap ? { gap: true } : {}) }
  return {
    next: d.next,
    check: {
      t: Math.round(t1),
      t0: Math.round(t0),
      ...c,
      follows: f.follows,
      still,
      coherence: r3(f.coherence),
      amplitudeDeg: r3(f.amplitudeDeg),
      moveDegS: mv === null ? null : r3(mv),
      perMin: read.perMin === null ? null : r3(read.perMin),
      conf: r3(read.conf),
      line: lineFor(c),
    },
  }
}

/**
 * A breath has just ended at `t` (ms since the sea began). Reads the stretch when it is long enough, steps the
 * pace, and says whether the minute is over. `rows` are the phone's rows on the same clock.
 */
export function afterBreath(s: TryState, breath: TryBreath, rows: number[][], t: number): { check: TryCheck | null; done: boolean } {
  s.breaths.push(breath)
  s.atPace++
  if (s.wrap) return { check: null, done: true }
  let check: TryCheck | null = null
  const need = breathsAt(s.pacer.pace)
  if (s.atPace >= need) {
    // the last `need` breaths; the very first reading leaves out the seconds the phone was being put in place
    const from = s.breaths[s.breaths.length - need]!.t0
    const t0 = Math.max(from, Math.min(TRY.settleMs, t - TRY.readMs))
    const got = readStretch(rows, t0, t, s.pacer)
    check = got.check
    s.checks.push(check)
    // a new pace, or a pace confirmed, starts a new stretch; a pace held is read again after one more breath
    if (got.next.pace !== s.pacer.pace || check.by !== 'held') s.atPace = 0
    s.pacer = got.next
  }
  if (t >= TRY.maxMs) return { check, done: true }
  if (check && t >= TRY.wrapMs) s.wrap = true
  return { check, done: false }
}

export function countsOf(s: TryState): TryCounts {
  const last = s.breaths[s.breaths.length - 1]
  const c = s.checks
  return {
    from: s.pacer.start,
    to: last ? last.perMin : s.pacer.start,
    checks: c.length,
    followed: c.filter((x) => x.by === 'breath').length,
    byStill: c.filter((x) => x.by === 'stillness').length,
    notFollowed: c.filter((x) => x.by === 'held' && x.readable).length,
    moving: c.filter((x) => x.by === 'held' && !x.readable).length,
  }
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/** the result, in sentences that say only what was read */
export function resultLines(k: TryCounts): { head: string; lines: string[] } {
  const head =
    k.to < k.from
      ? `The sea went from ${paceWord(k.from)} to ${paceWord(k.to)} breaths a minute.`
      : `The sea stayed at ${paceWord(k.from)} breaths a minute.`
  if (!k.checks) return { head, lines: ['It stopped before the first stretch was long enough to read. Nothing was read.'] }
  const lines: string[] = [`Your phone was read ${times(k.checks)}.`]
  if (k.followed) lines.push(`${cap(times(k.followed))} your breath was read following the sea.`)
  if (k.byStill) lines.push(`${cap(times(k.byStill))} no breath could be read and the phone was still, so the sea went by that.`)
  if (k.notFollowed) lines.push(`${cap(times(k.notFollowed))} a breath was read that did not follow.`)
  if (k.moving) lines.push(`${cap(times(k.moving))} no breath could be read, because the phone was moving or its readings stopped.`)
  if (!k.followed && k.to >= k.from) lines.push('The sea only slows when the phone reads your breath with it, or reads nothing and lies still.')
  if (k.to <= PACE_GOAL) lines.push('Six a minute is as slow as it goes.')
  return { head, lines }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface Trace {
  /** the slow tilt, in degrees around its own middle, one value per point, oldest first; turned so that up is "with the sea" when that can be told */
  tilt: number[]
  /** the sea at the same times, 0 to 1 */
  sea: number[]
  /** where each point sits between `t0` (0) and `t1` (1) */
  x: number[]
  /** peak to trough of the slow tilt in view, degrees */
  swingDeg: number
  /** how far the tilt and the sea moved together in view, -1 to 1 (0 when there is nothing to compare) */
  together: number
}

/**
 * The line a person sees: the phone's tilt between `t0` and `t1` with everything faster or slower than breathing
 * taken out, beside the sea. Of the three tilt angles the one that moves most is drawn. Which way a chest tilts a
 * phone on the in-breath depends on how it is held, so the line is turned to rise with the sea when the two move
 * together; nothing else is done to it.
 */
export function breathTrace(rows: number[][], breaths: TryBreath[], t0: number, t1: number, points = 120): Trace {
  const empty: Trace = { tilt: [], sea: [], x: [], swingDeg: 0, together: 0 }
  // twelve seconds of run-in let the slow filter settle before the part that is drawn
  const src = rows.filter((row) => row[0]! >= t0 - 12_000 && row[0]! <= t1)
  if (src.length < 10 || !(t1 > t0)) return empty
  const band: number[][] = [[], [], []]
  for (let ch = 0; ch < 3; ch++) {
    let slow = src[0]![ch + 1]!
    let fast = 0
    for (let i = 0; i < src.length; i++) {
      const dt = i ? Math.min(300, src[i]![0]! - src[i - 1]![0]!) / 1000 : 0
      const x = src[i]![ch + 1]!
      slow += (x - slow) * (1 - Math.exp(-dt / 3.2))
      fast += (x - slow - fast) * (1 - Math.exp(-dt / 0.3))
      band[ch]!.push(fast)
    }
  }
  const first = src.findIndex((row) => row[0]! >= t0)
  if (first < 0) return empty
  const power = band.map((b) => b.slice(first).reduce((a, v) => a + v * v, 0))
  const ch = power.indexOf(Math.max(...power))
  const tilt: number[] = []
  const sea: number[] = []
  const x: number[] = []
  let cursor = first
  for (let i = 0; i < points; i++) {
    const t = t0 + ((t1 - t0) * i) / (points - 1)
    if (t < src[first]![0]! || t > src[src.length - 1]![0]! + 100) continue
    while (cursor + 1 < src.length && src[cursor + 1]![0]! <= t) cursor++
    tilt.push(band[ch]![cursor]!)
    sea.push(seaAt(breaths, t))
    x.push(i / (points - 1))
  }
  if (tilt.length < 3) return empty
  const mt = tilt.reduce((a, b) => a + b, 0) / tilt.length
  const ms = sea.reduce((a, b) => a + b, 0) / sea.length
  let st = 0
  let ss = 0
  let sx = 0
  for (let i = 0; i < tilt.length; i++) {
    st += (tilt[i]! - mt) ** 2
    ss += (sea[i]! - ms) ** 2
    sx += (tilt[i]! - mt) * (sea[i]! - ms)
  }
  const corr = st > 1e-9 && ss > 1e-9 ? sx / Math.sqrt(st * ss) : 0
  const turned = corr < 0 ? tilt.map((v) => -v) : tilt
  return { tilt: turned.map((v) => v - (corr < 0 ? -mt : mt)), sea, x, swingDeg: r3(Math.max(...tilt) - Math.min(...tilt)), together: r3(Math.abs(corr)) }
}
