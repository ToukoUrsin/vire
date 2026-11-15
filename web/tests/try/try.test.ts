import { describe, expect, test } from 'bun:test'
import { breathRate, gapsOf } from '../../src/tune/session/breath'
import { newPacer } from '../../src/tune/session/pace'
import { breathTrace, countsOf, lineFor, readStretch, resultLines, seaAt } from '../../src/try/flow'
import { MotionStream, OUT_HZ, tiltOf } from '../../src/try/phoneMotion'
import { chest, chestSensor, runTry } from './chest'

const G = 9.81
const RAD = Math.PI / 180

describe('gravity to tilt', () => {
  test('a phone held upright, lying flat and leaning reads the angles it is at', () => {
    // upright: gravity runs down the phone's long axis
    expect(tiltOf({ x: 0, y: -G, z: 0 })!.map((v) => Math.round(v))).toEqual([0, -90, 0])
    // flat on a belly, screen up
    expect(tiltOf({ x: 0, y: 0, z: G })!.map((v) => Math.round(v))).toEqual([0, 0, 90])
    // upright and leaning back 14 degrees: the screen's axis is 14 degrees above level
    const lean = tiltOf({ x: 0, y: -G * Math.cos(14 * RAD), z: G * Math.sin(14 * RAD) })!
    expect(lean[2]).toBeCloseTo(14, 6)
    expect(lean[1]).toBeCloseTo(-76, 6)
    // one more degree of lean is one more degree read, on any planet
    const more = tiltOf({ x: 0, y: -3.7 * Math.cos(15 * RAD), z: 3.7 * Math.sin(15 * RAD) })!
    expect(more[2] - lean[2]).toBeCloseTo(1, 6)
  })
  test('no gravity, no angle', () => {
    expect(tiltOf({ x: 0, y: 0, z: 0 })).toBeNull()
    expect(tiltOf({ x: Number.NaN, y: 1, z: 9 })).toBeNull()
    expect(new MotionStream().push(0, null)).toEqual([])
  })
})

describe('uneven sensor samples to steady rows', () => {
  for (const hz of [60, 104]) {
    test(`${hz} a second with 30 % jitter comes out at ${OUT_HZ} a second, with the breath kept`, () => {
      const stream = new MotionStream()
      chestSensor(chest({ hz, jitter: 0.3, swingDeg: 2, driftDeg: 0 })).run(30_000, 10, (t, g) => stream.push(t, g))
      expect(Math.abs(stream.inHz - hz)).toBeLessThan(2)
      const gaps = stream.rows.slice(1).map((row, i) => row[0]! - stream.rows[i]![0]!)
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(19)
      expect(Math.max(...gaps)).toBeLessThanOrEqual(21)
      expect(Math.abs(stream.rows.length - 30 * OUT_HZ)).toBeLessThanOrEqual(3)
      expect(stream.rows.every((row) => row.length === 10 && row.every(Number.isFinite))).toBe(true)
      expect(gapsOf(stream.rows)).toEqual([])
      // breath.ts accepts the rows and reads the 10 a minute that was put in
      const read = breathRate(stream.rows, 2000, 30_000)
      expect(read.perMin).not.toBeNull()
      expect(Math.abs(read.perMin! - 10)).toBeLessThanOrEqual(0.8)
      // the smoothing keeps a breath's tilt: 2 degrees in, between 1.7 and 2.3 out
      const lean = stream.rows.filter((row) => row[0]! > 6000).map((row) => row[3]!)
      const swing = Math.max(...lean) - Math.min(...lean)
      expect(swing).toBeGreaterThan(1.7)
      expect(swing).toBeLessThan(2.4)
    })
  }
  test('a hole in the samples stays a hole: it is not drawn over', () => {
    const stream = new MotionStream()
    const sensor = chestSensor(chest())
    sensor.run(5000, 10, (t, g) => stream.push(t, g))
    sensor.run(7000, 10, () => {})
    sensor.run(12_000, 10, (t, g) => stream.push(t, g))
    expect(stream.holes).toBe(1)
    const gaps = gapsOf(stream.rows)
    expect(gaps.length).toBe(1)
    expect(gaps[0]!.ms).toBeGreaterThan(1900)
    // a stretch with a hole in it is not read and not called still: the sea holds, and the page says why
    const got = readStretch(stream.rows, 0, 12_000 + 12_000, newPacer(10))
    expect(got.check.by).toBe('held')
    expect(got.check.line).toBe("No breath read: the phone's motion readings stopped for a moment. Staying at 10.")
  })
  test('a short pause (half a second) is joined and counted, and the stretch can still be read', () => {
    const stream = new MotionStream()
    const sensor = chestSensor(chest())
    sensor.run(9000, 10, (t, g) => stream.push(t, g))
    sensor.run(9500, 10, () => {})
    sensor.run(26_000, 10, (t, g) => stream.push(t, g))
    expect(stream.joined).toBe(1)
    expect(stream.holes).toBe(0)
    expect(gapsOf(stream.rows)).toEqual([])
    expect(readStretch(stream.rows, 3500, 26_000, newPacer(10)).check.by).toBe('breath')
  })
  test('samples handed over in one batch are all kept', () => {
    const stream = new MotionStream()
    for (let i = 0; i < 300; i++) stream.push(Math.floor(i / 3) * 50, { x: 0, y: -G, z: 0.1 })
    expect(stream.count).toBe(300)
    expect(stream.rows.length).toBeGreaterThan(200)
  })
})

describe('the minute, with a made-up chest', () => {
  test('(a) a breath that goes with the sea, 2 degrees with tremor: read as following, and the sea steps down', () => {
    for (const hz of [60, 104])
      for (const seed of [1, 2, 3, 4, 5]) {
        const { state } = runTry(chest({ hz, seed }))
        expect(state.checks.map((c) => [c.from, c.to, c.by])).toEqual([
          [10, 8.5, 'breath'],
          [8.5, 7, 'breath'],
          [7, 6, 'breath'],
        ])
        for (const c of state.checks) {
          expect(c.follows).toBe(true)
          expect(Math.abs(c.perMin! - c.from)).toBeLessThanOrEqual(1)
          expect(c.amplitudeDeg).toBeGreaterThan(1.5)
          expect(c.amplitudeDeg).toBeLessThan(2.6)
          expect(c.coherence).toBeGreaterThan(0.9)
        }
        expect(state.checks[0]!.line).toBe('Your breath followed. Slower now: 8.5 a minute.')
        const k = countsOf(state)
        expect(k).toEqual({ from: 10, to: 6, checks: 3, followed: 3, byStill: 0, notFollowed: 0, moving: 0 })
        // three stretches and one breath at six: 24 + 21.2 + 25.7 + 10 seconds
        const end = state.breaths[state.breaths.length - 1]!.t1
        expect(end).toBeGreaterThan(75_000)
        expect(end).toBeLessThan(90_000)
        expect(resultLines(k).head).toBe('The sea went from 10 to 6 breaths a minute.')
      }
  })
  test('a small breath (1 degree) and a large one in a shaky hand (4 degrees) are read too', () => {
    for (const over of [{ swingDeg: 1 }, { swingDeg: 4, tremor: 0.2, driftDeg: 2 }]) {
      const k = countsOf(runTry(chest({ ...over, seed: 11 })).state)
      expect(k.followed).toBe(3)
      expect(k.to).toBe(6)
    }
  })
  test('(b) a breath at its own 14 a minute while the sea is at 10: read, not following, the sea stays', () => {
    for (const seed of [1, 2, 3]) {
      const { state } = runTry(chest({ ownPace: 14, seed }))
      const k = countsOf(state)
      expect(k.followed).toBe(0)
      expect(k.byStill).toBe(0)
      expect(k.to).toBe(10)
      expect(k.notFollowed).toBe(k.checks)
      expect(k.checks).toBeGreaterThanOrEqual(3)
      for (const c of state.checks) {
        expect(c.readable).toBe(true)
        expect(Math.abs(c.perMin! - 14)).toBeLessThanOrEqual(1)
        expect(c.line).toBe('Your breath did not follow. Staying at 10.')
      }
      expect(resultLines(k).head).toBe('The sea stayed at 10 breaths a minute.')
    }
  })
  test('(c) no breath and a phone lying still (on a table, say): the sea stays, and says so', () => {
    for (const seed of [1, 2, 3]) {
      const { state } = runTry(chest({ swingDeg: 0, tremor: 0, driftDeg: 0, seed }))
      const k = countsOf(state)
      // "the sea slows only if your breath follows": a judge fed a flat phone and the sea went from 10 to 6
      expect(k.to).toBe(10)
      expect(k.checks).toBeGreaterThanOrEqual(3)
      expect(k).toMatchObject({ from: 10, followed: 0, byStill: k.checks, notFollowed: 0, moving: 0 })
      for (const c of state.checks) {
        expect(c.follows).toBe(false)
        expect(c.readable).toBe(false)
        expect(c.still).toBe(true)
        expect(c.by).toBe('held')
        expect(c.moveDegS!).toBeLessThan(0.5)
        expect(c.line).toBe('No breath read: the phone lay still. Staying at 10. Hold it flat against your chest.')
      }
      const said = resultLines(k)
      expect(said.head).toBe('The sea stayed at 10 breaths a minute.')
      expect(said.lines.join(' ')).toContain('no breath could be read and the phone lay still, so the sea stayed')
      expect(said.lines.join(' ')).toContain('The sea only slows when the phone reads your breath going with it.')
      expect(said.lines.join(' ')).not.toContain('following')
    }
  })
  test('(d) a phone being walked around is neither: nothing is read and the sea stays', () => {
    for (const seed of [1, 2, 3]) {
      const { state } = runTry(chest({ walking: true, seed }))
      const k = countsOf(state)
      expect(k.followed + k.byStill + k.notFollowed).toBe(0)
      expect(k.moving).toBe(k.checks)
      expect(k.to).toBe(10)
      for (const c of state.checks) {
        expect(c.moveDegS!).toBeGreaterThan(8)
        expect(c.line).toBe('No breath read, the phone was moving. Staying at 10.')
      }
    }
  })
  test('a hand that only drifts is almost never read as a breath following', () => {
    let followed = 0
    let checks = 0
    for (let seed = 1; seed <= 14; seed++) {
      const k = countsOf(runTry(chest({ swingDeg: 0, tremor: 0.2, driftDeg: 2, seed })).state)
      followed += k.followed
      checks += k.checks
    }
    expect(followed / checks).toBeLessThan(0.04)
  }, 20_000)
})

describe('words and the drawn line', () => {
  test('every outcome has its own plain sentence', () => {
    expect(lineFor({ from: 6, to: 6, by: 'breath', readable: true })).toBe('Your breath followed. Staying at 6.')
    expect(lineFor({ from: 7, to: 8, by: 'held', readable: true })).toBe('Your breath did not follow twice. Back to 8 a minute.')
    expect(resultLines({ from: 10, to: 10, checks: 0, followed: 0, byStill: 0, notFollowed: 0, moving: 0 }).lines[0]).toContain('Nothing was read')
    const all = [resultLines({ from: 10, to: 7, checks: 4, followed: 2, byStill: 1, notFollowed: 1, moving: 0 })].flatMap((x) => [x.head, ...x.lines]).join(' ')
    expect(all).not.toMatch(/AirPods|—|!|coherence|amplitude|band/i)
    expect(all).toContain('Twice your breath was read following the sea.')
  })
  test('the sea rises through the in-breath and falls through the out-breath', () => {
    const b = [{ t0: 0, tMid: 2400, t1: 6000, perMin: 10 }]
    expect(seaAt(b, 0)).toBe(0)
    expect(seaAt(b, 1200)).toBeCloseTo(0.5)
    expect(seaAt(b, 2400)).toBe(1)
    expect(seaAt(b, 4200)).toBeCloseTo(0.5)
    expect(seaAt(b, 7000)).toBe(0)
  })
  test('a breath with the sea is drawn moving with it; a still phone is drawn flat', () => {
    const run = runTry(chest({ seed: 3 }))
    const tr = breathTrace(run.stream.rows, run.state.breaths, 20_000, 44_000)
    expect(tr.tilt.length).toBeGreaterThan(100)
    expect(tr.swingDeg).toBeGreaterThan(1.2)
    expect(tr.swingDeg).toBeLessThan(2.6)
    expect(tr.together).toBeGreaterThan(0.6)
    const flat = runTry(chest({ swingDeg: 0, tremor: 0, driftDeg: 0, seed: 3 }))
    const ft = breathTrace(flat.stream.rows, flat.state.breaths, 20_000, 44_000)
    expect(ft.swingDeg).toBeLessThan(0.1)
    expect(breathTrace([], [], 0, 1000).tilt).toEqual([])
  })
})
