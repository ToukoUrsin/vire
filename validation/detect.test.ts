import { describe, expect, test } from 'bun:test'
import { CHANNELS, PRIORS, analyze, mulberry32 } from '../server/engine'
import {
  DELTAS,
  HOME_DAYS,
  NOISE_SD_IN_SPREADS,
  RELAPSE_RAMP_DAYS,
  slideAt,
  simulatePerson,
  summariseFlags,
  wobbleStep,
} from './detect'

describe('detect simulation pieces', () => {
  test('relapse slide is zero, then ramps down, then stays', () => {
    expect(slideAt(9, 10, 1)).toBe(0)
    expect(slideAt(10, 10, 1)).toBeCloseTo(-1 / RELAPSE_RAMP_DAYS)
    expect(slideAt(23, 10, 1)).toBe(-1)
    expect(slideAt(80, 10, 2)).toBe(-2)
  })

  test('disabled wobble is exactly zero and enabled wobble remains finite', () => {
    const rng = mulberry32(3)
    let x = 0
    for (let i = 0; i < 100; i++) {
      expect(wobbleStep(x, rng, false)).toBe(0)
      x = wobbleStep(x, rng, true)
      expect(Number.isFinite(x)).toBe(true)
    }
  })

  test('a generated person has the product baseline and home cadence shape', () => {
    const sim = simulatePerson(mulberry32(11), 1, 1, false, 'all', 1)
    expect(sim.pings.filter((p) => p.setting === 'clinic')).toHaveLength(14)
    expect(sim.pings.filter((p) => p.setting === 'home')).toHaveLength(HOME_DAYS)
    const analysis = analyze(sim.pings, new Date('2025-12-31T12:00:00.000Z').toISOString())
    for (const channel of CHANNELS) {
      expect(analysis.baseline[channel].source).toBe('clinic')
      expect(analysis.baseline[channel].spread).toBeGreaterThanOrEqual(0.35 * PRIORS[channel].spread)
    }
    expect(NOISE_SD_IN_SPREADS).toBeGreaterThan(0)
  })

  test('flag summaries use the requested windows and quartiles', () => {
    expect(summariseFlags([1, 8, 20, null])).toMatchObject({ within7Pct: 25, within14Pct: 50, within28Pct: 75, flaggedPeople: 3, medianDays: 8, q1Days: 4.5, q3Days: 14 })
  })

  test('the effect grid is ordered and includes zero as the false-alarm cell', () => {
    expect(DELTAS).toEqual([0, 0.25, 0.5, 0.75, 1, 1.5, 2])
  })
})
