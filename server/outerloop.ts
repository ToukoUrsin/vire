// The outer loop, for the clinic. The inner loop runs on the phone every day: drift against the person's own usual
// is read, a short practice in the AirPods answers it, and a learner per person finds which practice settles them
// (shared/earlearn.ts). Drift that the practices do not answer goes to the clinic's list with what was tried and
// what worked, and the clinic can book a booster session when it decides to. Pure functions, plus a small store.
import type { Database } from 'bun:sqlite'
import { learn } from '../shared/earlearn'
import type { BoosterBooking, OuterRow, PracticeKind, PracticeRec } from '../shared/types'
import { DIP, TZ_OFFSET_MS, dayIndex } from './engine'
import type { DayPoint } from './engine'

/** a practice "settled" the person when the head sat at least this much stiller after it than before (percent) */
export const SETTLED = 10
/** escalate after this many calendar days below the usual band ... */
export const ESCALATE_DAYS = 5
/** ... with at least this many practices done in that time */
export const ESCALATE_DONE = 3
/** an answered drift is shown for this long after it ended */
const ANSWERED_WINDOW = 28
/** the line after a booster is followed for this long */
const AFTER_WINDOW = 90

export const PRACTICE_LABEL: Record<PracticeKind, string> = { breathe: 'Breathing', scan: 'Body scan', walk: 'Walk' }
const PRACTICE_WORD: Record<PracticeKind, string> = { breathe: 'breathing', scan: 'the body scan', walk: 'the walk' }
const KINDS: PracticeKind[] = ['breathe', 'scan', 'walk']

const DAY = 86_400_000
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const isSettled = (p: PracticeRec) => p.done && p.settle != null && p.settle >= SETTLED
/** noon (Helsinki) of a day index, ISO */
const noonOf = (day: number) => new Date(day * DAY - TZ_OFFSET_MS + 12 * 3_600_000).toISOString()

/** the practices a person carries (simulated people have them; real people's sessions are not linked to the clinic yet) */
export function practicesOf(p: object): PracticeRec[] {
  const x = (p as { practices?: PracticeRec[] }).practices
  return Array.isArray(x) ? x : []
}
/** a booking that is part of a simulated person's story */
export function seededBooking(p: object): BoosterBooking | null {
  return (p as { booster?: BoosterBooking | null }).booster ?? null
}
/** what the clinic stored wins over the simulated story: undefined = nothing stored, null = cancelled */
export function resolveBooking(stored: BoosterBooking | null | undefined, seeded: BoosterBooking | null): BoosterBooking | null {
  return stored === undefined ? seeded : stored
}

/** What helps this person most, from the phone's own learner, said with honest counts. */
export function workingOf(practices: PracticeRec[]): OuterRow['working'] {
  const done = practices.filter((p) => p.done && p.settle != null)
  if (!done.length) return { said: 'none', best: null, settled: 0, n: 0, total: 0, text: practices.length ? 'No practices done yet' : 'No practices yet' }
  const l = learn(done.map((p) => ({ kind: p.kind, settle: p.settle, at: p.at })), KINDS)
  const best = l.best
  const ofBest = best ? done.filter((p) => p.kind === best) : []
  const settled = ofBest.filter(isSettled).length
  const n = ofBest.length
  const total = done.length
  const text =
    settled === 0 && l.said !== 'early'
      ? `Nothing has settled them yet: ${plural(total, 'session')}`
      : l.said === 'learned' && best
      ? `${PRACTICE_LABEL[best]}: ${settled} of ${n} sessions settled`
      : l.said === 'leaning' && best
        ? `Leaning to ${PRACTICE_WORD[best]}: ${settled} of ${n} settled`
        : `Too early: ${plural(total, 'session')}`
  return { said: l.said, best, settled, n, total, text }
}

interface Run {
  /** day indexes of the first and last day below the band */
  first: number
  last: number
}
/** stretches of days below the usual band; days without a ping do not break a stretch */
export function driftRuns(days: DayPoint[]): Run[] {
  const out: Run[] = []
  let cur: Run | null = null
  for (const d of days) {
    if (d.drift <= DIP) {
      if (cur) cur.last = d.day
      else cur = { first: d.day, last: d.day }
    } else if (cur) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out
}

const within = (p: PracticeRec, first: number, last: number) => {
  const d = dayIndex(p.at)
  return d >= first && d <= last
}
function tally(practices: PracticeRec[]) {
  return { offered: practices.length, done: practices.filter((p) => p.done).length, settled: practices.filter(isSettled).length }
}
/** the first day the rule was met in a run: ESCALATE_DAYS below the band with ESCALATE_DONE practices done */
function escalationDay(run: Run, practices: PracticeRec[], until: number): number | null {
  for (let d = run.first + ESCALATE_DAYS - 1; d <= until; d++) {
    if (practices.filter((p) => p.done && within(p, run.first, d)).length >= ESCALATE_DONE) return d
  }
  return null
}

/**
 * What we tried, what worked and what did not, as the nurse can say it to the person on the phone.
 * Two counts, each said with what it covers: the practices done in the days below usual, and how often each kind
 * has settled the person over every scored practice so far. The second is the same count as the list's
 * "what's working" and the patient page's table, so one person never shows two different fractions.
 */
export function sentenceOf(driftDays: number, inDrift: PracticeRec[], all: PracticeRec[] = inDrift): string {
  const doneIn = inDrift.filter((p) => p.done)
  const scored = all.filter((p) => p.done && p.settle != null)
  const parts = KINDS.map((k) => {
    const xs = scored.filter((p) => p.kind === k)
    return xs.length ? { k, n: xs.length, s: xs.filter(isSettled).length } : null
  })
    .filter((x): x is { k: PracticeKind; n: number; s: number } => x != null)
    .sort((a, b) => b.s / b.n - a.s / a.n || b.n - a.n)
  const anySettled = parts.some((p) => p.s > 0)
  const said = parts.map((p, i) => (i === 0 ? `${PRACTICE_WORD[p.k]} has settled you ${p.s} of ${p.n} ${p.n === 1 ? 'time' : 'times'}` : `${PRACTICE_WORD[p.k]} ${p.s} of ${p.n}`))
  const list = said.length <= 1 ? said.join('') : `${said.slice(0, -1).join(', ')} and ${said.at(-1)}`
  const head = `Your days have been below your usual for ${plural(driftDays, 'day')}`
  if (!doneIn.length) return `${head}, and the practices were offered but not done.`
  const tried = `${head}, in spite of ${plural(doneIn.length, 'practice')} in those days`
  if (!anySettled) return `${tried}. So far none of your practices has settled you, and the days have not come back.`
  return `${tried}. So far ${list}, and the days have not come back.`
}

export interface OuterInput {
  now: number
  days: DayPoint[]
  practices: PracticeRec[]
  booking: BoosterBooking | null
}

export function outerOf({ now, days, practices, booking }: OuterInput): OuterRow {
  const today = dayIndex(now)
  const working = workingOf(practices)
  const runs = driftRuns(days)
  const lastDay = days.at(-1)
  const current = lastDay && lastDay.drift <= DIP ? runs.at(-1)! : null
  const driftDays = current ? today - current.first + 1 : 0
  const base = { driftDays, working, sentence: null, escalatedAt: null, booster: booking, after: null } as const

  // a booster that has happened: follow the line after it
  if (booking && Date.parse(booking.at) <= now && today - dayIndex(booking.at) <= AFTER_WINDOW) {
    const bDay = dayIndex(booking.at)
    const before = [...runs].reverse().find((r) => r.first < bDay) ?? null
    const runEnd = before ? Math.min(before.last, bDay - 1) : null
    const inRun = before && runEnd != null ? practices.filter((p) => within(p, before.first, runEnd)) : []
    const esc = before && runEnd != null ? escalationDay(before, practices, runEnd) : null
    const since = today - bDay
    const drift = lastDay ? lastDay.drift : 0
    const inside = drift > DIP
    return {
      ...base,
      state: 'after',
      inDrift: tally(inRun),
      escalatedAt: esc == null ? null : noonOf(esc),
      after: { days: since, drift, simulated: booking.by === 'simulated' },
      note: `Booster ${since === 0 ? 'today' : since === 1 ? 'yesterday' : `${since} days ago`}; ${inside ? 'inside their usual now' : 'still below their usual'}`,
    }
  }

  if (current) {
    const inRun = practices.filter((p) => within(p, current.first, today))
    const t = tally(inRun)
    // a person who went quiet is not escalated on old days: silence is the list's own signal
    const silent = today - lastDay!.day
    const esc = silent <= 2 ? escalationDay(current, practices, today) : null
    if (booking) {
      return { ...base, state: 'booked', inDrift: t, escalatedAt: esc == null ? null : noonOf(esc), sentence: sentenceOf(driftDays, inRun, practices), note: `Booster booked; ${plural(driftDays, 'day')} below usual` }
    }
    if (esc != null) {
      return { ...base, state: 'escalated', inDrift: t, escalatedAt: noonOf(esc), sentence: sentenceOf(driftDays, inRun, practices), note: `${plural(driftDays, 'day')} below usual in spite of ${plural(t.done, 'practice')} in those days` }
    }
    return {
      ...base,
      state: 'drifting',
      inDrift: t,
      note:
        silent > 2
          ? `Below usual when they went quiet, ${plural(silent, 'day')} ago`
          : t.offered
            ? // "0 of 3 practices done" next to "6 were done" on the person's page read as two counts of one thing: this one says its days
              `${plural(driftDays, 'day')} below usual; in those days ${t.done} of ${plural(t.offered, 'practice')} done`
            : `${plural(driftDays, 'day')} below usual`,
    }
  }

  if (booking) return { ...base, state: 'booked', inDrift: tally([]), note: 'Booster booked' }

  // a drift that ended recently, with practices done in it
  const ended = runs.at(-1)
  if (ended && today - ended.last <= ANSWERED_WINDOW) {
    const inRun = practices.filter((p) => within(p, ended.first, ended.last))
    const t = tally(inRun)
    if (t.done > 0) {
      const back = days.find((d) => d.day > ended.last)?.day ?? ended.last + 1
      const ago = today - back
      return { ...base, state: 'answered', inDrift: t, note: `Back inside usual ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`}, after ${plural(t.done, 'practice')}` }
    }
  }
  return { ...base, state: 'steady', inDrift: tally([]), note: '' }
}

// ---------- booster slots ----------

/** the clinic's booster slots: weekdays at these Helsinki hours */
export const SLOT_HOURS = [9, 11, 14]
const MAX_AHEAD_DAYS = 60
const slotAt = (day: number, hour: number) => day * DAY - TZ_OFFSET_MS + hour * 3_600_000
const weekday = (day: number) => (day + 4) % 7 // day 0 (1 Jan 1970) was a Thursday; 0 = Sunday

/** the next free slots from tomorrow on, soonest first */
export function nextSlots(now: number, taken: string[], n = 3): string[] {
  const busy = new Set(taken.map((t) => Date.parse(t)))
  const out: string[] = []
  for (let day = dayIndex(now) + 1; out.length < n && day <= dayIndex(now) + MAX_AHEAD_DAYS; day++) {
    if (weekday(day) === 0 || weekday(day) === 6) continue
    for (const h of SLOT_HOURS) {
      const t = slotAt(day, h)
      if (!busy.has(t) && out.length < n) out.push(new Date(t).toISOString())
    }
  }
  return out
}
/** a time the clinic may book: in the future and within 60 days */
export function slotOk(at: unknown, now: number): at is string {
  if (typeof at !== 'string') return false
  const t = Date.parse(at)
  return Number.isFinite(t) && t > now && t <= now + MAX_AHEAD_DAYS * DAY
}

/** Bookings the clinic made on this screen. A row with a null slot is a cancelled booking (it hides a simulated one). */
export function bookingStore(db: Database) {
  db.exec('CREATE TABLE IF NOT EXISTS booster_bookings (patient_id TEXT PRIMARY KEY, slot TEXT, booked_at TEXT NOT NULL)')
  type R = { patient_id: string; slot: string | null; booked_at: string }
  const toBooking = (r: R): BoosterBooking | null => (r.slot ? { at: r.slot, bookedAt: r.booked_at, by: 'clinic' } : null)
  return {
    get(id: string): BoosterBooking | null | undefined {
      const r = db.query('SELECT * FROM booster_bookings WHERE patient_id = ?').get(id) as R | null
      return r ? toBooking(r) : undefined
    },
    set(id: string, slot: string | null, now = Date.now()): BoosterBooking | null {
      const at = new Date(now).toISOString()
      db.query('INSERT INTO booster_bookings (patient_id, slot, booked_at) VALUES (?, ?, ?) ON CONFLICT (patient_id) DO UPDATE SET slot = excluded.slot, booked_at = excluded.booked_at').run(id, slot, at)
      return slot ? { at: slot, bookedAt: at, by: 'clinic' } : null
    },
    all(): Map<string, BoosterBooking | null> {
      const rows = db.query('SELECT * FROM booster_bookings').all() as R[]
      return new Map(rows.map((r) => [r.patient_id, toBooking(r)]))
    },
    /** Forget what was booked or cancelled on this screen longer ago than `olderThanMs`, for the people `only` picks. Returns their ids. */
    lapse(olderThanMs: number, only: (id: string) => boolean, now = Date.now()): string[] {
      const rows = db.query('SELECT * FROM booster_bookings').all() as R[]
      const gone = rows.filter((r) => now - Date.parse(r.booked_at) > olderThanMs && only(r.patient_id)).map((r) => r.patient_id)
      for (const id of gone) db.query('DELETE FROM booster_bookings WHERE patient_id = ?').run(id)
      return gone
    },
  }
}
