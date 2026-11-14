import { expect, test } from 'bun:test'
import { at, breathAt, lastAt, mmss, paceAt, plan, squeeze } from '../../src/tune/replay/timeline'

const b = {
  phases: [
    { name: 'checkin' as const, t0: 0, t1: 40_000 },
    { name: 'before' as const, t0: 40_000, t1: 62_000 },
    { name: 'session' as const, t0: 62_000, t1: 212_000 },
    { name: 'after' as const, t0: 212_000, t1: 246_000 },
  ],
  steps: [
    { ask: 'rest' as const, t0: 40_000, t1: 62_000 },
    { ask: 'rest' as const, t0: 212_000, t1: 234_000 },
    { ask: 'smile' as const, t0: 234_000, t1: 237_000 },
  ],
}
const breaths = [
  { t0: 62_000, tMid: 64_400, t1: 68_000, perMin: 10 },
  { t0: 68_000, tMid: 70_400, t1: 74_000, perMin: 10 },
  { t0: 74_000, tMid: 76_700, t1: 80_700, perMin: 9 },
]

test('the run is played in about 40 seconds: the check before, the practice, the still check after, the result, the clinic', () => {
  const p = plan(b)
  expect(p.segments.map((s) => s.part)).toEqual(['before', 'practice', 'after'])
  expect(p.segments[2].t1).toBe(234_000) // the smiles after are not played
  expect(p.resultAt).toBe(37)
  expect(p.end).toBeGreaterThanOrEqual(40)
  expect(p.end).toBeLessThanOrEqual(46)
  expect(squeeze(p.segments[1])).toBe(6) // 150 s in 25 s
  expect(mmss(150)).toBe('2 min 30 s')
  expect(mmss(22)).toBe('22 s')
  expect(at(p, 0)).toMatchObject({ part: 'before', t: 40_000 })
  expect(at(p, 6 + 12.5)).toMatchObject({ part: 'practice', t: 137_000 })
  expect(at(p, 38).part).toBe('result')
  expect(at(p, p.clinicAt + 0.1).part).toBe('clinic')
})

test('the breath, the pace and the last row at a moment', () => {
  expect(breathAt(breaths, 63_000)).toMatchObject({ i: 0, phase: 'in' })
  expect(breathAt(breaths, 65_000)).toMatchObject({ i: 0, phase: 'out' })
  expect(breathAt(breaths, 90_000)).toBeNull()
  expect(paceAt(breaths, 75_000)).toBe(9)
  expect(paceAt(breaths, 1000)).toBe(10)
  const rows: [number, number][] = [[0, 70], [1000, 71], [2000, 72]]
  expect(lastAt(rows, 1500)).toEqual([1000, 71])
  expect(lastAt(rows, -1)).toBeNull()
})
