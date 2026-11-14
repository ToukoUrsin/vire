import { describe, expect, test } from 'bun:test'
import { walkRead, walkWindows } from '../../../shared/earwalk'
import {
  DEFAULTS, OFFER_GAP_MIN, checkPassiveBin, createPassiveTracker, driftOf, keepBetter, offerFor, summarizeDay, summarizeDays, uprightOf, usualOf, walkBouts,
} from '../../../shared/earpassive'
import type { DaySummary, OfferCtx, PassiveBin } from '../../../shared/earpassive'
import { T0, bin, rows } from './synth'

const MIN = 60_000
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10)
function track(stretches: Parameters<typeof rows>[1], opts: { call?: boolean; counting?: boolean } = {}) {
  const tr = createPassiveTracker({ shell: 'ios', dayOf: utcDay })
  if (opts.counting) tr.counting({ nod: true, smile: false })
  tr.call(!!opts.call)
  const rs = rows(T0, stretches)
  for (const r of rs) tr.head(r)
  return { tr, rs, bins: tr.tick(rs[rs.length - 1][0] + 2 * MIN) }
}

describe('walking from the AirPods', () => {
  test('a step beat is walking, a still head is not', () => {
    const walk = rows(T0, [{ s: 30, walk: true }])
    const still = rows(T0, [{ s: 30 }])
    expect(walkRead(walk, T0, T0 + 30_000).walkedS).toBeGreaterThan(20)
    expect(walkRead(walk, T0, T0 + 30_000).stepsPerMin).toBe(108)
    expect(walkRead(still, T0, T0 + 30_000).walkedS).toBe(0)
    expect(walkWindows(walk, T0, T0 + 30_000).every((w) => w.walked)).toBe(true)
  })
  test('rows out of order read the same', () => {
    const walk = rows(T0, [{ s: 20, walk: true }])
    expect(walkRead(walk.slice().reverse(), T0, T0 + 20_000)).toEqual(walkRead(walk, T0, T0 + 20_000))
  })
})

describe('the minute tracker', () => {
  test('one bin a minute, worn seconds, walking and head pitch', () => {
    const { bins } = track([{ s: 60, pitch: -5 }, { s: 60, walk: true, pitch: 2 }, { s: 30, pitch: -35 }])
    expect(bins.map((b) => b.at)).toEqual([T0, T0 + MIN, T0 + 2 * MIN])
    expect(bins[0].wornS).toBe(60)
    expect(bins[0].walk).toEqual([])
    expect(bins[1].walk.reduce((a, [x, y]) => a + y - x, 0)).toBeGreaterThan(50)
    expect(bins[1].stepsPerMin).toBe(108)
    expect(bins[2].wornS).toBe(30)
    expect(bins[2].pitch.slice(0, 30).every((p) => p !== null && p < -30)).toBe(true)
    expect(bins[2].pitch.slice(31).every((p) => p === null)).toBe(true)
    expect(bins.every((b) => b.day === '2026-11-10' && b.shell === 'ios' && b.nods === null && b.smiles === null)).toBe(true)
  })

  test('a minute is not closed early, and a gap of hours jumps ahead', () => {
    const tr = createPassiveTracker({ shell: 'mac', dayOf: utcDay })
    for (const r of rows(T0, [{ s: 50 }])) tr.head(r)
    expect(tr.tick(T0 + 55_000)).toEqual([])
    expect(tr.snapshot()?.wornS).toBe(50)
    for (const r of rows(T0 + 3 * 3600_000, [{ s: 10 }])) tr.head(r)
    const got = tr.tick(T0 + 3 * 3600_000 + MIN)
    expect(got.map((b) => b.at)).toEqual([T0, T0 + 3 * 3600_000])
  })

  test('call mode, practice, heart and events land in the minute', () => {
    const tr = createPassiveTracker({ shell: 'ios', dayOf: utcDay })
    tr.counting({ nod: true, smile: false })
    const rs = rows(T0, [{ s: 60, hz: 6 }])
    tr.call(true)
    for (const r of rs.slice(0, rs.length / 2)) tr.head(r)
    tr.call(false)
    tr.practice(true)
    for (const r of rs.slice(rs.length / 2)) tr.head(r)
    tr.heart(T0 + 40_000, 70)
    tr.heart(T0 + 50_000, 74)
    tr.event('nod', T0 + 10_000)
    tr.event('nod', T0 + 20_000)
    tr.event('smile', T0 + 20_000)
    const [b] = tr.tick(T0 + MIN)
    expect(b.call).toEqual([[0, 30]])
    expect(b.practice).toEqual([[30, 60]])
    expect(b.hr).toBe(72)
    expect(b.hrN).toBe(2)
    expect(b.nods).toBe(2)
    expect(b.smiles).toBeNull()
  })

  test('a restless head moves more than a still one', () => {
    const still = track([{ s: 60 }]).bins[0]
    const restless = track([{ s: 60, sway: 8 }]).bins[0]
    expect(still.moveDegS!).toBeLessThan(3)
    expect(restless.moveDegS!).toBeGreaterThan(DEFAULTS.restlessDegS)
  })

  test('live: worn, walking and the samples a second', () => {
    const { tr, rs } = (() => {
      const tr = createPassiveTracker({ shell: 'ios' })
      const rs = rows(T0, [{ s: 10, walk: true }])
      for (const r of rs) tr.head(r)
      return { tr, rs }
    })()
    const now = rs[rs.length - 1][0]
    const l = tr.live(now)
    expect(l.worn).toBe(true)
    expect(l.walking).toBe(true)
    expect(l.hz).toBeGreaterThan(45)
    expect(tr.live(now + 10_000).worn).toBe(false)
  })
})

describe('the day', () => {
  test('upright from walking when there was walking, else from the day', () => {
    const { bins } = track([{ s: 120, walk: true, pitch: 5 }, { s: 120, pitch: -30 }])
    const u = uprightOf(bins)!
    expect(u.from).toBe('walking')
    expect(Math.abs(u.pitch - 5)).toBeLessThan(3)
    const still = track([{ s: 120, pitch: -8 }]).bins
    expect(uprightOf(still)).toEqual({ pitch: -8, from: 'day' })
  })

  test('walks are bouts of a minute or more, also across the minute edge', () => {
    const a = bin(T0, { walk: [[30, 60]] })
    const b = bin(T0 + MIN, { walk: [[0, 40]] })
    const c = bin(T0 + 5 * MIN, { walk: [[0, 20]] })
    expect(walkBouts([a, b, c])).toEqual([70, 20])
    expect(summarizeDay([a, b, c])!.walks).toBe(1)
  })

  test('summary: worn, calls, head down against the upright, nods an hour', () => {
    const bins: PassiveBin[] = []
    for (let i = 0; i < 60; i++) bins.push(bin(T0 + i * MIN, { down: i < 30 ? 60 : 0, call: i < 10 ? [[0, 60]] : [], nods: 1 }))
    bins.push(bin(T0 + 60 * MIN, { walkS: 60, pitchAll: 0 }))
    const d = summarizeDay(bins)!
    expect(d.wornMin).toBe(61)
    expect(d.callMin).toBe(10)
    expect(d.upright?.from).toBe('walking')
    expect(d.headDown).toBeCloseTo(30 / 61, 2)
    expect(d.nodsPerHour).toBeCloseTo((61 / 61) * 60, 0)
    expect(d.smilesPerHour).toBeNull()
    expect(d.walks).toBe(1)
    expect(d.sim).toBe(false)
  })

  test('a stand-in day is kept apart from a person\'s day', () => {
    const days = summarizeDays([bin(T0), bin(T0, {}, 'sim')])
    expect(days.map((d) => d.sim)).toEqual([false, true])
  })
})

const day = (d: string, headDown: number, extra: Partial<DaySummary> = {}): DaySummary => ({
  day: d, sim: false, wornMin: 120, walks: 2, walkMin: 12, stepsPerMin: 105, callMin: 20, upright: { pitch: 0, from: 'walking' }, headDown,
  moveDegS: 4, nodsPerHour: null, smilesPerHour: null, heart: null, from: 0, to: 0, ...extra,
})

describe('the usual', () => {
  test('one earlier day: a median and no band, and it says so', () => {
    const u = usualOf([day('2026-11-09', 0.4), day('2026-11-10', 0.7)], '2026-11-10')
    expect(u.days).toBe(1)
    expect(u.band).toBe(false)
    expect(u.note).toBe('too early for a band')
    expect(u.m.headDown).toEqual({ median: 0.4, lo: null, hi: null, days: 1 })
  })
  test('a band from three days on, never narrower than its floor', () => {
    const u = usualOf([day('2026-11-06', 0.38), day('2026-11-07', 0.38), day('2026-11-08', 0.38), day('2026-11-10', 0.9)], '2026-11-10')
    expect(u.band).toBe(true)
    expect(u.note).toBeNull()
    expect(u.m.headDown!.lo).toBeCloseTo(0.3, 5)
    expect(u.m.headDown!.hi).toBeCloseTo(0.46, 5)
  })
  test('stand-in days never enter a person\'s usual, and short days do not count', () => {
    const u = usualOf([day('2026-11-06', 0.9, { sim: true }), day('2026-11-07', 0.9, { wornMin: 10 }), day('2026-11-08', 0.3)], '2026-11-10')
    expect(u.days).toBe(1)
    expect(u.m.headDown!.median).toBe(0.3)
  })
})

describe('drift', () => {
  const usual = usualOf([day('2026-11-06', 0.38), day('2026-11-07', 0.36), day('2026-11-08', 0.4)], '2026-11-10')
  test('outside the band is a drift, with its numbers', () => {
    const d = driftOf(day('2026-11-10', 0.71), usual)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ key: 'headDown', dir: 'up', byDefault: false })
    expect(d[0].line).toBe('Head down 71% today; your usual is 38%.')
  })
  test('inside the band is none; too little worn today is none', () => {
    expect(driftOf(day('2026-11-10', 0.4), usual)).toEqual([])
    expect(driftOf(day('2026-11-10', 0.9, { wornMin: 10 }), usual)).toEqual([])
  })
  test('before a band, only the stated defaults, flagged as defaults', () => {
    const d = driftOf(day('2026-11-10', 0.6), usualOf([], '2026-11-10'))
    expect(d).toHaveLength(1)
    expect(d[0].byDefault).toBe(true)
    expect(d[0].line).toContain('default')
  })
})

describe('when to offer a practice', () => {
  const ctx = (bins: PassiveBin[], o: Partial<OfferCtx> = {}): OfferCtx => ({
    now: bins[bins.length - 1].at + MIN, minuteMs: MIN, bins, usual: null, upright: { pitch: 0, from: 'walking' }, lastOfferAt: null, callMode: false, practice: false, ...o,
  })
  const tenDown = Array.from({ length: 10 }, (_, i) => bin(T0 + i * MIN, { down: 45 }))
  const usual = usualOf([day('2026-11-06', 0.38), day('2026-11-07', 0.36), day('2026-11-08', 0.4)], '2026-11-10')

  test('head down most of 10 minutes: breathing, said against the usual', () => {
    const o = offerFor(ctx(tenDown, { usual }))!
    expect(o.kind).toBe('breathe')
    expect(o.byDefault).toBe(false)
    expect(o.why).toBe('Head down 75% of the last 10 minutes; your usual is 38%.')
  })
  test('with no usual the default is used and said', () => {
    const o = offerFor(ctx(tenDown))!
    expect(o.byDefault).toBe(true)
    expect(o.why).toBe('Head down 75% of the last 10 minutes; no usual yet, so the default of 60% is used.')
  })
  test('none during a call, during a practice, or within 30 minutes of the last one', () => {
    expect(offerFor(ctx(tenDown, { callMode: true }))).toBeNull()
    expect(offerFor(ctx(tenDown, { practice: true }))).toBeNull()
    const c = ctx(tenDown)
    expect(offerFor({ ...c, lastOfferAt: c.now - (OFFER_GAP_MIN - 1) * MIN })).toBeNull()
    expect(offerFor({ ...c, lastOfferAt: c.now - OFFER_GAP_MIN * MIN })).not.toBeNull()
  })
  test('too few minutes worn: no offer', () => {
    expect(offerFor(ctx(tenDown.slice(0, 5)))).toBeNull()
  })
  test('restless while sitting: body scan', () => {
    const bins = Array.from({ length: 10 }, (_, i) => bin(T0 + i * MIN, { moveDegS: 14 }))
    const o = offerFor(ctx(bins))!
    expect(o.kind).toBe('scan')
    expect(o.why).toContain('14 degrees a second')
    // against a usual of 4 with a band, 14 is well above
    expect(offerFor(ctx(bins, { usual }))!.byDefault).toBe(false)
  })
  test('50 minutes in and no walk: a walk; a walk in them: none', () => {
    const sitting = Array.from({ length: 50 }, (_, i) => bin(T0 + i * MIN))
    expect(offerFor(ctx(sitting))!.kind).toBe('walk')
    expect(offerFor(ctx(sitting))!.why).toBe('AirPods in for 50 of the last 50 minutes, and no walk in that time.')
    const walked = sitting.map((b, i) => (i === 20 ? bin(b.at, { walkS: 60 }) : b))
    expect(offerFor(ctx(walked))).toBeNull()
  })
})

describe('what a device sends', () => {
  test('a good bin passes, a bad one does not', () => {
    const b = bin(T0)
    expect(checkPassiveBin(b)).toEqual(b)
    expect(checkPassiveBin({ ...b, pitch: [1, 2] })).toBeNull()
    expect(checkPassiveBin({ ...b, shell: 'pc' })).toBeNull()
    expect(checkPassiveBin({ ...b, walk: [[5, 2]] })).toBeNull()
    expect(checkPassiveBin({ ...b, pitch: new Array(60).fill(null) })).toBeNull()
  })
  test('the bigger copy of a minute is kept, the same twice changes nothing', () => {
    const a = bin(T0, { samples: 100 })
    const b = bin(T0, { samples: 3000 })
    expect(keepBetter(a, b)).toBe(b)
    expect(keepBetter(b, a)).toBe(b)
    expect(keepBetter(b, { ...b })).toBe(b)
  })
})
