// bun test: the three-pace search of the breathing dose, and the gate that keeps a bad pulse off the screen.
import { HEART_MAX_SWING_SE, analyzePulseWindow, beatSeries, lockedSwing } from '../../src/sense/features'
import { createDemoWave, scriptedHeart } from '../../src/app/doses/demoPulse'
import {
  bestRead,
  breathAt,
  breatheEndLine,
  breatheMetrics,
  emptyPulseLog,
  giveOrTake,
  liveRate,
  logPulse,
  nextCentre,
  paceSchedule,
  readPace,
  threePaces,
} from '../../src/app/doses/paces'
import type { PaceRead, PaceSlot, PulseLog, WaveSeries } from '../../src/app/doses/paces'

const T0 = 5000
/** beats misplaced by up to this much give a fit, but too loose a one to show */
const JITTER_MS = 220

interface Pulse {
  /** what the `pulse` events said */
  log: PulseLog
  /** what `sense.pulseWave` gives */
  wave: WaveSeries
}

/**
 * A camera pulse whose rate swings with the paced breath by `swing(pace)` beats, at 30 samples a second.
 * `jitterMs` moves each beat early or late by up to that much, the way a noisy camera misplaces beats.
 */
function camera(slots: PaceSlot[], swing: (pace: number) => number, quality: (ms: number) => number, noise = 0, jitterMs = 0): Pulse {
  const log = emptyPulseLog()
  const wave: WaveSeries = { t: [], v: [] }
  const end = slots[slots.length - 1]!.endMs
  let phase = 0
  let beat = 0
  let slip = 0
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }
  for (let ms = -3000; ms < end; ms += 1000 / 30) {
    const at = breathAt(slots, Math.max(0, ms))
    const slot = at ? slots[at.slot]! : slots[0]!
    const bpm = 66 - (swing(slot.pace) / 2) * Math.cos(2 * Math.PI * (at ? at.u : 0))
    phase += bpm / 60 / 30
    if (Math.floor(phase) !== beat) {
      beat = Math.floor(phase)
      slip = (2 * rnd() * jitterMs * bpm) / 60000
    }
    wave.t.push(T0 + ms)
    wave.v.push(Math.sin(2 * Math.PI * (phase + slip)) + noise * rnd())
    logPulse(log, { t: T0 + ms, bpm: null, quality: quality(ms), wave: 0, source: 'camera' })
  }
  return { log, wave }
}

const reads = (p: Pulse, slots: PaceSlot[]) => slots.map((s) => readPace(p.log, p.wave, s, T0))

/** the same pulse with the camera's wave missing for a while (a face out of view restarts it) */
function without(p: Pulse, fromMs: number, forMs: number): Pulse {
  const keep = p.wave.t.map((t) => t < T0 + fromMs || t >= T0 + fromMs + forMs)
  return { log: p.log, wave: { t: p.wave.t.filter((_, i) => keep[i]), v: p.wave.v.filter((_, i) => keep[i]) } }
}

describe('three paces', () => {
  test('the remembered pace, then half a breath slower and half a breath faster', () => {
    expect(threePaces(6)).toEqual([6, 5.5, 6.5])
    expect(threePaces(5.5)).toEqual([5.5, 5, 6])
  })

  test('at an edge all three stay inside 4.5 to 7 and stay different', () => {
    expect(threePaces(4.5)).toEqual([4.5, 5, 5.5])
    expect(threePaces(7)).toEqual([7, 6, 6.5])
    expect(threePaces(99)).toEqual([7, 6, 6.5])
    expect(threePaces(Number.NaN)).toEqual([6, 5.5, 6.5])
  })

  test('two breaths at each pace: six breaths, a minute at the first centre', () => {
    const slots = paceSchedule(6)
    expect(slots.map((s) => s.pace)).toEqual([6, 5.5, 6.5])
    expect(slots[0]!.endMs).toBeCloseTo(20000, 5)
    expect(slots[2]!.endMs / 1000).toBeGreaterThan(59)
    expect(slots[2]!.endMs / 1000).toBeLessThan(62)
  })

  test('breathAt names the pace, the breath and the half', () => {
    const slots = paceSchedule(6)
    expect(breathAt(slots, 0)).toMatchObject({ slot: 0, breath: 0, half: 0 })
    expect(breathAt(slots, 6000)).toMatchObject({ slot: 0, breath: 0, half: 1 })
    expect(breathAt(slots, 12000)).toMatchObject({ slot: 0, breath: 1, half: 2 })
    expect(breathAt(slots, 21000)).toMatchObject({ slot: 1, breath: 0, half: 4 })
    expect(breathAt(slots, slots[2]!.endMs + 1)).toBeNull()
  })
})

describe('reading the swing', () => {
  const slots = paceSchedule(6)
  const swing = (pace: number) => (pace === 5.5 ? 14 : pace === 6 ? 9 : 4)

  test('each pace reads close to the swing the heart had, and the largest wins', () => {
    const r = reads(camera(slots, swing, () => 0.8), slots)
    expect(r[0]!.swingBpm!).toBeGreaterThan(7)
    expect(r[0]!.swingBpm!).toBeLessThan(11)
    expect(r[1]!.swingBpm!).toBeGreaterThan(11.5)
    expect(r[1]!.swingBpm!).toBeLessThan(16.5)
    expect(r[2]!.swingBpm!).toBeLessThan(6.5)
    expect(bestRead(r)!.pace).toBe(5.5)
    expect(nextCentre(r, 6)).toBe(5.5)
    expect(breatheEndLine(r, 'camera')).toMatch(/^Your heart swung most at 5\.5 breaths a minute: 1[2-6] beats, give or take 1\. Tomorrow starts there\.$/)
  })

  test('a steady heart reads near zero, not a swing', () => {
    const r = reads(camera(slots, () => 0, () => 0.8, 0.05), slots)
    for (const read of r) expect(read.swingBpm ?? 0).toBeLessThan(2)
  })

  test('a pulse under the gate gives no swing and no number, and the pace is not remembered', () => {
    const r = reads(camera(slots, swing, () => 0.2), slots)
    expect(r.every((read) => read.swingBpm == null)).toBe(true)
    expect(bestRead(r)).toBeNull()
    expect(nextCentre(r, 6)).toBe(6)
    expect(breatheEndLine(r, 'camera')).toBe('I couldn’t read your pulse in this light, so this was a plain pacer today.')
    const m = breatheMetrics(r, 6, 6)
    expect(m.swingBpm).toBeUndefined()
    expect(m.pacesRead).toBe(0)
    expect(m.breathsPerMin).toBe(6)
  })

  test('only the paces that pass are shown; one alone does not move tomorrow', () => {
    const second = slots[1]!
    const r = reads(camera(slots, swing, (ms) => (ms >= second.startMs && ms < second.endMs ? 0.8 : 0.1)), slots)
    expect(r[0]!.swingBpm).toBeNull()
    expect(r[1]!.swingBpm).not.toBeNull()
    expect(r[2]!.swingBpm).toBeNull()
    expect(nextCentre(r, 6)).toBe(6)
    expect(breatheEndLine(r, 'camera')).toContain('the one pace I could read')
  })

  test('the estimator\'s warm-up zeros are not held against the first pace', () => {
    const warming = camera(slots, swing, (ms) => (ms < 4000 ? 0 : 0.8))
    expect(reads(warming, slots)[0]!.swingBpm).not.toBeNull()
  })

  test('the live line follows the same gate', () => {
    const good = camera(slots, swing, () => 0.8)
    const live = liveRate(good.log, good.wave, T0 + 18000)
    expect(live).not.toBeNull()
    expect(Math.min(...live!.bpm)).toBeGreaterThan(55)
    expect(Math.max(...live!.bpm)).toBeLessThan(77)
    const dim = camera(slots, swing, () => 0.2)
    expect(liveRate(dim.log, dim.wave, T0 + 18000)).toBeNull()
  })

  test('AirPods rates go straight into the same fit', () => {
    const log = emptyPulseLog()
    const first = slots[0]!
    for (let ms = 0; ms < first.endMs; ms += 1000) {
      const u = (ms % first.breathMs) / first.breathMs
      logPulse(log, { t: T0 + ms, bpm: 66 - 5 * Math.cos(2 * Math.PI * u), quality: 1, wave: 0, source: 'airpods' })
    }
    const read = readPace(log, { t: [], v: [] }, first, T0)
    expect(read.swingBpm!).toBeGreaterThan(8.5)
    expect(read.swingBpm!).toBeLessThan(11.5)
  })

  test('level swings keep the earlier pace', () => {
    const r: PaceRead[] = [
      { pace: 6, swingBpm: 8, se: 1 },
      { pace: 5.5, swingBpm: 8, se: 1 },
      { pace: 6.5, swingBpm: null, se: null },
    ]
    expect(bestRead(r)!.pace).toBe(6)
  })
})

describe('the two gates a swing has to pass', () => {
  const slots = paceSchedule(6)
  const first = slots[0]!
  const swing = () => 12

  test('a pulse run broken in the middle of a pace: that pace is withheld, the next is read', () => {
    const broken = without(camera(slots, swing, () => 0.8), 7000, 2000)
    expect(readPace(broken.log, broken.wave, first, T0).swingBpm).toBeNull()
    expect(readPace(broken.log, broken.wave, slots[1]!, T0).swingBpm).not.toBeNull()
  })

  test('the unbroken run must cover nine tenths of the breaths', () => {
    const whole = camera(slots, swing, () => 0.8)
    // 1.5 s missing at the start leaves 92 % of the twenty seconds: read
    const short = without(whole, 0, 1500)
    expect(readPace(short.log, short.wave, first, T0).swingBpm).not.toBeNull()
    // 3 s missing leaves 85 %: withheld, though the fit itself would give a number
    const shorter = without(whole, 0, 3000)
    const run = analyzePulseWindow(shorter.wave.t, shorter.wave.v, [T0, T0 + first.endMs])!
    const beats = beatSeries(run)!
    expect(lockedSwing(beats.rateT, beats.rate, T0, first.breathMs)).not.toBeNull()
    expect(readPace(shorter.log, shorter.wave, first, T0).swingBpm).toBeNull()
  })

  test('a fit whose standard error is over the bound is withheld', () => {
    const loose = camera(slots, swing, () => 0.8, 0, JITTER_MS)
    const run = analyzePulseWindow(loose.wave.t, loose.wave.v, [T0, T0 + first.endMs])!
    const beats = beatSeries(run)!
    const fit = lockedSwing(beats.rateT, beats.rate, T0, first.breathMs)!
    expect(fit.se).toBeGreaterThan(HEART_MAX_SWING_SE)
    const read = readPace(loose.log, loose.wave, first, T0)
    expect(read.swingBpm).toBeNull()
    expect(read.se).toBeNull()
  })

  test('AirPods rates too loose for the bound are withheld as well', () => {
    const log = emptyPulseLog()
    let seed = 11
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff - 0.5
    }
    for (let ms = 0; ms < first.endMs; ms += 1000) {
      const u = (ms % first.breathMs) / first.breathMs
      logPulse(log, { t: T0 + ms, bpm: 66 - 5 * Math.cos(2 * Math.PI * u) + 14 * rnd(), quality: 1, wave: 0, source: 'airpods' })
    }
    const fit = lockedSwing(log.airT, log.airBpm, T0, first.breathMs)
    expect(fit).not.toBeNull()
    expect(fit!.se).toBeGreaterThan(HEART_MAX_SWING_SE)
    expect(readPace(log, { t: [], v: [] }, first, T0).swingBpm).toBeNull()
  })
})

describe('the error bar as it is said', () => {
  test('one standard error, rounded up to a whole beat, and never less than one', () => {
    expect(giveOrTake(0.2)).toBe(1)
    expect(giveOrTake(1)).toBe(1)
    expect(giveOrTake(1.2)).toBe(2)
    expect(giveOrTake(2)).toBe(2)
  })

  test('it is in the end line and in the metrics, not in a pace that was not read', () => {
    const r: PaceRead[] = [
      { pace: 6, swingBpm: 8.4, se: 0.7 },
      { pace: 5.5, swingBpm: 12.2, se: 1.3 },
      { pace: 6.5, swingBpm: null, se: null },
    ]
    expect(breatheEndLine(r, 'camera')).toBe('Your heart swung most at 5.5 breaths a minute: 12 beats, give or take 2. Tomorrow starts there.')
    expect(breatheEndLine([r[0]!, r[2]!], 'camera')).toBe('Your heart swung 8 beats, give or take 1, at 6.0 breaths a minute. That was the one pace I could read.')
    const m = breatheMetrics(r, 6, 6)
    expect(m).toMatchObject({ swingBpm: 12.2, swingSe: 1.3, giveOrTake: 2, swingPace: 5.5, pacesRead: 2, breathsPerMin: 5.5, swing1: 8.4, swing2: 12.2 })
    expect(breatheMetrics([r[0]!, r[2]!], 5.5, 4)).toMatchObject({ swingBpm: 8.4, swingPace: 6, pacesRead: 1, breathsPerMin: 5.5 })
    expect(m.swing3).toBeUndefined()
  })
})

describe('demo signals', () => {
  const slots = paceSchedule(6)
  const log = emptyPulseLog()
  const end = T0 + slots[2]!.endMs
  for (let t = T0; t < end; t += 1000 / 30) logPulse(log, { t, bpm: 66, quality: 0.82, wave: 0, source: 'camera' })
  const waveOf = createDemoWave(scriptedHeart(slots, T0), T0)

  test('all three paces are read from their first breath to their last, and the best of three is named', () => {
    const r = slots.map((s) => readPace(log, waveOf(T0 + s.startMs, T0 + s.endMs, end), s, T0))
    expect(r.every((read) => read.swingBpm != null)).toBe(true)
    expect(bestRead(r)!.pace).toBe(5.5)
    expect(r[1]!.swingBpm!).toBeGreaterThan(11.5)
    expect(r[1]!.swingBpm!).toBeLessThan(14.5)
    expect(breatheEndLine(r, 'camera')).toMatch(/^Your heart swung most at 5\.5 breaths a minute: 1[2-4] beats, give or take 1\. Tomorrow starts there\.$/)
  })

  test('the wave is laid down by the clock, however rarely it is asked for', () => {
    const rarely = createDemoWave(scriptedHeart(slots, T0), T0)
    rarely(T0, T0 + 1, T0 + 9000)
    const late = rarely(T0, end, end)
    const often = waveOf(T0, end, end)
    expect(late.t.length).toBe(often.t.length)
    expect(late.v[late.v.length - 1]).toBeCloseTo(often.v[often.v.length - 1]!, 9)
  })
})
