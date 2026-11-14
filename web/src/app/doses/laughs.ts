// Smile along: what the face answered to each laugh, and which laugh comes back last.
// Pure, so the margin and the choice run in tests.
import { SMILE_ONSET_DELTA } from '../../sense/features'
import { median, plural, round1 } from './num'

/** when each laugh starts, seconds into the dose */
export const LAUGH_AT_S = [3, 17, 31, 45] as const
export const LAUGH_S = 8
/** a smile often outlasts the laugh: the answer is read this long after it */
export const AFTER_S = 2
/**
 * How far above the resting level the reading must be before a moment counts as smiled: the ping's own
 * onset threshold, 0.15 of the 0..1 reading. A resting face wanders a few hundredths around its level (lips
 * pressing, a blink, camera noise), so anything smaller would count seconds on a face that did nothing.
 */
export const SMILE_MARGIN = SMILE_ONSET_DELTA
/** less than this above the margin is a twitch, not an answer to the laugh */
export const DREW_MIN_S = 0.5
/** the most one frame can add: a camera that stalls must not turn one frame into a long smile */
const FRAME_MAX_MS = 250
/** frames in the running median that sets single-frame spikes aside */
const SPIKE_FRAMES = 5

export interface SmileSample {
  /** ms on the dose clock */
  t: number
  /** the smile reading, 0..1 */
  v: number
}

export interface LaughAnswer {
  clip: string
  /** seconds the reading was above rest by the margin */
  seconds: number
  /** smile above rest, summed over the window (smile-seconds, the echo's unit) */
  area: number
  peak: number
  /** from the start of the laugh to the first crossing of the margin */
  latencyMs: number | null
  /** dose-clock times where the smile crossed the margin, for the marks on the line */
  crossings: number[]
}

/** the resting level: the median of the reading while nothing is playing; null with too few frames to say */
export function restLevel(samples: SmileSample[]): number | null {
  return samples.length >= 10 ? median(samples.map((s) => s.v)) : null
}

/**
 * The resting level a laugh is read against: the lower of the level before the first laugh and the level
 * across every stretch where nothing played. A smile as the dose opens, or one that lingers between laughs,
 * must not pass for the resting face.
 */
export function restOutside(samples: SmileSample[], laughs: [number, number][]): number | null {
  const first = laughs.length ? laughs[0]![0] : Infinity
  const before = restLevel(samples.filter((s) => s.t < first))
  const between = restLevel(samples.filter((s) => !laughs.some(([from, to]) => s.t >= from && s.t < to)))
  if (before == null || between == null) return before ?? between
  return Math.min(before, between)
}

function steady(samples: SmileSample[], i: number): number {
  const from = Math.max(0, i - SPIKE_FRAMES + 1)
  return median(samples.slice(from, i + 1).map((s) => s.v))
}

export function answerTo(clip: string, samples: SmileSample[], rest: number, fromMs: number, toMs: number): LaughAnswer {
  const a: LaughAnswer = { clip, seconds: 0, area: 0, peak: 0, latencyMs: null, crossings: [] }
  let wasAbove = false
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!
    if (s.t < fromMs || s.t >= toMs) continue
    const over = steady(samples, i) - rest
    const dt = Math.min(FRAME_MAX_MS, s.t - samples[i - 1]!.t) / 1000
    const above = over >= SMILE_MARGIN
    if (above) a.seconds += dt
    if (over > 0) a.area += over * dt
    if (over > a.peak) a.peak = over
    if (above && !wasAbove) {
      a.crossings.push(s.t)
      a.latencyMs ??= s.t - fromMs
    }
    wasAbove = above
  }
  return a
}

export const drew = (a: LaughAnswer) => a.seconds >= DREW_MIN_S

/** the laugh that drew the most smile, or null when none drew one */
export function mostAnswered(answers: LaughAnswer[]): LaughAnswer | null {
  let best: LaughAnswer | null = null
  for (const a of answers) {
    if (!drew(a)) continue
    if (!best || a.area > best.area) best = a
  }
  return best
}

/**
 * The fourth laugh: the one that drew the most, again. When none drew a smile, the one this person has
 * answered best on earlier days (`earlierBest`), and with no earlier days the first one played.
 */
export function pickFourth(answers: LaughAnswer[], earlierBest: string | null): string | null {
  const best = mostAnswered(answers)
  if (best) return best.clip
  const played = answers.map((a) => a.clip)
  if (earlierBest && played.includes(earlierBest)) return earlierBest
  return earlierBest ?? played[0] ?? null
}

/** three different clips in a new order each day (`rnd` is Math.random in the app) */
export function firstThree(pool: string[], rnd: () => number): string[] {
  const a = [...pool]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a.slice(0, 3)
}

export const smiledSeconds = (answers: LaughAnswer[]) => answers.reduce((sum, a) => sum + a.seconds, 0)

const STARTS_AS_WORDS = /^(a|an|the|your) /i

/** a clip's label as it sits inside a sentence: "Long laugh" is "the long laugh", "your saved laugh" stays */
export function laughInWords(label: string): string {
  if (STARTS_AS_WORDS.test(label)) return label.charAt(0).toLowerCase() + label.slice(1)
  return `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

export function smileEndLine(answers: LaughAnswer[], name: (clip: string) => string): string {
  const best = mostAnswered(answers)
  const total = Math.round(smiledSeconds(answers))
  if (!best || total < 1) return 'Your face stayed quiet through the laughter today. That is a reading too.'
  return `You smiled through ${plural(total, 'second')} of laughter, most at ${laughInWords(name(best.clip))}.`
}

export function smileMetrics(answers: LaughAnswer[], clipNumber: (clip: string) => number): Record<string, number> {
  const best = mostAnswered(answers)
  const m: Record<string, number> = { faceRead: 1, laughs: answers.length, smileSeconds: round1(smiledSeconds(answers)) }
  if (best) m.bestClip = clipNumber(best.clip)
  return m
}
