import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { learn } from '../shared/earlearn'
import type { PracticeKind, PracticeRec } from '../shared/types'
import { buildRow, practiceLine } from './clinic'
import { generateCohort } from './cohort'
import { TZ_OFFSET_MS, analyze, dayIndex } from './engine'
import type { DayPoint } from './engine'
import { ESCALATE_DONE, SETTLED, bookingStore, driftRuns, nextSlots, outerOf, resolveBooking, sentenceOf, slotOk, workingOf } from './outerloop'

const DAY = 86_400_000
const now = Date.parse('2026-11-14T12:00:00Z') // a Saturday
const today = dayIndex(now)
const noon = (day: number) => new Date(day * DAY - TZ_OFFSET_MS + 12 * 3_600_000).toISOString()

/** daily drift values, the last one today */
function days(drifts: number[]): DayPoint[] {
  return drifts.map((drift, i) => ({ day: today - drifts.length + 1 + i, meanZ: drift, drift, strength: 50 + 15 * drift, pings: 1 }))
}
const pr = (daysAgo: number, kind: PracticeKind, settle: number | null, done = settle != null): PracticeRec => ({ at: noon(today - daysAgo), kind, why: 'drift', done, settle })

describe('what is working', () => {
  test('nothing, too early, then said with honest counts', () => {
    expect(workingOf([]).text).toBe('No practices yet')
    expect(workingOf([pr(1, 'breathe', null, false)]).text).toBe('No practices done yet')
    expect(workingOf([pr(1, 'breathe', 20), pr(2, 'breathe', 25)]).text).toBe('Too early: 2 sessions')
    const many = [
      ...[30, 25, 28, 4, 31, 27, 22, 26, 29, 8, 24, 30].map((s, i) => pr(i + 1, 'breathe', s)),
      ...[2, -4, 3].map((s, i) => pr(i + 20, 'scan', s)),
      ...[5, 0].map((s, i) => pr(i + 30, 'walk', s)),
    ]
    const w = workingOf(many)
    expect(w.said).toBe('learned')
    expect(w.best).toBe('breathe')
    expect(w.text).toBe('Breathing: 10 of 12 sessions settled')
    // the same answer as the phone's learner on the same sessions
    expect(w.best).toBe(learn(many.map((p) => ({ kind: p.kind, settle: p.settle, at: p.at }))).best)
  })

  test('a practice that never settled anyone is not called what works', () => {
    const w = workingOf([pr(1, 'scan', 3), pr(2, 'scan', 1), pr(3, 'walk', -5), pr(4, 'breathe', -8)])
    expect(w.settled).toBe(0)
    expect(w.text).toBe('Nothing has settled them yet: 4 sessions')
  })
})

describe('the outer loop', () => {
  test('drift runs ignore days without a ping and end on a day back inside the band', () => {
    expect(driftRuns(days([0, -1, -1.2, 0.1, -0.9]))).toEqual([
      { first: today - 3, last: today - 2 },
      { first: today, last: today },
    ])
  })

  test('steady, drifting, then escalated once the drift outlasts the practices', () => {
    expect(outerOf({ now, days: days([0.1, 0, 0.2]), practices: [], booking: null }).state).toBe('steady')
    const drifting = outerOf({ now, days: days([0, -0.9, -1.1, -1.3]), practices: [pr(1, 'breathe', 22), pr(0, 'scan', null, false)], booking: null })
    expect(drifting).toMatchObject({ state: 'drifting', driftDays: 3, inDrift: { offered: 2, done: 1, settled: 1 }, sentence: null })
    // five days below the band, three practices done: the rule is met on the day the third one was done
    const tried = [pr(5, 'breathe', 24), pr(4, 'scan', 2), pr(2, 'breathe', 18), pr(1, 'walk', null, false), pr(0, 'breathe', 6)]
    const esc = outerOf({ now, days: days([0.2, -0.8, -1.1, -1.4, -1.6, -1.7, -1.9]), practices: tried, booking: null })
    expect(esc.state).toBe('escalated')
    expect(esc.driftDays).toBe(6)
    expect(esc.escalatedAt).toBe(noon(today - 1)) // day 5 of the run; three done by then
    expect(esc.inDrift).toEqual({ offered: 5, done: 4, settled: 2 })
    expect(esc.note).toBe('6 days below usual in spite of 4 practices in those days')
    expect(esc.sentence).toBe('Your days have been below your usual for 6 days, in spite of 4 practices in those days. So far breathing has settled you 2 of 3 times and the body scan 0 of 1, and the days have not come back.')
    expect(ESCALATE_DONE).toBe(3)
  })

  test('drift without practices done is not escalated by this rule, and neither is a person who went quiet', () => {
    const offered = [5, 4, 3, 2, 1, 0].map((d) => pr(d, 'breathe', null, false))
    expect(outerOf({ now, days: days([0, -1, -1.2, -1.3, -1.4, -1.5, -1.6]), practices: offered, booking: null })).toMatchObject({ state: 'drifting', note: '6 days below usual; 0 of 6 practices done' })
    const quiet = days([0, -1, -1.2, -1.3, -1.4, -1.5, -1.6]).slice(0, 4) // nothing for the last three days
    const done = [6, 5, 4, 3].map((d) => pr(d, 'breathe', 20))
    expect(outerOf({ now, days: quiet, practices: done, booking: null })).toMatchObject({ state: 'drifting', note: 'Below usual when they went quiet, 3 days ago' })
  })

  test('a drift that came back while practices were done is answered', () => {
    const o = outerOf({ now, days: days([0, -0.9, -1.2, -1, -0.5, -0.2, 0, 0.1]), practices: [pr(6, 'walk', 25), pr(5, 'walk', 19)], booking: null })
    expect(o).toMatchObject({ state: 'answered', driftDays: 0, inDrift: { offered: 2, done: 2, settled: 2 }, note: 'Back inside usual 3 days ago, after 2 practices' })
  })

  test('a booking moves the person to booked; once the day has passed the line after it is followed', () => {
    const run = days([0, -0.9, -1.2, -1.4, -1.5, -1.6, -1.7])
    const done = [5, 4, 3, 2].map((d) => pr(d, 'breathe', 20))
    const booked = outerOf({ now, days: run, practices: done, booking: { at: noon(today + 3), bookedAt: noon(today), by: 'clinic' } })
    expect(booked.state).toBe('booked')
    expect(booked.sentence).toContain('below your usual for 6 days')
    const after = outerOf({
      now,
      days: days([0, -0.9, -1.2, -1.4, -1.5, -1.6, -1.7, -1.2, -0.8, -0.4, 0, 0.2]),
      practices: [9, 8, 7, 6].map((d) => pr(d, 'scan', 15)),
      booking: { at: noon(today - 5), bookedAt: noon(today - 8), by: 'simulated' },
    })
    expect(after).toMatchObject({ state: 'after', after: { days: 5, drift: 0.2, simulated: true }, note: 'Booster 5 days ago; inside their usual now', inDrift: { done: 4 } })
    expect(after.escalatedAt).not.toBeNull()
  })

  test('sentences stay plain', () => {
    const s = sentenceOf(9, [pr(3, 'breathe', 20), pr(2, 'walk', 1), pr(1, 'scan', null, false)])
    expect(s).toBe('Your days have been below your usual for 9 days, in spite of 2 practices in those days. So far breathing has settled you 1 of 1 time and the walk 0 of 1, and the days have not come back.')
    expect(sentenceOf(4, [pr(1, 'scan', 2)])).toBe('Your days have been below your usual for 4 days, in spite of 1 practice in those days. So far none of your practices has settled you, and the days have not come back.')
    expect(sentenceOf(4, [pr(1, 'scan', null, false)])).toBe('Your days have been below your usual for 4 days, and the practices were offered but not done.')
    expect(SETTLED).toBe(10)
  })
})

describe('booster slots and bookings', () => {
  test('next free weekday slots from tomorrow, Helsinki hours, skipping taken ones', () => {
    const slots = nextSlots(now, [], 4) // Saturday: the first slots are on Monday
    expect(slots).toEqual(['2026-11-16T07:00:00.000Z', '2026-11-16T09:00:00.000Z', '2026-11-16T12:00:00.000Z', '2026-11-17T07:00:00.000Z'])
    expect(nextSlots(now, ['2026-11-16T07:00:00.000Z'], 1)).toEqual(['2026-11-16T09:00:00.000Z'])
    expect(slotOk('2026-11-20T10:00:00Z', now)).toBe(true)
    expect(slotOk('2026-11-01T10:00:00Z', now)).toBe(false)
    expect(slotOk('2027-06-01T10:00:00Z', now)).toBe(false)
    expect(slotOk('soon', now)).toBe(false)
  })

  test('the store keeps a booking, a cancellation hides a simulated one', () => {
    const store = bookingStore(new Database(':memory:'))
    const seeded = { at: '2026-11-17T09:00:00.000Z', bookedAt: '2026-11-13T12:00:00.000Z', by: 'simulated' as const }
    expect(store.get('a')).toBeUndefined()
    expect(resolveBooking(store.get('a'), seeded)).toEqual(seeded)
    const b = store.set('a', '2026-11-16T07:00:00.000Z', now)
    expect(b).toEqual({ at: '2026-11-16T07:00:00.000Z', bookedAt: new Date(now).toISOString(), by: 'clinic' })
    expect(store.get('a')).toEqual(b)
    store.set('a', null, now)
    expect(store.get('a')).toBeNull()
    expect(resolveBooking(store.get('a'), seeded)).toBeNull()
    expect(store.all().get('a')).toBeNull()
  })
})

describe('the simulated cohort tells the outer loop story', () => {
  const people = generateCohort(now)
  const rows = people.map((p) => {
    const a = analyze(p.pings, p.course!.end)
    return { p, a, row: buildRow(p, a, { now, live: false, booster: false, booking: p.booster }).row }
  })
  const by = (state: string) => rows.filter((r) => r.row.outer?.state === state)

  test('most steady, some answered, a few escalated, one booked, one after a booster', () => {
    expect(rows.every((r) => r.p.synthetic && r.row.outer)).toBe(true)
    expect(by('steady').length).toBeGreaterThanOrEqual(12)
    expect(by('answered').length).toBeGreaterThanOrEqual(2)
    expect(by('escalated').map((r) => r.p.name)).toContain('Aino K.')
    expect(by('escalated').length).toBeLessThanOrEqual(3)
    expect(by('booked').map((r) => r.p.name)).toEqual(['Antti J.'])
    expect(by('after').map((r) => r.p.name)).toEqual(['Veikko S.'])
  })

  test('escalated people lead the list and carry a sentence; the booked and boosted ones are labelled simulated', () => {
    const top = [...rows].sort((x, y) => y.row.priority - x.row.priority)[0]!
    expect(top.row.outer!.state).toBe('escalated')
    for (const r of [...by('escalated'), ...by('booked')]) {
      expect(r.row.outer!.sentence).toMatch(/^Your days have been below your usual for \d+ days/)
      expect(r.row.outer!.inDrift.done).toBeGreaterThanOrEqual(ESCALATE_DONE)
      expect(r.row.outer!.escalatedAt).not.toBeNull()
    }
    const booked = by('booked')[0]!.row
    expect(booked.boosterRequested).toBe(true)
    expect(booked.outer!.booster!.by).toBe('simulated')
    expect(Date.parse(booked.outer!.booster!.at)).toBeGreaterThan(now)
    const after = by('after')[0]!
    expect(after.row.outer!.after).toMatchObject({ simulated: true, days: 15 })
    expect(after.row.outer!.after!.drift).toBeGreaterThan(-0.75) // back inside the band after the booster
    expect(after.row.outer!.escalatedAt! < after.row.outer!.booster!.at).toBe(true) // escalated before it was booked
    const lowBefore = after.a.days.filter((d) => d.day < dayIndex(after.row.outer!.booster!.at) && d.day >= dayIndex(after.row.outer!.booster!.at) - 7)
    expect(Math.min(...lowBefore.map((d) => d.drift))).toBeLessThan(-1.5)
  })

  test('the list and the phone say the same thing about what works', () => {
    for (const { p, row } of rows) {
      const done = p.practices.filter((x) => x.done && x.settle != null)
      expect(row.outer!.working.best).toBe(done.length ? learn(done.map((x) => ({ kind: x.kind, settle: x.settle, at: x.at }))).best : null)
      for (const text of [row.outer!.working.text, row.outer!.note, row.outer!.sentence ?? '', practiceLine(row.outer!, p.practices.length)]) {
        expect(text).not.toMatch(/—|brain|depress|relaps|diagnos/i)
      }
    }
  })

  test('one person never shows two different counts for the same thing', () => {
    // a judge found 10, 12 and 14 practices and "5 of 6" next to "5 of 7" on one patient: every count now says what it covers,
    // and the fraction per practice is one number on the list, in the nurse's sentence, in the summary and in the table
    const sentenceWord: Record<string, string> = { breathe: 'breathing', scan: 'the body scan', walk: 'the walk' }
    let checked = 0
    for (const { p, row } of rows) {
      const o = row.outer!
      const done = p.practices.filter((x) => x.done)
      const scored = done.filter((x) => x.settle != null)
      expect(o.working.total).toBe(done.length) // the summary's "were done" and the table's Done column
      const line = practiceLine(o, p.practices.length)
      expect(line).toContain(`offered ${p.practices.length} practice`)
      if (o.working.best && o.working.said !== 'early' && o.working.settled > 0) {
        const ofBest = scored.filter((x) => x.kind === o.working.best)
        expect(o.working.text).toContain(`${ofBest.filter((x) => (x.settle ?? 0) >= SETTLED).length} of ${ofBest.length}`)
        expect(line).toContain(`${o.working.settled} of ${o.working.n} sessions`)
      }
      if (!o.sentence || !done.length) continue
      checked++
      expect(o.sentence).toContain(`in spite of ${o.inDrift.done} practice`)
      if (o.state === 'escalated') expect(o.note).toContain(`in spite of ${o.inDrift.done} practice`)
      if (o.inDrift.done < done.length) expect(line).toContain(`${o.inDrift.done} of them in the ${o.driftDays} day`)
      for (const k of ['breathe', 'scan', 'walk'] as const) {
        const xs = scored.filter((x) => x.kind === k)
        if (!xs.length || !xs.some((x) => (x.settle ?? 0) >= SETTLED) && !scored.some((x) => (x.settle ?? 0) >= SETTLED)) continue
        expect(o.sentence).toMatch(new RegExp(`${sentenceWord[k]}(?: has settled you)? ${xs.filter((x) => (x.settle ?? 0) >= SETTLED).length} of ${xs.length}\\b`))
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('practices are history: the clock moving on only adds new ones', () => {
    const later = generateCohort(now + 5 * 3_600_000)
    for (const [i, p] of people.entries()) {
      const keep = new Set(later[i]!.practices.map((x) => JSON.stringify(x)))
      expect(p.practices.every((x) => keep.has(JSON.stringify(x)))).toBe(true)
    }
  })
})
