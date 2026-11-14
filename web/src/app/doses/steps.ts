// A walk with a beat: steps from the motion sensor, and a beat that leads only while the person is with it.
// Pure, so it runs in tests.
import { clamp, median, plural } from './num'

/** the beat when no step rate can be measured */
export const FIXED_BEAT = 106
const BEAT_MIN = 80
const BEAT_MAX = 140
/** "with the beat": the step rate is within this many steps a minute of it */
const WITH_SPM = 3
/** with it for this long, the beat moves ahead by this much, up to this far past where it met the person */
const AHEAD_AFTER_S = 4
const AHEAD_STEP = 2
const AHEAD_MAX = 8
/** off it for this long, the beat comes back to the person's own rate */
const BACK_AFTER_S = 3

/** Steps from the size of the acceleration (in g): a peak that stands out of its own slow envelope, at most three a second. */
export function createStepCounter() {
  const steps: number[] = []
  let slow = 0
  let fast = 0
  let env = 0.08
  let above = false
  let lastStep = 0
  return {
    feed(t: number, mag: number) {
      slow += (mag - slow) * 0.02
      fast += (mag - slow - fast) * 0.35
      env = Math.max(env * 0.995, Math.abs(fast))
      const threshold = Math.max(0.035, env * 0.45)
      if (!above && fast > threshold && t - lastStep > 330) {
        above = true
        lastStep = t
        steps.push(t)
      } else if (above && fast < threshold * 0.4) {
        above = false
      }
    },
    count: () => steps.length,
    /** steps a minute over the last ten steps; null until five even gaps exist or when the last step is over 2.5 s old */
    cadence(now: number): number | null {
      if (!steps.length || now - steps[steps.length - 1]! > 2500) return null
      const recent = steps.slice(-11)
      const gaps: number[] = []
      for (let i = 1; i < recent.length; i++) {
        const gap = recent[i]! - recent[i - 1]!
        if (gap > 300 && gap < 1000) gaps.push(gap)
      }
      return gaps.length >= 5 ? 60000 / median(gaps) : null
    },
  }
}

export interface Beat {
  /** the beat now, steps a minute */
  spm: number
  /** where the beat last met the person */
  own: number
  withS: number
  offS: number
  /** seconds the person has walked with the beat */
  keptS: number
}

export const startBeat = (cadence: number): Beat => {
  const spm = clamp(Math.round(cadence), BEAT_MIN, BEAT_MAX)
  return { spm, own: spm, withS: 0, offS: 0, keptS: 0 }
}

/** one tick of `dt` seconds with the measured step rate (null while no steps are felt) */
export function leadBeat(b: Beat, cadence: number | null, dt: number) {
  if (cadence == null) {
    b.withS = 0
    return
  }
  if (Math.abs(cadence - b.spm) <= WITH_SPM) {
    b.keptS += dt
    b.withS += dt
    b.offS = 0
    if (b.withS >= AHEAD_AFTER_S && b.spm < Math.min(BEAT_MAX, b.own + AHEAD_MAX)) {
      b.spm += AHEAD_STEP
      b.withS = 0
    }
    return
  }
  b.withS = Math.min(b.withS, 0)
  b.offS += dt
  if (b.offS >= BACK_AFTER_S) {
    b.spm = clamp(Math.round(cadence), BEAT_MIN, BEAT_MAX)
    b.own = b.spm
    b.offS = 0
    // it was not followed: it stays with the person twice as long before it tries again
    b.withS = -AHEAD_AFTER_S
  }
}

export function walkEndLine(cadences: number[], keptS: number, sensor: boolean): string {
  if (!sensor) return 'No motion sensor here, so this was a fixed beat.'
  if (!cadences.length) return 'I couldn’t feel your steps, so this was a fixed beat.'
  return `You walked at ${Math.round(median(cadences))} steps a minute and kept the beat for ${plural(Math.round(keptS), 'second')}.`
}
