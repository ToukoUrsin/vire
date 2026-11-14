import { describe, expect, test } from 'bun:test'
import type { DaySummary } from '../../../shared/earpassive'
import { daysNow, mergeDays } from '../../src/tune/passive/days'
import { duration, usualLine } from '../../src/tune/passive/words'
import { T0, bin } from './synth'

const sum = (day: string, wornMin: number, sim = false): DaySummary => ({
  day, sim, wornMin, walks: 0, walkMin: 0, stepsPerMin: null, callMin: 0, upright: null, headDown: 0.4, moveDegS: 3, nodsPerHour: null, smilesPerHour: null, heart: null, from: 0, to: 0,
})

describe('days on the device and on the server', () => {
  test('one per day and kind, the fuller one', () => {
    const got = mergeDays([sum('2026-11-08', 50)], [sum('2026-11-08', 90), sum('2026-11-07', 40), sum('2026-11-07', 40, true)])
    expect(got.map((d) => [d.day, d.wornMin, d.sim])).toEqual([['2026-11-07', 40, false], ['2026-11-07', 40, true], ['2026-11-08', 90, false]])
  })
  test('a stand-in\'s minutes never make a person\'s today or usual', () => {
    const bins = [bin(T0), bin(T0 + 60_000, {}, 'sim')]
    const real = daysNow(bins, [sum('2026-11-01', 90, true)], '2026-11-10', false)
    expect(real.today?.wornMin).toBe(1)
    expect(real.today?.sim).toBe(false)
    expect(real.usual.days).toBe(0)
    const sim = daysNow(bins, [sum('2026-11-01', 90, true)], '2026-11-10', true)
    expect(sim.today?.sim).toBe(true)
    expect(sim.usual.days).toBe(1)
  })
})

describe('the card\'s words', () => {
  test('durations', () => {
    expect(duration(41)).toBe('41 min')
    expect(duration(180)).toBe('3 h')
    expect(duration(192)).toBe('3 h 12 min')
  })
  test('where the usual comes from, and only today said plainly', () => {
    expect(usualLine({ usual: null, daysKept: 0, earlier: 0, today: null })).toBe('Only today so far. Your usual starts from your next day with the AirPods.')
    const u = (band: boolean) => ({ days: 1, band, note: band ? null : 'too early for a band', sim: false, m: {} })
    expect(usualLine({ usual: u(false), daysKept: 1, earlier: 1, today: null })).toBe('Your usual comes from 1 earlier day. Too early for a band.')
    expect(usualLine({ usual: u(true), daysKept: 4, earlier: 5, today: null })).toBe('Your usual comes from 4 earlier days. Days under 30 minutes are left out (1).')
  })
})
