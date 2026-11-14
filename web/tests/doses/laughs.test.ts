// bun test: what counts as a smiled second in the smile dose, and which laugh comes back fourth.
import { describe, expect, test } from 'bun:test'
import { SMILE_MARGIN, answerTo, drew, firstThree, laughInWords, mostAnswered, pickFourth, restLevel, restOutside, smileEndLine, smileMetrics, smiledSeconds } from '../../src/app/doses/laughs'
import type { LaughAnswer, SmileSample } from '../../src/app/doses/laughs'

/** 30 frames a second of `level(ms)` from 0 to `untilMs` */
function face(level: (ms: number) => number, untilMs = 14000): SmileSample[] {
  const out: SmileSample[] = []
  for (let ms = 0; ms < untilMs; ms += 1000 / 30) out.push({ t: ms, v: level(ms) })
  return out
}

const wobble = (ms: number) => 0.06 + 0.02 * Math.sin(ms / 300) + 0.015 * Math.sin(ms / 70)
const answer = (clip: string, seconds: number, area: number): LaughAnswer => ({ clip, seconds, area, peak: area, latencyMs: 900, crossings: [] })
const LABELS: Record<string, string> = { 'laugh-1': 'Warm-up laugh', 'laugh-2': 'Bright laugh', 'laugh-3': 'Long laugh' }
const name = (clip: string) => LABELS[clip] ?? 'your saved laugh'

describe('the margin', () => {
  test('a resting face that wanders a few hundredths counts zero seconds', () => {
    const samples = face(wobble)
    const rest = restLevel(samples.filter((s) => s.t < 3000))!
    const a = answerTo('laugh-1', samples, rest, 3000, 13000)
    expect(a.seconds).toBe(0)
    expect(a.crossings).toEqual([])
    expect(drew(a)).toBe(false)
  })

  test('a face merely in view with a high resting level still counts zero', () => {
    const samples = face((ms) => 0.45 + 0.03 * Math.sin(ms / 400))
    const rest = restLevel(samples.filter((s) => s.t < 3000))!
    expect(answerTo('laugh-1', samples, rest, 3000, 13000).seconds).toBe(0)
  })

  test('a smile is counted for as long as it is clear of rest, and its start is marked', () => {
    const samples = face((ms) => wobble(ms) + (ms >= 5000 && ms < 9000 ? 0.4 : 0))
    const rest = restLevel(samples.filter((s) => s.t < 3000))!
    const a = answerTo('laugh-2', samples, rest, 3000, 13000)
    expect(a.seconds).toBeGreaterThan(3.7)
    expect(a.seconds).toBeLessThan(4.3)
    expect(a.crossings.length).toBe(1)
    expect(a.latencyMs!).toBeGreaterThan(1900)
    expect(a.latencyMs!).toBeLessThan(2300)
    expect(drew(a)).toBe(true)
  })

  test('just under the margin is nothing, just over is a smile', () => {
    const under = face((ms) => 0.1 + (ms >= 5000 ? SMILE_MARGIN - 0.02 : 0))
    const over = face((ms) => 0.1 + (ms >= 5000 ? SMILE_MARGIN + 0.02 : 0))
    expect(answerTo('a', under, 0.1, 3000, 13000).seconds).toBe(0)
    expect(answerTo('a', over, 0.1, 3000, 13000).seconds).toBeGreaterThan(7)
  })

  test('one spiked frame is not a smile', () => {
    const samples = face((ms) => (Math.abs(ms - 6000) < 20 ? 0.9 : 0.06))
    expect(answerTo('a', samples, 0.06, 3000, 13000).seconds).toBe(0)
  })

  test('a stalled camera cannot turn one frame into a long smile', () => {
    const samples = face((ms) => (ms >= 5000 ? 0.6 : 0.06)).filter((s) => s.t < 5200 || s.t > 11000)
    expect(answerTo('a', samples, 0.06, 3000, 13000).seconds).toBeLessThan(2.6)
  })

  test('too few quiet frames give no resting level', () => {
    expect(restLevel(face(wobble, 200))).toBeNull()
  })
})

describe('the fourth laugh', () => {
  test('the one that drew the most smile is played again', () => {
    const answers = [answer('laugh-1', 2, 0.4), answer('laugh-3', 5, 1.6), answer('laugh-2', 3, 0.9)]
    expect(mostAnswered(answers)!.clip).toBe('laugh-3')
    expect(pickFourth(answers, 'laugh-1')).toBe('laugh-3')
  })

  test('a twitch does not count as drawing a smile', () => {
    const answers = [answer('laugh-1', 0.3, 0.2), answer('laugh-2', 0, 0), answer('laugh-3', 0.1, 0.05)]
    expect(mostAnswered(answers)).toBeNull()
  })

  test('when none drew a smile: the one answered best on earlier days', () => {
    const answers = [answer('laugh-1', 0, 0), answer('laugh-2', 0, 0), answer('laugh-3', 0, 0)]
    expect(pickFourth(answers, 'laugh-2')).toBe('laugh-2')
    expect(pickFourth(answers, null)).toBe('laugh-1')
    expect(pickFourth([], 'laugh-3')).toBe('laugh-3')
    expect(pickFourth([], null)).toBeNull()
  })

  test('the first three are three different clips', () => {
    const three = firstThree(['laugh-1', 'laugh-2', 'laugh-3', 'personal'], () => 0.37)
    expect(three.length).toBe(3)
    expect(new Set(three).size).toBe(3)
  })
})

describe('the resting level', () => {
  const at = (from: number, to: number, v: number): SmileSample[] => {
    const out: SmileSample[] = []
    for (let t = from; t < to; t += 40) out.push({ t, v })
    return out
  }
  const laughs: [number, number][] = [
    [3000, 13000],
    [17000, 27000],
  ]

  test('a smile as the dose opens does not pass for the resting face once quiet time has been seen', () => {
    const samples = [...at(0, 1000, 0.05), ...at(1000, 3000, 0.3), ...at(3000, 13000, 0.05), ...at(13000, 17000, 0.05)]
    expect(restLevel(samples.filter((s) => s.t < 3000))).toBeCloseTo(0.3, 5)
    expect(restOutside(samples, laughs)).toBeCloseTo(0.05, 5)
  })

  test('a smile that lingers between laughs does not lift it either', () => {
    const samples = [...at(0, 3000, 0.05), ...at(3000, 13000, 0.4), ...at(13000, 17000, 0.35)]
    expect(restOutside(samples, laughs)).toBeCloseTo(0.05, 5)
  })

  test('before any laugh it is the level so far, and nothing with too few frames', () => {
    expect(restOutside(at(0, 2000, 0.07), [])).toBeCloseTo(0.07, 5)
    expect(restOutside(at(0, 200, 0.07), [])).toBeNull()
  })
})

describe('the end line', () => {
  test('seconds smiled and the laugh that drew most, named the way the ping names it', () => {
    const answers = [answer('laugh-1', 2.2, 0.4), answer('laugh-3', 5.4, 1.6), answer('laugh-2', 3.3, 0.9)]
    expect(smiledSeconds(answers)).toBeCloseTo(10.9, 5)
    expect(smileEndLine(answers, name)).toBe('You smiled through 11 seconds of laughter, most at the long laugh.')
    expect(smileEndLine([answer('personal', 4, 1)], name)).toBe('You smiled through 4 seconds of laughter, most at your saved laugh.')
    expect(smileMetrics(answers, (clip) => Number(clip.slice(-1)))).toEqual({ faceRead: 1, laughs: 3, smileSeconds: 10.9, bestClip: 3 })
  })

  test('a clip label sits in the sentence as words', () => {
    expect(laughInWords('Long laugh')).toBe('the long laugh')
    expect(laughInWords('Warm-up laugh')).toBe('the warm-up laugh')
    expect(laughInWords('a new laugh')).toBe('a new laugh')
    expect(laughInWords('Your saved laugh')).toBe('your saved laugh')
  })

  test('a quiet face is said plainly and scores nothing', () => {
    const answers = [answer('laugh-1', 0, 0), answer('laugh-2', 0.2, 0.01)]
    expect(smileEndLine(answers, name)).toBe('Your face stayed quiet through the laughter today. That is a reading too.')
    expect(smileMetrics(answers, () => 1).bestClip).toBeUndefined()
  })
})
