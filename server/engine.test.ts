import { describe, expect, test } from 'bun:test'
import type { Channel, DoseKind } from '../shared/types'
import { buildDetail, buildRow, echoNow, priorityOf, reasonOf, rowFacts, slope, summaryOf } from './clinic'
import { generateCohort, synthTraces } from './cohort'
import {
  CHANNELS,
  DOSES,
  PRIORS,
  analyze,
  beliefs,
  channelValues,
  cohortPrior,
  componentNote,
  computeBaseline,
  defaultPrior,
  doseReason,
  doseReward,
  echoMessage,
  mad,
  median,
  mulberry32,
  ngBelief,
  ngUpdate,
  posteriors,
  randGamma,
  randNormal,
  strengthOf,
  fullPingCount,
  isCalibrating,
  suggest,
  thompson,
  toEcho,
} from './engine'
import type { DoseRec, PingRec } from './engine'

const DAY = 86400_000
const T0 = Date.parse('2026-10-01T10:00:00Z')
let seq = 0
/** channel values `z` spreads away from the population centre (so the person's baseline is easy to reason about) */
const at = (z: number | Partial<Record<Channel, number | null>>): Record<Channel, number | null> => {
  const out = {} as Record<Channel, number | null>
  for (const ch of CHANNELS) {
    const k = typeof z === 'number' ? z : z[ch]
    out[ch] = k == null ? null : PRIORS[ch].center + PRIORS[ch].spread * k
  }
  return out
}
function ping(day: number, z: number | Partial<Record<Channel, number | null>>, o: Partial<PingRec> = {}): PingRec {
  return { id: `p${seq++}`, at: new Date(T0 + day * DAY).toISOString(), setting: 'home', kind: 'full', values: at(z), ...o }
}
/** seven baseline pings: median at z = 0 and a MAD-spread of exactly one population spread */
const base = (setting: 'home' | 'clinic' = 'home', from = 0) => [-1.5, -0.6745, -0.3, 0, 0.3, 0.6745, 1.5].map((d, i) => ping(from + i, d, { setting }))

describe('baseline', () => {
  test('median and MAD', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(mad([1, 2, 3, 4, 100])).toBeCloseTo(1.4826, 4) // the outlier does not move it
  })

  test('under 3 pings the population priors stand in', () => {
    const b = computeBaseline([ping(0, 0), ping(1, 0)])
    for (const ch of CHANNELS) expect(b[ch]).toMatchObject({ source: 'prior', center: PRIORS[ch].center })
  })

  test('the first 7 home pings are the baseline when there is no clinic calibration', () => {
    const pings = [...[1, 2, 3, 4, 5, 6, 7].map((d) => ping(d, d - 4)), ping(8, -30), ping(9, -30), ping(10, -30)]
    const b = computeBaseline(pings)
    expect(b.smile).toMatchObject({ source: 'home', n: 7 })
    expect(b.smile.center).toBeCloseTo(PRIORS.smile.center)
  })

  test('clinic pings from the last two weeks of the course are the well signature', () => {
    const ill = [0, 3, 7, 10].map((d) => ping(d, -6, { setting: 'clinic' }))
    const well = [20, 23, 27, 30, 34].map((d, i) => ping(d, [0.4, -0.4, 0, 1, -1][i]!, { setting: 'clinic' }))
    const home = [36, 37, 38, 39].map((d) => ping(d, -3))
    const b = computeBaseline([...ill, ...well, ...home], new Date(T0 + 34 * DAY).toISOString())
    expect(b.smile).toMatchObject({ source: 'clinic', n: 5 })
    expect(b.smile.center).toBeCloseTo(PRIORS.smile.center)
    expect(b.move.center).toBeCloseTo(PRIORS.move.center)
    // and without a recorded course end the last clinic ping closes the window
    expect(computeBaseline([...ill, ...well, ...home]).smile).toMatchObject({ source: 'clinic', n: 5 })
  })

  test('a missing channel is baselined on the pings that have it', () => {
    const pings = [0, 1, 2, 3].map((d) => ping(d, 0, { values: { smile: 2, voice: 3, heart: d < 2 ? null : 9, move: 60 } }))
    const b = computeBaseline(pings)
    expect(b.heart.source).toBe('prior')
    expect(b.smile.source).toBe('home')
  })
})

describe('echo', () => {
  test('the clinic echo headline is one rounded latest full-ping number', () => {
    const a = analyze([ping(0, 0), ping(1, 0), ping(2, 0.77), ping(2.01, 4, { kind: 'mini' })])
    expect(echoNow(a)).toBe(Math.round(a.echoes.filter((e) => e.kind === 'full').at(-1)!.strength))
    expect(echoNow(a)).not.toBe(Math.round(a.echoes.at(-1)!.strength))
  })
  test('calibration counts full pings only, so mini pings cannot end it', () => {
    const pings = [ping(0, 0), ping(0.01, 0, { kind: 'mini' }), ping(1, 0)]
    expect(fullPingCount(pings)).toBe(2)
    expect(isCalibrating(pings)).toBe(true)
    expect(analyze(pings).status).toBe('calibrating')
    expect(isCalibrating([...pings, ping(2, 0)])).toBe(false)
  })
  test('strength = clamp(50 + 15 z, 0, 100)', () => {
    expect(strengthOf(0)).toBe(50)
    expect(strengthOf(1)).toBe(65)
    expect(strengthOf(-2)).toBe(20)
    expect(strengthOf(-9)).toBe(0)
    expect(strengthOf(9)).toBe(100)
  })

  test('calibrating under 3 pings: no z, strength from the population priors', () => {
    const a = analyze([ping(0, 0, { values: { smile: PRIORS.smile.center + PRIORS.smile.spread, voice: PRIORS.voice.center, heart: null, move: PRIORS.move.center } })])
    const e = a.echoes[0]!
    expect(a.status).toBe('calibrating')
    expect(e.components.map((c) => c.z)).toEqual([null, null, null, null])
    expect(e.components[0]!.strength).toBe(65)
    expect(e.strength).toBeCloseTo((65 + 50 + 50) / 3, 1) // heart was not read: left out of the mean
    expect(echoMessage(e, 1)).toContain('2 to go')
  })

  test('z is measured against the person, not the population', () => {
    const a = analyze([...base(), ping(8, -2)])
    const e = a.echoes.at(-1)!
    for (const c of e.components) {
      expect(c.z!).toBeCloseTo(-2, 1)
      expect(c.strength).toBeCloseTo(20, 0)
    }
    expect(e.strength).toBeCloseTo(20, 0)
  })

  test('drift is the EWMA (alpha 0.3) of the daily mean z', () => {
    // clinic signature at z = 0, then home days at -1, -1 (two pings: -3 and +1), -2
    const sig = base('clinic')
    const home = [ping(10, -1), ping(11, -3), ping(11.2, 1), ping(12, -2)]
    const a = analyze([...sig, ...home])
    const zOf = (id: string) => a.echoes.find((e) => e.pingId === id)!.meanZ!
    const days = a.days.slice(-3)
    let d = a.days.at(-4)!.drift
    for (const [i, zs] of [[home[0]!], [home[1]!, home[2]!], [home[3]!]].entries()) {
      const m = zs.reduce((s, p) => s + zOf(p.id), 0) / zs.length
      d = 0.3 * m + 0.7 * d
      expect(days[i]!.drift).toBeCloseTo(d, 6)
    }
    expect(a.drift).toBeCloseTo(d, 2)
    // mid-day the drift uses the day's pings so far
    const first = a.echoes.find((e) => e.pingId === home[1]!.id)!
    expect(first.drift).toBeLessThan(a.echoes.find((e) => e.pingId === home[2]!.id)!.drift)
  })

  test('status: steady above -0.75, dipping below, low after 3+ days under -1.5', () => {
    const sig = base('clinic')
    const run = (zs: number[]) => analyze([...sig, ...zs.map((z, i) => ping(10 + i, z))])
    expect(run([0, 0.2, -0.3]).status).toBe('steady')
    expect(run([-1.2, -1.2, -1.2, -1.2, -1.2, -1.2]).status).toBe('dipping')
    const deep = run([-4, -4, -4, -4, -4, -4])
    expect(deep.status).toBe('low')
    // the first days under -1.5 are still "dipping": low needs three of them
    const under = deep.days.filter((d) => d.drift < -1.5)
    const firstUnder = deep.echoes.find((e) => Math.abs(e.drift - Math.round(under[0]!.drift * 100) / 100) < 1e-9)!
    expect(firstUnder.status).toBe('dipping')
    expect(run([-4, -4, -4, -4, -4, -4, 2, 2, 2, 2, 2, 2]).status).toBe('steady') // and it recovers
  })

  test('a mini ping has smile + heart only and does not move the drift', () => {
    const sig = base('clinic')
    const mini = ping(10.01, { smile: 3, voice: -9, heart: 3, move: -9 }, { kind: 'mini' }) // a mini ping uploads zeros for voice and move
    const a = analyze([...sig, ping(10, -1), mini])
    const e = a.echoes.at(-1)!
    expect(e.components.filter((c) => c.value != null).map((c) => c.channel)).toEqual(['smile', 'heart'])
    expect(e.drift).toBe(a.echoes.at(-2)!.drift)
  })

  test('three readable pings end calibration without inventing a usual for an unread channel', () => {
    const pings = [0, 1, 2].map((d) => ping(d, { smile: 0, voice: 0, heart: null, move: 0 }))
    const a = analyze(pings)
    expect(a.status).toBe('steady')
    const last = a.echoes.at(-1)!
    expect(last.components.find((c) => c.channel === 'smile')?.z).not.toBeNull()
    expect(last.components.find((c) => c.channel === 'heart')?.z).toBeNull()
  })

  test('channel values follow the contract', () => {
    const f = {
      smile: { latencyMs: 600, peak: 0.5, auc: 2.1, duchenne: 0.3, durationMs: 3000, baseline: 0.05 },
      voice: { speechFraction: 0.5, pauseCount: 2, meanPauseMs: 400, f0MedianHz: null, f0SdSemitones: null, loudnessSdDb: 4, syllableRateHz: null },
      heart: { restBpm: 66, swingBpm: 9, quality: 0.2, source: 'camera' as const },
      move: { nodAmplitudeDeg: 9, nodPeakVelDegS: 70, nodCount: 2, restlessness: 1, source: 'camera' as const },
    }
    expect(channelValues(f, 'full')).toEqual({ smile: 2.1, voice: 2, heart: null, move: 70 }) // voice falls back to speechFraction * 4; poor pulse is dropped
    expect(channelValues({ ...f, heart: { ...f.heart, quality: 0.8 } }, 'mini')).toEqual({ smile: 2.1, voice: null, heart: 9, move: null })
  })
})

describe('plain words', () => {
  const JARGON = /depress|diagnos|symptom|disorder|relaps|latency|z-score|\bsd\b|anhedon|psychomotor|score/i

  test('notes are warm, second person, and never clinical', () => {
    expect(componentNote('smile', 1.4, -0.8)).toBe('Your smile came a little slower than your usual')
    for (const ch of CHANNELS) {
      for (const z of [-3, -0.8, 0, 0.8, 3, null]) {
        for (const v of [1, null]) {
          const note = componentNote(ch, v, z)
          expect(note).not.toMatch(JARGON)
          expect(note).toMatch(/^(Your|We|Still)/)
          expect(note).not.toMatch(/\d/)
        }
      }
    }
  })

  test('messages never diagnose, whatever the status', () => {
    const sig = base('clinic')
    for (const zs of [[0], [2], [-1.2, -1.2, -1.2, -1.2], [-4, -4, -4, -4, -4]]) {
      const a = analyze([...sig, ...zs.map((z, i) => ping(10 + i, z))])
      const echo = toEcho(a.echoes.at(-1)!, echoMessage(a.echoes.at(-1)!, a.nFull), null)
      expect(echo.message).not.toMatch(JARGON)
      expect(echo.message).not.toMatch(/!/)
      expect(echo.components).toHaveLength(4)
    }
  })
})

describe('dose bandit', () => {
  test('Normal-Gamma update matches the closed form', () => {
    const p = ngUpdate({ mu: 0, kappa: 1, alpha: 2, beta: 10 }, [4, 6, 8])
    expect(p.kappa).toBe(4)
    expect(p.mu).toBeCloseTo(18 / 4)
    expect(p.alpha).toBe(3.5)
    expect(p.beta).toBeCloseTo(10 + 0.5 * 8 + (1 * 3 * 36) / (2 * 4))
    expect(ngBelief(p).sd).toBeLessThan(ngBelief({ mu: 0, kappa: 1, alpha: 2, beta: 10 }).sd) // evidence narrows it
  })

  test('the samplers have the right moments', () => {
    const rng = mulberry32(7)
    const g = Array.from({ length: 20000 }, () => randGamma(3.5, rng))
    const n = Array.from({ length: 20000 }, () => randNormal(rng))
    expect(g.reduce((a, b) => a + b) / g.length).toBeCloseTo(3.5, 1)
    expect(n.reduce((a, b) => a + b) / n.length).toBeCloseTo(0, 1)
    expect(n.reduce((a, b) => a + b * b, 0) / n.length).toBeCloseTo(1, 1)
  })

  test('Thompson sampling converges on the dose that truly works for the person', () => {
    const cases: [number, Record<DoseKind, number>][] = [
      [1, { breathe: 2, smile: 1, forest: 8, walk: 3, reach: 0, wait: 0 }],
      [2, { breathe: 7, smile: 2, forest: 1, walk: 2, reach: 3, wait: 0 }],
      [3, { breathe: 0, smile: 3, forest: 2, walk: 9, reach: 4, wait: 0 }],
      [4, { breathe: 3, smile: 2, forest: 3, walk: 1, reach: 8, wait: 0 }],
      [5, { breathe: -2, smile: 1, forest: 6, walk: 1.5, reach: 1, wait: 0 }],
    ]
    for (const [seed, truth] of cases) {
      const best = DOSES.reduce((a, b) => (truth[b] > truth[a] ? b : a))
      const rng = mulberry32(seed)
      const history: DoseRec[] = []
      const picks: DoseKind[] = []
      for (let i = 0; i < 80; i++) {
        const dose = thompson(posteriors(history, defaultPrior()), rng)
        picks.push(dose)
        history.push({ at: '', dose, felt: null, reward: truth[dose] + 4 * randNormal(rng) }) // noisy: sd 4 points
      }
      const late = picks.slice(-30).filter((d) => d === best).length
      expect(late).toBeGreaterThanOrEqual(24) // 80% of the late picks
      const b = beliefs(history, defaultPrior())
      expect(b.reduce((x, y) => (y.mean > x.mean ? y : x)).dose).toBe(best)
      expect(Math.abs(b.find((x) => x.dose === best)!.mean - truth[best])).toBeLessThan(2)
      // it kept exploring (six doses to try), but spent more than half of the 80 pulls on the winner
      expect(b.find((x) => x.dose === best)!.n).toBeGreaterThan(40)
    }
  })

  test('the suggestion says what it has learned', () => {
    const at = ''
    const history: DoseRec[] = [5, 6, -1, 4, 7].map((reward) => ({ at, dose: 'breathe' as const, reward, felt: null }))
    expect(doseReason('breathe', history, defaultPrior())).toBe('Slow breathing has lifted your echo 4 of the last 5 times.')
    expect(doseReason('forest', history, defaultPrior())).toContain("You haven't tried the forest yet")
    const s = suggest([...history, ...history, ...history], defaultPrior(), mulberry32(3))
    expect(DOSES).toContain(s.dose)
    expect(s.reason.length).toBeGreaterThan(20)
    expect(s.uncertainty).toBeGreaterThan(0)
    // same state, same draw: the suggestion does not flicker between two requests
    expect(suggest(history, defaultPrior(), mulberry32(9))).toEqual(suggest(history, defaultPrior(), mulberry32(9)))
  })

  test('identical repeated inputs stay inside the person wobble and never rank a dose', () => {
    const sig = base('clinic')
    const pings = [...sig, ping(10, 0), ping(11, 0), ping(12, 0), ping(13, 0)]
    const a = analyze(pings)
    expect(a.wobble).toBeGreaterThan(0)
    const history: DoseRec[] = DOSES.map((dose) => ({ at: '', dose, reward: 0, felt: null }))
    const s = suggest(history, defaultPrior(), mulberry32(4), a.wobble)
    expect(s.tooEarly).toBe(true)
    expect(s.reason).toContain('Too early to say')
  })

  test('the cohort prior is the cohort mean, worth one observation', () => {
    const rewards = [2, 4, 6, 8, 10].map((reward) => ({ dose: 'walk' as const, reward }))
    const prior = cohortPrior(rewards)
    expect(prior.walk).toMatchObject({ mu: 6, kappa: 1 })
    expect(prior.breathe).toEqual(defaultPrior().breathe) // too little data: default
    const one = beliefs([{ at: '', dose: 'walk', reward: 0, felt: null }], prior).find((b) => b.dose === 'walk')!
    expect(one.mean).toBe(3) // one observation against a prior worth one
  })

  test('reward = post strength - pre strength on the channels both pings measured', () => {
    const sig = base('clinic')
    const pre = ping(10, -1)
    const post = ping(10.01, { smile: 0.5, voice: null, heart: -0.5, move: null }, { kind: 'mini' })
    const a = analyze([...sig, pre, post])
    const r = doseReward(a.echoes.find((e) => e.pingId === pre.id), a.echoes.find((e) => e.pingId === post.id), null)!
    expect(r).toBeCloseTo((22.5 + 7.5) / 2, 0) // smile +1.5 z, heart +0.5 z
    // at the floor the strengths are both 0, but the lift is still measured
    const low = ping(11, -5)
    const lifted = ping(11.01, { smile: -4, voice: null, heart: -4, move: null }, { kind: 'mini' })
    const b = analyze([...sig, low, lifted])
    expect(b.echoes.at(-1)!.strength).toBe(0)
    expect(doseReward(b.echoes.at(-2), b.echoes.at(-1), null)).toBeCloseTo(15, 0)
    expect(doseReward(null, null, 1)).toBe(5)
    expect(doseReward(null, null, null)).toBeNull()
  })

  test('reward includes what the person said when a second echo exists', () => {
    const sig = base('clinic')
    const pre = ping(10, -1)
    const post = ping(10.01, { smile: 0.5, voice: null, heart: -0.5, move: null }, { kind: 'mini' })
    const a = analyze([...sig, pre, post])
    const measured = (22.5 + 7.5) / 2
    expect(doseReward(a.echoes.find((e) => e.pingId === pre.id), a.echoes.find((e) => e.pingId === post.id), 1)).toBeCloseTo(measured * 0.7 + 10 * 0.3, 1)
    expect(doseReward(a.echoes.find((e) => e.pingId === pre.id), a.echoes.find((e) => e.pingId === post.id), -1)).toBeCloseTo(measured * 0.7 - 10 * 0.3, 1)
  })
})

describe('synthetic cohort', () => {
  const now = Date.parse('2026-11-13T18:00:00Z')
  const people = generateCohort(now)
  const rows = people.map((p) => {
    const a = analyze(p.pings, p.course!.end)
    return { p, a, ...buildRow(p, a, { now, live: false, booster: false }) }
  })
  const of = (arch: string) => rows.filter((r) => r.p.archetype === arch)

  test('24 fictional people, deterministic, flagged synthetic', () => {
    expect(people).toHaveLength(24)
    expect(new Set(people.map((p) => p.id)).size).toBe(24)
    expect(people.every((p) => p.synthetic && /^[A-ZÄÖ][a-zäö]+ [A-Z]\.$/.test(p.name))).toBe(true)
    expect(JSON.stringify(generateCohort(now))).toBe(JSON.stringify(people))
    expect(of('steady').length).toBe(12)
    expect(of('drift').length).toBe(5)
    expect(of('drop').length).toBeGreaterThanOrEqual(2)
    expect(of('improving').length).toBeGreaterThanOrEqual(2)
    expect(of('quiet').length).toBeGreaterThanOrEqual(2)
  })

  test('history is stable as the clock moves: only new pings appear', () => {
    const later = generateCohort(now + 3 * 3600_000)
    for (const [i, p] of people.entries()) {
      const ids = new Set(later[i]!.pings.map((x) => x.id))
      expect(p.pings.every((x) => ids.has(x.id))).toBe(true)
    }
  })

  test('each course has 20-30 sessions over 4-6 weeks and a signature measured in its last two weeks', () => {
    for (const { p, a } of rows) {
      const c = p.course!
      const days = (Date.parse(c.end) - Date.parse(c.start)) / DAY
      expect(c.sessions).toBeGreaterThanOrEqual(20)
      expect(c.sessions).toBeLessThanOrEqual(30)
      expect(days).toBeGreaterThanOrEqual(27)
      expect(days).toBeLessThanOrEqual(43)
      const homeDays = (now - Date.parse(c.end)) / DAY
      expect(homeDays).toBeGreaterThan(13)
      expect(homeDays).toBeLessThan(114)
      for (const ch of CHANNELS) expect(a.baseline[ch].source).toBe('clinic')
      // the course moved the echo from flat to full
      const clinic = a.echoes.filter((e) => e.setting === 'clinic')
      expect(clinic[0]!.strength).toBeLessThan(40)
      expect(clinic.at(-1)!.strength).toBeGreaterThan(35)
    }
    const firsts = rows.map((r) => r.a.echoes[0]!.strength)
    expect(firsts.reduce((x, y) => x + y) / firsts.length).toBeLessThan(25)
  })

  test('raw values stay in plausible units', () => {
    const lim: Record<Channel, [number, number]> = { smile: [0.2, 4.2], voice: [0.8, 4.2], heart: [2.5, 19], move: [15, 125] }
    for (const p of people) {
      for (const x of p.pings) {
        for (const ch of CHANNELS) {
          const v = x.values[ch]
          if (v == null) continue
          expect(v).toBeGreaterThanOrEqual(lim[ch][0])
          expect(v).toBeLessThanOrEqual(lim[ch][1])
        }
      }
    }
  })

  test('archetypes read the way they were written', () => {
    for (const r of of('drift')) expect(['dipping', 'low']).toContain(r.a.status)
    expect(of('drift').some((r) => r.a.status === 'low')).toBe(true)
    for (const r of of('drop')) {
      expect(r.a.drift).toBeLessThan(-0.75)
      expect(r.row.reason).toContain('dropped sharply')
    }
    for (const r of of('improving')) expect(r.a.drift).toBeGreaterThan(0.5)
    for (const r of of('quiet')) {
      expect(r.facts.daysSilent!).toBeGreaterThanOrEqual(4)
      expect(r.row.reason).toMatch(/^AirPods not in for \d+ days/)
    }
    const steady = of('steady').filter((r) => r.a.status === 'steady').length
    expect(steady).toBeGreaterThanOrEqual(10)
  })

  test('a simulated person reads in the AirPods words, never the camera check', () => {
    const prior = cohortPrior([])
    for (const r of rows) {
      const detail = buildDetail(r.p, r.a, r.row, r.facts, prior)
      for (const text of [r.row.reason, detail.summary, r.row.outer?.note ?? '', r.row.outer?.sentence ?? '', r.row.outer?.working.text ?? '']) {
        expect(text).not.toMatch(/echo|\bping|signature|channel|voice|smil|camera/i)
      }
    }
  })

  test('silence and drift both put a person above the steady ones', () => {
    const steadyTop = Math.max(...of('steady').filter((r) => (r.facts.daysSilent ?? 0) < 3 && r.a.status === 'steady').map((r) => r.row.priority))
    for (const r of [...of('quiet'), ...of('drift'), ...of('drop')]) expect(r.row.priority).toBeGreaterThan(steadyTop)
    for (const r of rows) {
      expect(r.row.priority).toBeGreaterThanOrEqual(0)
      expect(r.row.priority).toBeLessThanOrEqual(1)
      expect(r.row.spark).toHaveLength(28)
      expect(r.row.reason).not.toMatch(/depress|diagnos|relaps/i)
    }
  })

  test("each person's bandit has found their own best dose", () => {
    const prior = cohortPrior(people.flatMap((p) => p.doses))
    const judged = people.filter((p) => p.doses.length >= 12)
    expect(judged.length).toBeGreaterThanOrEqual(12)
    const right = judged.filter((p) => beliefs(p.doses, prior).reduce((x, y) => (y.mean > x.mean ? y : x)).dose === p.truth.best)
    expect(right.length / judged.length).toBeGreaterThanOrEqual(0.8)
    expect(new Set(people.map((p) => p.truth.best)).size).toBe(4) // and they differ from person to person
    const top = (name: string) => beliefs(people.find((p) => p.name === name)!.doses, prior).reduce((x, y) => (y.mean > x.mean ? y : x)).dose
    expect(top('Aino K.')).toBe('forest')
    expect(top('Mikko L.')).toBe('walk')
  })

  test('traces line up with the protocol and the channel values', () => {
    const p = people[0]!.pings.filter((x) => x.kind === 'full').at(-1)!
    const t = synthTraces(p)
    expect(t.t).toHaveLength(580)
    for (const k of ['smile', 'cheek', 'headPitch', 'bpm', 'rms', 'f0'] as const) expect(t[k]).toHaveLength(580)
    expect(t.phases.map((x) => x.key)).toEqual(['settle', 'nod', 'laugh', 'speak', 'breathe'])
    expect(t.phases.map((x) => x.at)).toEqual([0, 8000, 14000, 26000, 38000])
    const restSmile = t.smile.slice(0, 80).reduce((a, b) => a + b) / 80
    const auc = t.smile.slice(140, 260).reduce((a, b) => a + Math.max(0, b - restSmile), 0) / 10
    expect(auc).toBeGreaterThan(p.values.smile! * 0.6)
    expect(auc).toBeLessThan(p.values.smile! * 1.4)
    const breath = t.bpm.slice(400).filter((x): x is number => x != null)
    if (p.values.heart != null) expect(Math.max(...breath) - Math.min(...breath)).toBeGreaterThan(p.values.heart * 0.7)
    expect(JSON.stringify(synthTraces(p))).toBe(JSON.stringify(t))
    expect(synthTraces(people[0]!.pings.find((x) => x.kind === 'mini')!).t).toHaveLength(180)
  })
})

describe('clinic', () => {
  test('priority rises with drift, status, a falling week and silence', () => {
    expect(priorityOf(0.2, 'steady', 0, 0)).toBe(0)
    expect(priorityOf(-1, 'dipping', 0, 0)).toBeGreaterThan(priorityOf(-0.5, 'steady', 0, 0))
    expect(priorityOf(-2, 'low', 0, 0)).toBeGreaterThan(priorityOf(-2, 'dipping', 0, 0))
    expect(priorityOf(-1, 'dipping', -6, 0)).toBeGreaterThan(priorityOf(-1, 'dipping', 0, 0))
    let last = -1
    for (const silent of [0, 1, 2, 4, 6, 9]) {
      const p = priorityOf(0, 'steady', 0, silent)
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
    expect(priorityOf(0, 'steady', 0, 5)).toBeGreaterThan(0.4) // silence alone is a reason to call
    expect(priorityOf(-9, 'low', -9, 99)).toBeLessThanOrEqual(1)
  })

  test('slope is a least-squares fit', () => {
    expect(slope([[0, 1], [1, 3], [2, 5]])).toBeCloseTo(2)
    expect(slope([[0, 1], [1, 3]])).toBe(0)
  })

  test('the reason is one specific line', () => {
    const sig = base('clinic')
    const now = T0 + 20 * DAY
    const drifting = [...sig, ...[11, 12, 13, 14, 15, 16, 17, 18, 19].map((d, i) => ping(d, { smile: -0.6 * (i + 1), voice: -0.5 * (i + 1), heart: 0, move: 0 }))]
    const person = { id: 'x', name: 'Test T.', synthetic: false, course: null, pings: drifting, doses: [] }
    const a = analyze(drifting)
    const f = rowFacts(person, a, now)
    const line = reasonOf(a, f, 7)
    // a real phone did the one-minute camera check: its readings keep what was measured
    expect(line).toMatch(/^Below their usual for \d+ days; smile and voice both below their usual; last camera check yesterday$/)
    // a simulated person is simulated days with AirPods in: the same facts in the AirPods words
    const sim = reasonOf(a, rowFacts({ ...person, synthetic: true }, a, now), 7)
    expect(sim).toMatch(/^Below their usual for \d+ days; fewer walks and head down longer; AirPods last in yesterday$/)
    expect(sim).not.toMatch(/echo|ping|signature|channel|voice|smile/i)
    const { row } = buildRow(person, a, { now, live: true, booster: true })
    expect(row).toMatchObject({ synthetic: false, live: true, boosterRequested: true, daysSinceCourse: null })
    expect(buildRow({ ...person, pings: [] }, analyze([]), { now, live: false, booster: false }).row).toMatchObject({ status: 'calibrating', strength: null, lastPingAt: null, reason: 'No camera checks yet' })
  })

  test('clinic sentence templates use the same latest echo fact everywhere', () => {
    const now = Date.parse('2026-11-14T12:00:00Z')
    const cohortPeople = generateCohort(now)
    const prior = cohortPrior(cohortPeople.flatMap((x) => x.doses))
    for (const p of cohortPeople) {
      const a = analyze(p.pings, p.course?.end)
      const { row, facts } = buildRow(p, a, { now, live: false, booster: false })
      const detail = buildDetail(p, a, row, facts, prior)
      const current = echoNow(a)
      for (const text of [row.reason, summaryOf(p, a, row, facts, prior)]) {
        const match = /(?:now|sat at|echo is) (\d+)\/?100/.exec(text)
        if (match) expect(Number(match[1])).toBe(current)
      }
      expect(detail.strength).toBe(row.strength)
    }
  })
})
