// Passive sensing, for the time a Vire page is open and the AirPods stream motion: one small bin a minute, the
// day as a handful of plain numbers, the person's own usual from their earlier days, what has drifted from it,
// and when to offer a short practice in the AirPods. Nothing here runs unless the page is open. Pure.
//
// Head rows are [t epoch ms, pitchDeg, yawDeg, rollDeg, ax, ay, az, ...] (the rows of a teaching minute, on the
// wall clock). Pitch is against gravity and grows when the head tilts up.
//
// Call mode: while a call is on (or anything else uses the microphone) the iPhone sends sound over a Bluetooth
// HFP route and the AirPods send far fewer motion samples. That route is how a call is known here.
import { walkWindows } from './earwalk'
import type { SessionKind } from './earsession'

/** a minute is read in 60 parts ("seconds"; shorter only when a test speeds the minute up) */
export const SLOTS = 60
/** head down = pitch more than this many degrees below the person's own upright */
export const DOWN_DEG = 20
/** a walk is at least this many seconds of steps in a row */
export const WALK_BOUT_S = 60
/** an earlier day counts toward the usual only with at least this many minutes worn */
export const USUAL_MIN_WORN = 30
/** a band around the usual only from this many earlier days on */
export const BAND_DAYS = 3
/** at most one offer in this many minutes */
export const OFFER_GAP_MIN = 30
/**
 * Stated defaults, used only before there is a band of the person's own: each one is said to be a default
 * wherever it is used.
 */
export const DEFAULTS = {
  /** head down for most of the last 10 minutes */
  headDownOffer: 0.6,
  /** a day with the head down more than half the time worn */
  headDownDay: 0.5,
  /** typical head movement while sitting, degrees a second, above which the head is restless */
  restlessDegS: 12,
} as const

export type PassiveShell = 'ios' | 'mac' | 'sim'
export const PASSIVE_SHELLS: readonly PassiveShell[] = ['ios', 'mac', 'sim']
/** [from, to) in seconds of the minute */
export type Run = [number, number]

export interface PassiveBin {
  v: 1
  /** when the minute started, epoch ms */
  at: number
  /** how long the minute was: 60000, shorter only in tests */
  ms: number
  /** the device's own date for that minute, YYYY-MM-DD */
  day: string
  /** 'sim' is a stand-in or a script: never mixed into a person's days or usual */
  shell: PassiveShell
  /** AirPods samples in the minute */
  samples: number
  /** seconds with samples coming in: the AirPods were in and the page was open */
  wornS: number
  /** per second: the median pitch, whole degrees; null when nothing came that second */
  pitch: (number | null)[]
  /** the seconds with steps */
  walk: Run[]
  /** steps a minute while walking in this minute */
  stepsPerMin: number | null
  /** seconds in call mode */
  call: Run[]
  /** seconds while a practice ran */
  practice: Run[]
  /** typical head movement in the seconds not walking, degrees a second (median); null with too little */
  moveDegS: number | null
  /** asked-for events the person's own model passed its check on; null when the model cannot count it */
  nods: number | null
  smiles: number | null
  /** mean heart rate in the minute (AirPods, only while a practice ran), and how many samples */
  hr: number | null
  hrN: number
}

export const binId = (b: Pick<PassiveBin, 'shell' | 'at'>) => `${b.shell}:${b.at}`
export const isSim = (shell: PassiveShell) => shell === 'sim'

/** the date on this device's clock */
export function localDay(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const runLen = (runs: Run[]) => runs.reduce((a, [x, y]) => a + (y - x), 0)
const inRuns = (runs: Run[], i: number) => runs.some(([x, y]) => i >= x && i < y)
function toRuns(flags: boolean[]): Run[] {
  const out: Run[] = []
  let start = -1
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      out.push([start, i])
      start = -1
    }
  }
  return out
}
const round1 = (x: number) => Math.round(x * 10) / 10

/** The same minute sent twice, or a snapshot then the whole minute: keep the one with more samples. */
export function keepBetter(a: PassiveBin | undefined, b: PassiveBin): PassiveBin {
  return !a || b.samples > a.samples ? b : a
}

// ------------------------------------------------------------ the tracker

export interface PassiveLive {
  /** samples came in the last 3 seconds */
  worn: boolean
  /** samples a second, over the last 2 seconds */
  hz: number
  /** the last 4 seconds had steps */
  walking: boolean
  callMode: boolean
  /** median pitch of the last 5 seconds; null when nothing came */
  pitch: number | null
}

export interface PassiveTracker {
  /** one AirPods row, [t epoch ms, pitch, yaw, roll, ax, ay, az, ...] */
  head(row: number[]): void
  heart(t: number, bpm: number): void
  /** call mode on or off from now */
  call(on: boolean): void
  /** a practice running or not from now */
  practice(on: boolean): void
  /** the person's own model saw one (only counted while `counting` says it can) */
  event(e: 'nod' | 'smile', t: number): void
  /** which events the model passed its check on; the others stay null in the bins */
  counting(c: { nod: boolean; smile: boolean }): void
  /** close every minute that has ended by `now`; returns the ones that had the AirPods in */
  tick(now: number): PassiveBin[]
  /** the minute so far, without closing it (the page is going away); null when nothing came */
  snapshot(): PassiveBin | null
  live(now: number): PassiveLive
  readonly minuteMs: number
}

export interface TrackerOpts {
  shell: PassiveShell
  /** 60000; tests shorten it */
  minuteMs?: number
  dayOf?: (t: number) => string
}

export function createPassiveTracker(opts: TrackerOpts): PassiveTracker {
  const minuteMs = opts.minuteMs ?? 60_000
  const slotMs = minuteMs / SLOTS
  const dayOf = opts.dayOf ?? localDay
  /** rows of the open minute and the 4 seconds before it (a step beat across the minute's edge) */
  let rows: number[][] = []
  /** per row: [call on, practice on] when it came */
  let flags: [boolean, boolean][] = []
  let hearts: Array<[number, number]> = []
  let events: Array<['nod' | 'smile', number]> = []
  let open: number | null = null
  let callOn = false
  let practiceOn = false
  let counts = { nod: false, smile: false }
  const startOf = (t: number) => Math.floor(t / minuteMs) * minuteMs

  function read(start: number): PassiveBin | null {
    const end = start + minuteMs
    const idx: number[] = []
    for (let i = 0; i < rows.length; i++) if (rows[i][0] >= start && rows[i][0] < end) idx.push(i)
    if (!idx.length) return null
    const pitches: number[][] = Array.from({ length: SLOTS }, () => [])
    const moves: number[][] = Array.from({ length: SLOTS }, () => [])
    const callF = new Array<boolean>(SLOTS).fill(false)
    const pracF = new Array<boolean>(SLOTS).fill(false)
    let prev: number[] | null = null
    for (const i of idx) {
      const r = rows[i]
      const s = Math.min(SLOTS - 1, Math.floor((r[0] - start) / slotMs))
      pitches[s].push(r[1])
      if (flags[i][0]) callF[s] = true
      if (flags[i][1]) pracF[s] = true
      if (prev) {
        const dt = (r[0] - prev[0]) / 1000
        if (dt > 0 && dt < 0.5) {
          let dy = r[2] - prev[2]
          if (dy > 180) dy -= 360
          else if (dy < -180) dy += 360
          moves[s].push(Math.hypot(r[1] - prev[1], dy, r[3] - prev[3]) / dt)
        }
      }
      prev = r
    }
    const pitch = pitches.map((p) => (p.length ? Math.round(median(p)!) : null))
    const wornS = pitch.filter((p) => p !== null).length
    // steps: each walked four-second stretch marks its middle two seconds
    const walkF = new Array<boolean>(SLOTS).fill(false)
    const beats: number[] = []
    for (const w of walkWindows(rows, start - 2000, end)) {
      if (!w.walked) continue
      const a = w.a + 1000
      const b = w.a + 3000
      let marked = false
      for (let s = 0; s < SLOTS; s++) {
        const mid = start + (s + 0.5) * slotMs
        if (mid >= a && mid < b && pitch[s] !== null) {
          walkF[s] = true
          marked = true
        }
      }
      if (marked && w.f) beats.push(w.f)
    }
    const still: number[] = []
    for (let s = 0; s < SLOTS; s++) if (!walkF[s] && moves[s].length) still.push(moves[s].reduce((a, b) => a + b, 0) / moves[s].length)
    const hs = hearts.filter(([t]) => t >= start && t < end)
    const count = (e: 'nod' | 'smile') => (counts[e] ? events.filter(([x, t]) => x === e && t >= start && t < end).length : null)
    const spm = median(beats)
    return {
      v: 1,
      at: start,
      ms: minuteMs,
      day: dayOf(start),
      shell: opts.shell,
      samples: idx.length,
      wornS,
      pitch,
      walk: toRuns(walkF),
      stepsPerMin: spm === null ? null : Math.round(spm * 60),
      call: toRuns(callF),
      practice: toRuns(pracF),
      moveDegS: still.length >= SLOTS / 6 ? round1(median(still)!) : null,
      nods: count('nod'),
      smiles: count('smile'),
      hr: hs.length ? Math.round(hs.reduce((a, [, b]) => a + b, 0) / hs.length) : null,
      hrN: hs.length,
    }
  }

  /** rows before this have had their minute closed */
  let closedUntil = -Infinity

  return {
    minuteMs,
    head(row) {
      const t = row[0]
      if (!Number.isFinite(t) || !Number.isFinite(row[1])) return
      if (t < closedUntil || (open !== null && t < open)) return
      if (open === null) open = startOf(t)
      rows.push(row)
      flags.push([callOn, practiceOn])
    },
    heart(t, bpm) {
      if (Number.isFinite(bpm) && bpm > 25 && bpm < 230) hearts.push([t, bpm])
      if (hearts.length > 400) hearts = hearts.filter(([x]) => x > t - 10 * minuteMs)
    },
    call(on) {
      callOn = on
    },
    practice(on) {
      practiceOn = on
    },
    event(e, t) {
      if (counts[e]) events.push([e, t])
    },
    counting(c) {
      counts = { nod: !!c.nod, smile: !!c.smile }
    },
    tick(now) {
      const out: PassiveBin[] = []
      while (open !== null && open + minuteMs <= now) {
        const b = read(open)
        if (b && b.wornS > 0) out.push(b)
        const next = open + minuteMs
        closedUntil = next
        // the last four seconds stay, for a step beat across the edge into the next minute
        const k = rows.findIndex((r) => r[0] >= next - 4000)
        rows = k < 0 ? [] : rows.slice(k)
        flags = k < 0 ? [] : flags.slice(k)
        hearts = hearts.filter(([t]) => t >= next)
        events = events.filter(([, t]) => t >= next)
        // after a gap, straight to the minute of the next row that came
        const first = rows.find((r) => r[0] >= next)
        open = first ? startOf(first[0]) : null
      }
      return out
    },
    snapshot() {
      if (open === null) return null
      const b = read(open)
      return b && b.wornS > 0 ? b : null
    },
    live(now) {
      const recent = rows.filter((r) => r[0] > now - 5000 && r[0] <= now + 100)
      const n2 = recent.filter((r) => r[0] > now - 2000).length
      const last = rows.length ? rows[rows.length - 1][0] : -Infinity
      const wins = walkWindows(rows, now - 4000, now)
      return {
        worn: now - last < 3000,
        hz: Math.round(n2 / 2),
        walking: wins.length > 0 && wins[wins.length - 1].walked,
        callMode: callOn,
        pitch: recent.length ? median(recent.map((r) => r[1])) : null,
      }
    },
  }
}

// ------------------------------------------------------------ the day

export interface Upright {
  pitch: number
  /** the median pitch while walking when there was walking, else the median of the day so far */
  from: 'walking' | 'day'
}

/** the person's own upright, from these minutes */
export function uprightOf(bins: PassiveBin[]): Upright | null {
  const walking: number[] = []
  const all: number[] = []
  for (const b of bins)
    b.pitch.forEach((p, s) => {
      if (p === null) return
      all.push(p)
      if (inRuns(b.walk, s)) walking.push(p)
    })
  if (walking.length >= 30) return { pitch: median(walking)!, from: 'walking' }
  if (all.length >= 30) return { pitch: median(all)!, from: 'day' }
  return null
}

/** head-down seconds and the worn seconds they are out of, leaving out practice */
export function headDownOf(bins: PassiveBin[], upright: Upright | null): { down: number; of: number } {
  if (!upright) return { down: 0, of: 0 }
  let down = 0
  let of = 0
  for (const b of bins)
    b.pitch.forEach((p, s) => {
      if (p === null || inRuns(b.practice, s)) return
      of++
      if (p < upright.pitch - DOWN_DEG) down++
    })
  return { down, of }
}

export interface DaySummary {
  day: string
  /** made from a stand-in or a script, not a person */
  sim: boolean
  /** minutes with the AirPods in while the page was open */
  wornMin: number
  /** bouts of at least a minute of steps in a row */
  walks: number
  walkMin: number
  stepsPerMin: number | null
  callMin: number
  upright: Upright | null
  /** share of the worn time (outside practice) with the head down; null with no upright yet */
  headDown: number | null
  /** typical head movement while not walking, degrees a second */
  moveDegS: number | null
  /** only when the person's own model passed its check on them; null otherwise */
  nodsPerHour: number | null
  smilesPerHour: number | null
  /** AirPods heart rate, only from minutes where a practice ran and it came */
  heart: { bpm: number; n: number } | null
  /** first and last minute, epoch ms */
  from: number
  to: number
}

/** walk bouts in time order: a run that reaches a minute's end goes on into the next minute's start */
export function walkBouts(bins: PassiveBin[]): number[] {
  const sorted = bins.slice().sort((a, b) => a.at - b.at)
  const bouts: number[] = []
  let cur = 0
  let lastEnd: { at: number; ms: number; s: number } | null = null
  for (const b of sorted)
    for (const [x, y] of b.walk) {
      const joins = lastEnd && ((lastEnd.at === b.at && x - lastEnd.s <= 3) || (lastEnd.at + lastEnd.ms === b.at && lastEnd.s >= SLOTS - 3 && x <= 3))
      if (joins) cur += y - x
      else {
        if (cur) bouts.push(cur)
        cur = y - x
      }
      lastEnd = { at: b.at, ms: b.ms, s: y }
    }
  if (cur) bouts.push(cur)
  return bouts
}

const perHour = (bins: PassiveBin[], key: 'nods' | 'smiles'): number | null => {
  const with_ = bins.filter((b) => b[key] !== null)
  const worn = with_.reduce((a, b) => a + b.wornS, 0) / SLOTS
  if (worn < 10) return null
  return round1((with_.reduce((a, b) => a + (b[key] as number), 0) / worn) * 60)
}

/** one day of one kind (a person's, or a stand-in's) */
export function summarizeDay(bins: PassiveBin[]): DaySummary | null {
  if (!bins.length) return null
  const sorted = bins.slice().sort((a, b) => a.at - b.at)
  const upright = uprightOf(sorted)
  const hd = headDownOf(sorted, upright)
  const bouts = walkBouts(sorted).filter((s) => s >= WALK_BOUT_S)
  const walkS = sorted.reduce((a, b) => a + runLen(b.walk), 0)
  const steps: number[] = []
  for (const b of sorted) if (b.stepsPerMin !== null) for (let i = 0; i < Math.max(1, runLen(b.walk)); i++) steps.push(b.stepsPerMin)
  const moves = sorted.filter((b) => b.moveDegS !== null && !b.practice.length).map((b) => b.moveDegS as number)
  const hs = sorted.filter((b) => b.hr !== null && b.hrN > 0)
  const hrN = hs.reduce((a, b) => a + b.hrN, 0)
  return {
    day: sorted[0].day,
    sim: sorted.some((b) => isSim(b.shell)),
    wornMin: Math.round(sorted.reduce((a, b) => a + b.wornS, 0) / SLOTS),
    walks: bouts.length,
    walkMin: Math.round(walkS / SLOTS),
    stepsPerMin: steps.length ? Math.round(median(steps)!) : null,
    callMin: Math.round(sorted.reduce((a, b) => a + runLen(b.call), 0) / SLOTS),
    upright,
    headDown: hd.of >= 30 ? Math.round((hd.down / hd.of) * 100) / 100 : null,
    moveDegS: moves.length ? round1(median(moves)!) : null,
    nodsPerHour: perHour(sorted, 'nods'),
    smilesPerHour: perHour(sorted, 'smiles'),
    heart: hrN ? { bpm: Math.round(hs.reduce((a, b) => a + (b.hr as number) * b.hrN, 0) / hrN), n: hrN } : null,
    from: sorted[0].at,
    to: sorted[sorted.length - 1].at,
  }
}

/** every day in these bins, a person's days and a stand-in's apart, oldest first */
export function summarizeDays(bins: PassiveBin[]): DaySummary[] {
  const by = new Map<string, PassiveBin[]>()
  for (const b of bins) {
    const k = `${b.day}|${isSim(b.shell) ? 's' : 'r'}`
    const list = by.get(k)
    if (list) list.push(b)
    else by.set(k, [b])
  }
  return [...by.values()].map((l) => summarizeDay(l)!).sort((a, b) => a.day.localeCompare(b.day) || Number(a.sim) - Number(b.sim))
}

// ------------------------------------------------------------ the usual

export interface UsualMetric {
  median: number
  /** the band: only from BAND_DAYS earlier days on */
  lo: number | null
  hi: number | null
  /** how many earlier days it comes from */
  days: number
}
export type UsualKey = 'wornMin' | 'walks' | 'walkMin' | 'walkPerHour' | 'callMin' | 'headDown' | 'moveDegS' | 'nodsPerHour' | 'smilesPerHour'
export interface PassiveUsual {
  /** earlier days it comes from (each with at least USUAL_MIN_WORN minutes worn) */
  days: number
  band: boolean
  /** "too early for a band" until there are BAND_DAYS earlier days; null after */
  note: string | null
  sim: boolean
  m: Partial<Record<UsualKey, UsualMetric>>
}

/** a band is never narrower than this either side of the median */
const FLOOR: Record<UsualKey, number> = { wornMin: 30, walks: 1, walkMin: 10, walkPerHour: 3, callMin: 10, headDown: 0.08, moveDegS: 2, nodsPerHour: 3, smilesPerHour: 2 }
const valueOf = (d: DaySummary, k: UsualKey): number | null =>
  k === 'walkPerHour' ? (d.wornMin >= USUAL_MIN_WORN ? round1((d.walkMin / d.wornMin) * 60) : null) : (d[k] as number | null)

/**
 * The person's usual from their own earlier days (before `today`), the same kind as asked (a person's days never
 * mix with a stand-in's): the median of each number, and from three days on a band of median +- 1.5 times the
 * median distance from it, never narrower than a stated floor.
 */
export function usualOf(days: DaySummary[], today: string, sim = false): PassiveUsual {
  const earlier = days.filter((d) => d.sim === sim && d.day < today && d.wornMin >= USUAL_MIN_WORN)
  const band = earlier.length >= BAND_DAYS
  const m: PassiveUsual['m'] = {}
  for (const k of Object.keys(FLOOR) as UsualKey[]) {
    const xs = earlier.map((d) => valueOf(d, k)).filter((x): x is number => x !== null)
    if (!xs.length) continue
    const mid = median(xs)!
    const mad = median(xs.map((x) => Math.abs(x - mid)))!
    const half = Math.max(1.5 * mad, FLOOR[k])
    const lo = band && xs.length >= BAND_DAYS ? Math.max(0, mid - half) : null
    const hi = band && xs.length >= BAND_DAYS ? mid + half : null
    m[k] = { median: k === 'headDown' ? Math.round(mid * 100) / 100 : round1(mid), lo, hi, days: xs.length }
  }
  return { days: earlier.length, band, note: band ? null : 'too early for a band', sim, m }
}

/** what a device reads back from the server */
export interface PassiveMine {
  /** a person's days and a stand-in's apart, oldest first */
  days: DaySummary[]
  /** from the person's own earlier days only, never a stand-in's */
  usual: PassiveUsual
  /** for a stand-in's days, from earlier stand-in days only */
  simUsual: PassiveUsual
  today: string
}

// ------------------------------------------------------------ drift

export interface Drift {
  key: 'headDown' | 'moveDegS' | 'walkPerHour' | 'nodsPerHour' | 'smilesPerHour'
  dir: 'up' | 'down'
  today: number
  usual: number | null
  /** judged against a stated default, not the person's own band */
  byDefault: boolean
  line: string
}
const pct = (x: number) => `${Math.round(x * 100)}%`
const NAMES: Record<Drift['key'], [string, (x: number) => string]> = {
  headDown: ['Head down', pct],
  moveDegS: ['Head movement while sitting', (x) => `${Math.round(x)} degrees a second`],
  walkPerHour: ['Walking', (x) => `${Math.round(x)} min an hour worn`],
  nodsPerHour: ['Nods', (x) => `${Math.round(x)} an hour`],
  smilesPerHour: ['Smiles', (x) => `${Math.round(x)} an hour`],
}

/** what today has that is outside the person's own band; before a band only the stated defaults are used */
export function driftOf(today: DaySummary | null, usual: PassiveUsual | null): Drift[] {
  if (!today || today.wornMin < USUAL_MIN_WORN) return []
  const out: Drift[] = []
  for (const key of Object.keys(NAMES) as Drift['key'][]) {
    const v = valueOf(today, key)
    if (v === null) continue
    const u = usual?.m[key]
    const [name, fmt] = NAMES[key]
    if (u && u.lo !== null && u.hi !== null) {
      const dir = v > u.hi ? 'up' : v < u.lo ? 'down' : null
      if (dir) out.push({ key, dir, today: v, usual: u.median, byDefault: false, line: `${name} ${fmt(v)} today; your usual is ${fmt(u.median)}.` })
      continue
    }
    if (key === 'headDown' && v > DEFAULTS.headDownDay)
      out.push({ key, dir: 'up', today: v, usual: u?.median ?? null, byDefault: true, line: `${name} ${fmt(v)} today, above the default of ${pct(DEFAULTS.headDownDay)} (too early for a band of your own).` })
    if (key === 'moveDegS' && v > DEFAULTS.restlessDegS)
      out.push({ key, dir: 'up', today: v, usual: u?.median ?? null, byDefault: true, line: `${name} ${fmt(v)} today, above the default of ${fmt(DEFAULTS.restlessDegS)} (too early for a band of your own).` })
  }
  return out
}

// ------------------------------------------------------------ when to offer a practice

export interface PassiveOffer {
  kind: SessionKind
  /** one sentence, with its numbers */
  why: string
  /** what is offered, for the button's line */
  line: string
  rule: 'headDown' | 'restless' | 'sitting'
  /** the threshold was a stated default, not the person's own band */
  byDefault: boolean
}

export const OFFER_LINES: Record<SessionKind, string> = {
  breathe: 'Two minutes of slow breathing, in your AirPods.',
  scan: 'A short body scan, in your AirPods.',
  walk: 'A short walk, with sound in your AirPods.',
}

export interface OfferCtx {
  now: number
  minuteMs: number
  /** today's closed minutes */
  bins: PassiveBin[]
  usual: PassiveUsual | null
  upright: Upright | null
  /** when the last offer was shown, epoch ms */
  lastOfferAt: number | null
  callMode: boolean
  practice: boolean
}

/** the minutes of the last n, each worn at least half the minute */
function lastMinutes(ctx: OfferCtx, n: number): { bins: PassiveBin[]; full: boolean } {
  const from = ctx.now - n * ctx.minuteMs
  const bins = ctx.bins.filter((b) => b.at >= from && b.at < ctx.now && b.wornS >= SLOTS / 2)
  return { bins, full: bins.length >= Math.ceil(n * 0.8) }
}

/**
 * When to offer which practice. None during a call, while a practice runs, or within 30 minutes of the last
 * offer. Then, first that applies:
 *  - head down for most of the last 10 minutes -> slow breathing
 *  - head movement while sitting well above the usual for the last 10 minutes -> body scan
 *  - AirPods in for the last 50 minutes and no walk in them -> a walk
 */
export function offerFor(ctx: OfferCtx): PassiveOffer | null {
  if (ctx.callMode || ctx.practice) return null
  if (ctx.lastOfferAt !== null && ctx.now - ctx.lastOfferAt < OFFER_GAP_MIN * ctx.minuteMs) return null
  const ten = lastMinutes(ctx, 10)
  const usual = ctx.usual
  if (ten.full) {
    const live = ten.bins.filter((b) => !b.practice.length)
    const hd = headDownOf(live, ctx.upright)
    if (hd.of >= SLOTS * 6) {
      const share = hd.down / hd.of
      const u = usual?.m.headDown
      const own = !!u && u.hi !== null
      const line = own ? Math.max(DEFAULTS.headDownOffer, u!.hi!) : DEFAULTS.headDownOffer
      if (share >= line) {
        const tail = own ? `your usual is ${pct(u!.median)}` : u ? `your usual so far is ${pct(u.median)}, too early for a band, so the default of ${pct(line)} is used` : `no usual yet, so the default of ${pct(line)} is used`
        return { kind: 'breathe', rule: 'headDown', byDefault: !own, line: OFFER_LINES.breathe, why: `Head down ${pct(share)} of the last 10 minutes; ${tail}.` }
      }
    }
    const walkS = live.reduce((a, b) => a + runLen(b.walk), 0)
    const wornS = live.reduce((a, b) => a + b.wornS, 0)
    const moves = live.filter((b) => b.moveDegS !== null).map((b) => b.moveDegS as number)
    if (moves.length >= 8 && wornS > 0 && walkS / wornS < 0.2) {
      const mv = median(moves)!
      const u = usual?.m.moveDegS
      const own = !!u && u.hi !== null
      const line = own ? Math.max(u!.hi!, u!.median * 1.5) : DEFAULTS.restlessDegS
      if (mv >= line) {
        const tail = own ? `your usual is ${Math.round(u!.median)}` : `no band of your own yet, so the default of ${line} is used`
        return { kind: 'scan', rule: 'restless', byDefault: !own, line: OFFER_LINES.scan, why: `Head moving ${Math.round(mv)} degrees a second while sitting over the last 10 minutes; ${tail}.` }
      }
    }
  }
  const fifty = lastMinutes(ctx, 50)
  if (fifty.full && fifty.bins.length >= 45) {
    const walked = walkBouts(fifty.bins).some((s) => s >= WALK_BOUT_S)
    const walkS = fifty.bins.reduce((a, b) => a + runLen(b.walk), 0)
    if (!walked && walkS < WALK_BOUT_S)
      return { kind: 'walk', rule: 'sitting', byDefault: false, line: OFFER_LINES.walk, why: `AirPods in for ${fifty.bins.length} of the last 50 minutes, and no walk in that time.` }
  }
  return null
}

// ------------------------------------------------------------ checking what a device sends

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const runsOk = (v: unknown): v is Run[] =>
  Array.isArray(v) && v.length <= SLOTS && v.every((r) => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[1] > r[0] && r[1] <= SLOTS)
const countOk = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 600)

/** null when it is not a minute bin */
export function checkPassiveBin(x: unknown): PassiveBin | null {
  const b = x as PassiveBin | null
  if (!b || typeof b !== 'object' || b.v !== 1) return null
  if (!num(b.at) || b.at < 1.5e12 || b.at > 4e12 || !num(b.ms) || b.ms < 500 || b.ms > 60_000) return null
  if (typeof b.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.day) || !PASSIVE_SHELLS.includes(b.shell)) return null
  if (!Number.isInteger(b.samples) || b.samples < 1 || b.samples > 20_000) return null
  if (!Array.isArray(b.pitch) || b.pitch.length !== SLOTS || !b.pitch.every((p) => p === null || (num(p) && p >= -180 && p <= 180))) return null
  if (!runsOk(b.walk) || !runsOk(b.call) || !runsOk(b.practice)) return null
  if (!(b.stepsPerMin === null || (num(b.stepsPerMin) && b.stepsPerMin > 0 && b.stepsPerMin < 300))) return null
  if (!(b.moveDegS === null || (num(b.moveDegS) && b.moveDegS >= 0 && b.moveDegS < 5000))) return null
  if (!countOk(b.nods) || !countOk(b.smiles)) return null
  if (!(b.hr === null || (num(b.hr) && b.hr > 25 && b.hr < 230)) || !Number.isInteger(b.hrN) || b.hrN < 0 || b.hrN > 10_000) return null
  const wornS = b.pitch.filter((p) => p !== null).length
  if (!wornS) return null
  return {
    v: 1, at: b.at, ms: b.ms, day: b.day, shell: b.shell, samples: b.samples, wornS,
    pitch: b.pitch.map((p) => (p === null ? null : Math.round(p))),
    walk: b.walk.map(([x, y]) => [x, y] as Run), stepsPerMin: b.stepsPerMin === null ? null : Math.round(b.stepsPerMin),
    call: b.call.map(([x, y]) => [x, y] as Run), practice: b.practice.map(([x, y]) => [x, y] as Run),
    moveDegS: b.moveDegS === null ? null : round1(b.moveDegS), nods: b.nods, smiles: b.smiles,
    hr: b.hr === null ? null : Math.round(b.hr), hrN: b.hrN,
  }
}
