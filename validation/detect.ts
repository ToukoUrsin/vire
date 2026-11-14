/**
 * Detection simulation for Vire's clinic short list.
 *
 * This file deliberately calls server/engine.ts for baseline, z, EWMA and status math.
 * It does not copy the detector into the simulator. Run with `bun validation/detect.ts`.
 */
import { analyze, CHANNELS, EWMA_ALPHA, LOW, DIP, PRIORS, mulberry32, randNormal } from '../server/engine'
import type { Channel } from '../shared/types'
import type { PingRec } from '../server/engine'

const DAY_MS = 86_400_000

// ---------- named assumptions ----------

export const SEED = 20261114
export const PEOPLE_PER_CELL = 4000
export const HOME_DAYS = 84
export const BASELINE_DAYS = 14
export const RELAPSE_RAMP_DAYS = 14
export const ONSET_MIN_DAY = 14
export const ONSET_MAX_DAY = 56
export const ADHERENCE_LEVELS = [1, 0.7, 0.5] as const
export const DELTAS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2] as const
export const SLIDE_VARIANTS = ['all', 'smile_move'] as const

/** One ping per home day is the product's intended cadence; these are missing-day rates. */
export const ADHERENCE = { full: 1, usual: 0.7, low: 0.5 } as const
/** Noise is measured in that person's own day-to-day spread, before the detector's MAD floor. */
export const NOISE_SD_IN_SPREADS = 0.55
/** Slow non-relapse movement: stationary AR(1) standard deviation in person-spreads. */
export const WOBBLE_SD_IN_SPREADS = 0.35
export const WOBBLE_RHO = 0.9
/** Read rates from validation.json where available; voice and move are explicit planning assumptions. */
export const CHANNEL_READ_RATE: Record<Channel, number> = { smile: 0.932, voice: 0.9, heart: 0.719, move: 0.9 }
/** Weekly questionnaire noise, deliberately favourable to the questionnaire. */
export const QUESTIONNAIRE_NOISE_SD_IN_SPREADS = 0.45
export const QUESTIONNAIRE_DAYS = 7
export const START_ISO = '2026-01-01T12:00:00.000Z'

export interface PersonParams {
  center: Record<Channel, number>
  spread: Record<Channel, number>
}

export interface SimulatedPerson {
  pings: PingRec[]
  onsetDay: number
  homeDays: number[]
  params: PersonParams
}

export interface FlagSummary {
  within7Pct: number
  within14Pct: number
  within28Pct: number
  medianDays: number | null
  q1Days: number | null
  q3Days: number | null
  flaggedPeople: number
}

export interface FalseSummary {
  episodesPerPersonYear: number
  everFlagged12WeeksPct: number
}

export interface QuestionnaireSummary {
  threshold: number
  falseEpisodesPerPersonYear: number
  falseEverFlagged12WeeksPct: number
  medianDays: number | null
  q1Days: number | null
  q3Days: number | null
  flaggedPeople: number
}

export interface DetectCell {
  kind: 'vire'
  seed: number
  people: number
  adherence: number
  wobble: boolean
  slideChannels: 'all' | 'smile_move'
  delta: number
  detection: { low: FlagSummary; dippingOrLow: FlagSummary }
  falseFlags: { low: FalseSummary; dippingOrLow: FalseSummary }
  questionnaire: QuestionnaireSummary | null
}

export interface DetectOutput {
  generatedAt: string
  gitCommit: string
  seed: number
  peoplePerCell: number
  homeDays: number
  assumptions: Record<string, unknown>
  cells: DetectCell[]
  chart: {
    adherence: number
    wobble: boolean
    slideChannels: 'all' | 'smile_move'
    falseFlags: FalseSummary
    rows: Array<{
      delta: number
      vire: FlagSummary
      questionnaire: QuestionnaireSummary
    }>
  }
}

const channelHasSlide = (channel: Channel, variant: 'all' | 'smile_move') => variant === 'all' || channel === 'smile' || channel === 'move'
const isoForDay = (day: number) => new Date(Date.parse(START_ISO) + day * DAY_MS).toISOString()
const pick = (rng: () => number, p: number) => rng() < p
const round = (x: number, places = 3) => {
  const k = 10 ** places
  return Math.round(x * k) / k
}
const percentile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo)
}

/** Linear relapse slide: zero before onset, delta below baseline after 14 days, then held. */
export function slideAt(day: number, onsetDay: number, delta: number): number {
  if (onsetDay < 0 || day < onsetDay) return 0
  return -delta * Math.min(1, (day - onsetDay + 1) / RELAPSE_RAMP_DAYS)
}

/** One stationary AR(1) step. The zero-wobble path is exactly zero, which makes reruns comparable. */
export function wobbleStep(previous: number, rng: () => number, enabled: boolean): number {
  if (!enabled) return 0
  const innovation = randNormal(rng)
  return WOBBLE_RHO * previous + Math.sqrt(1 - WOBBLE_RHO ** 2) * WOBBLE_SD_IN_SPREADS * innovation
}

export function makePersonParams(rng: () => number): PersonParams {
  const center = {} as Record<Channel, number>
  const spread = {} as Record<Channel, number>
  for (const channel of CHANNELS) {
    const prior = PRIORS[channel]
    center[channel] = prior.center + prior.spread * 0.5 * randNormal(rng)
    spread[channel] = prior.spread * Math.exp(0.12 * randNormal(rng))
  }
  return { center, spread }
}

function valueFor(params: PersonParams, channel: Channel, latentLevel: number, noise: number): number {
  return params.center[channel] + params.spread[channel] * (latentLevel + noise)
}

/** Generate clinic calibration pings followed by home pings for one made-up person. */
export function simulatePerson(
  rng: () => number,
  adherence: number,
  delta: number,
  wobble: boolean,
  slideChannels: 'all' | 'smile_move',
  personIndex = 0,
): SimulatedPerson {
  const params = makePersonParams(rng)
  const onsetDay = delta > 0 ? ONSET_MIN_DAY + Math.floor(rng() * (ONSET_MAX_DAY - ONSET_MIN_DAY + 1)) : -1
  const pings: PingRec[] = []
  const wobbleByChannel = {} as Record<Channel, number>
  for (const channel of CHANNELS) wobbleByChannel[channel] = 0

  const addPing = (homeDay: number, setting: 'clinic' | 'home', include: boolean) => {
    if (!include) return
    const values = {} as Record<Channel, number | null>
    for (const channel of CHANNELS) {
      wobbleByChannel[channel] = wobbleStep(wobbleByChannel[channel]!, rng, wobble)
      const slide = setting === 'home' && channelHasSlide(channel, slideChannels) ? slideAt(homeDay, onsetDay, delta) : 0
      values[channel] = pick(rng, CHANNEL_READ_RATE[channel])
        ? valueFor(params, channel, wobbleByChannel[channel]! + slide, NOISE_SD_IN_SPREADS * randNormal(rng))
        : null
    }
    pings.push({ id: `sim-${personIndex}-${setting}-${homeDay}`, at: isoForDay(homeDay), setting, kind: 'full', values })
  }

  // Fourteen clinic pings define the well signature in computeBaseline().
  for (let day = -BASELINE_DAYS; day < 0; day++) addPing(day, 'clinic', true)
  for (let day = 0; day < HOME_DAYS; day++) addPing(day, 'home', pick(rng, adherence))
  return { pings, onsetDay, homeDays: Array.from({ length: HOME_DAYS }, (_, i) => i), params }
}

function firstFlagDaysBoth(pings: PingRec[], onsetDay: number): { low: number | null; dippingOrLow: number | null } {
  if (onsetDay < 0) return { low: null, dippingOrLow: null }
  const analysis = analyze(pings, isoForDay(-1))
  let low: number | null = null
  let dippingOrLow: number | null = null
  for (const echo of analysis.echoes) {
    if (echo.setting !== 'home' || echo.kind !== 'full') continue
    const homeDay = Number(echo.pingId.split('-').at(-1))
    if (homeDay < onsetDay) continue
    if (low === null && echo.status === 'low') low = homeDay - onsetDay
    if (dippingOrLow === null && (echo.status === 'dipping' || echo.status === 'low')) dippingOrLow = homeDay - onsetDay
    if (low !== null && dippingOrLow !== null) break
  }
  return { low, dippingOrLow }
}

function falseEpisodeCount(pings: PingRec[], kind: 'low' | 'dippingOrLow'): { episodes: number; ever: boolean } {
  const analysis = analyze(pings, isoForDay(-1))
  let episodes = 0
  let active = false
  for (const echo of analysis.echoes) {
    if (echo.setting !== 'home' || echo.kind !== 'full') continue
    const flagged = kind === 'low' ? echo.status === 'low' : echo.status === 'dipping' || echo.status === 'low'
    if (flagged && !active) episodes++
    active = flagged
  }
  return { episodes, ever: episodes > 0 }
}

export function summariseFlags(days: Array<number | null>): FlagSummary {
  const finite = days.filter((d): d is number => d != null)
  return {
    within7Pct: round((finite.filter((d) => d <= 7).length / days.length) * 100, 2),
    within14Pct: round((finite.filter((d) => d <= 14).length / days.length) * 100, 2),
    within28Pct: round((finite.filter((d) => d <= 28).length / days.length) * 100, 2),
    medianDays: percentile(finite, 0.5) === null ? null : round(percentile(finite, 0.5)!, 2),
    q1Days: percentile(finite, 0.25) === null ? null : round(percentile(finite, 0.25)!, 2),
    q3Days: percentile(finite, 0.75) === null ? null : round(percentile(finite, 0.75)!, 2),
    flaggedPeople: finite.length,
  }
}

function summariseFalse(xs: Array<{ episodes: number; ever: boolean }>): FalseSummary {
  const people = xs.length
  const episodes = xs.reduce((sum, x) => sum + x.episodes, 0)
  return {
    episodesPerPersonYear: round((episodes / people) * (365 / HOME_DAYS), 4),
    everFlagged12WeeksPct: round((xs.filter((x) => x.ever).length / people) * 100, 2),
  }
}

export function questionnaireEpisodes(values: number[], threshold: number): { episodes: number; ever: boolean } {
  let episodes = 0
  let active = false
  for (const value of values) {
    const flagged = value <= threshold
    if (flagged && !active) episodes++
    active = flagged
  }
  return { episodes, ever: episodes > 0 }
}

function simulateQuestionnaire(rng: () => number, delta: number, onsetDay: number, threshold: number, slideChannels: 'all' | 'smile_move') {
  const values: number[] = []
  for (let day = 0; day < HOME_DAYS; day += QUESTIONNAIRE_DAYS) {
    // The questionnaire sees the same underlying slide, averaged across channels; noise is generous to it.
    const latent = delta === 0 ? 0 : slideAt(day, onsetDay, delta)
    const variantFactor = slideChannels === 'smile_move' ? 0.5 : 1
    values.push(latent * variantFactor + QUESTIONNAIRE_NOISE_SD_IN_SPREADS * randNormal(rng))
  }
  return values
}

function detectionSummary(
  rng: () => number,
  delta: number,
  adherence: number,
  wobble: boolean,
  slideChannels: 'all' | 'smile_move',
  people = PEOPLE_PER_CELL,
): DetectCell {
  const lowDays: Array<number | null> = []
  const dipDays: Array<number | null> = []
  const lowFalse: Array<{ episodes: number; ever: boolean }> = []
  const dipFalse: Array<{ episodes: number; ever: boolean }> = []
  for (let i = 0; i < people; i++) {
    const sim = simulatePerson(rng, adherence, delta, wobble, slideChannels, i)
    if (delta > 0) {
      const flags = firstFlagDaysBoth(sim.pings, sim.onsetDay)
      lowDays.push(flags.low)
      dipDays.push(flags.dippingOrLow)
    } else {
      lowFalse.push(falseEpisodeCount(sim.pings, 'low'))
      dipFalse.push(falseEpisodeCount(sim.pings, 'dippingOrLow'))
    }
  }
  const noRelapseLow = delta === 0 ? summariseFalse(lowFalse) : { episodesPerPersonYear: 0, everFlagged12WeeksPct: 0 }
  const noRelapseDip = delta === 0 ? summariseFalse(dipFalse) : { episodesPerPersonYear: 0, everFlagged12WeeksPct: 0 }
  return {
    kind: 'vire',
    seed: SEED,
    people,
    adherence,
    wobble,
    slideChannels,
    delta,
    detection: { low: summariseFlags(lowDays), dippingOrLow: summariseFlags(dipDays) },
    falseFlags: { low: noRelapseLow, dippingOrLow: noRelapseDip },
    questionnaire: null,
  }
}

function questionnaireCalibration(rng: () => number, targetFalseRate: number, people = PEOPLE_PER_CELL): { threshold: number; false: FalseSummary } {
  const sequences = Array.from({ length: people }, () => simulateQuestionnaire(rng, 0, -1, 0, 'all'))
  let bestThreshold = -1
  let best: FalseSummary | null = null
  let bestDistance = Infinity
  for (let i = 0; i <= 400; i++) {
    const threshold = -4 + i * 0.01
    const summary = summariseFalse(sequences.map((values) => questionnaireEpisodes(values, threshold)))
    const distance = Math.abs(summary.episodesPerPersonYear - targetFalseRate)
    if (distance < bestDistance) {
      bestDistance = distance
      bestThreshold = threshold
      best = summary
    }
  }
  return { threshold: round(bestThreshold, 2), false: best! }
}

function questionnaireSummary(
  rng: () => number,
  threshold: number,
  falseSummary: FalseSummary,
  delta: number,
  slideChannels: 'all' | 'smile_move',
  people = PEOPLE_PER_CELL,
): QuestionnaireSummary {
  const days: Array<number | null> = []
  let flaggedPeople = 0
  for (let i = 0; i < people; i++) {
    const onset = ONSET_MIN_DAY + Math.floor(rng() * (ONSET_MAX_DAY - ONSET_MIN_DAY + 1))
    const values = simulateQuestionnaire(rng, delta, onset, threshold, slideChannels)
    const first = values.findIndex((value, index) => value <= threshold && index * QUESTIONNAIRE_DAYS >= onset)
    if (first >= 0) {
      days.push(first * QUESTIONNAIRE_DAYS - onset)
      flaggedPeople++
    } else days.push(null)
  }
  const summary = summariseFlags(days)
  return { threshold, falseEpisodesPerPersonYear: falseSummary.episodesPerPersonYear, falseEverFlagged12WeeksPct: falseSummary.everFlagged12WeeksPct, ...summary }
}

/** Sanity checks requested for the evidence run; fail loudly if a rerun changes the ordering. */
export function assertGridMakesSense(cells: DetectCell[]): void {
  for (const slideChannels of SLIDE_VARIANTS) {
    for (const wobble of [false, true]) {
      const group = cells.filter((c) => c.slideChannels === slideChannels && c.wobble === wobble)
      for (const adherence of ADHERENCE_LEVELS) {
        const rows = group.filter((c) => c.adherence === adherence && c.delta > 0).sort((a, b) => a.delta - b.delta)
        for (let i = 1; i < rows.length; i++) {
          const before = rows[i - 1]!.detection.dippingOrLow.medianDays
          const after = rows[i]!.detection.dippingOrLow.medianDays
          if (before !== null && after !== null && after > before) throw new Error(`larger delta was slower (${slideChannels}, wobble=${wobble}, adherence=${adherence})`)
        }
      }
      for (const delta of DELTAS.filter((x) => x > 0)) {
        const rows = group.filter((c) => c.delta === delta).sort((a, b) => b.adherence - a.adherence)
        for (let i = 1; i < rows.length; i++) {
          const moreAdherent = rows[i - 1]!.detection.dippingOrLow.medianDays
          const lessAdherent = rows[i]!.detection.dippingOrLow.medianDays
          if (moreAdherent !== null && lessAdherent !== null && lessAdherent < moreAdherent) throw new Error(`lower adherence was faster (${slideChannels}, wobble=${wobble}, delta=${delta})`)
        }
      }
    }
  }
  for (const cell of cells.filter((c) => c.delta === 0)) {
    if (cell.detection.low.flaggedPeople !== 0 || cell.detection.dippingOrLow.flaggedPeople !== 0) throw new Error('zero-effect cell was treated as a relapse')
  }
}

function gitCommit(): string {
  try {
    const p = Bun.spawnSync(['git', 'rev-parse', 'HEAD'])
    const value = new TextDecoder().decode(p.stdout).trim()
    return value || 'working-tree'
  } catch {
    return 'working-tree'
  }
}

export function runSimulation(): DetectOutput {
  const cells: DetectCell[] = []
  // Calibrate the questionnaire at the practical Vire operating point (0.7 adherence, no wobble, all channels).
  const reference = detectionSummary(mulberry32(SEED ^ 0x51f), 0, 0.7, false, 'all')
  const questionnaireCalibrationResult = questionnaireCalibration(mulberry32(SEED ^ 0x771), reference.falseFlags.dippingOrLow.episodesPerPersonYear)

  for (const slideChannels of SLIDE_VARIANTS) {
    for (const wobble of slideChannels === 'all' ? [false, true] : [false]) {
      for (const adherence of ADHERENCE_LEVELS) {
        for (const delta of DELTAS) {
          const cellSeed = SEED ^ Math.round(delta * 100) ^ Math.round(adherence * 1000) ^ (wobble ? 0x10000 : 0) ^ (slideChannels === 'all' ? 0 : 0x20000)
          const cell = detectionSummary(mulberry32(cellSeed), delta, adherence, wobble, slideChannels)
          if (delta > 0) {
            const q = questionnaireSummary(
              mulberry32(cellSeed ^ 0xabc000),
              questionnaireCalibrationResult.threshold,
              questionnaireCalibrationResult.false,
              delta,
              slideChannels,
            )
            cell.questionnaire = q
          } else {
            cell.questionnaire = {
              threshold: questionnaireCalibrationResult.threshold,
              falseEpisodesPerPersonYear: questionnaireCalibrationResult.false.episodesPerPersonYear,
              falseEverFlagged12WeeksPct: questionnaireCalibrationResult.false.everFlagged12WeeksPct,
              medianDays: null,
              q1Days: null,
              q3Days: null,
              flaggedPeople: 0,
            }
          }
          cells.push(cell)
        }
      }
    }
  }
  const chartCells = cells.filter((c) => c.adherence === 0.7 && !c.wobble && c.slideChannels === 'all')
  assertGridMakesSense(cells)
  const chartFalse = chartCells.find((c) => c.delta === 0)!.falseFlags.dippingOrLow
  return {
    generatedAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    seed: SEED,
    peoplePerCell: PEOPLE_PER_CELL,
    homeDays: HOME_DAYS,
    assumptions: {
      baseline: `${BASELINE_DAYS} clinic pings, one per day, used by computeBaseline as the well signature`,
      adherence: ADHERENCE_LEVELS,
      noiseSdInPersonSpreads: NOISE_SD_IN_SPREADS,
      wobble: { enabledAndDisabled: true, rho: WOBBLE_RHO, stationarySdInPersonSpreads: WOBBLE_SD_IN_SPREADS },
      channelReadRate: CHANNEL_READ_RATE,
      relapse: { rampDays: RELAPSE_RAMP_DAYS, deltaPersonSpreads: DELTAS, onsetDays: [ONSET_MIN_DAY, ONSET_MAX_DAY], slideVariants: SLIDE_VARIANTS },
      questionnaire: { cadenceDays: QUESTIONNAIRE_DAYS, noiseSdInPersonSpreads: QUESTIONNAIRE_NOISE_SD_IN_SPREADS, threshold: questionnaireCalibrationResult.threshold, generousNoiseNote: 'one scalar answer per week with less noise than a single daily channel' },
      detector: { ewmaAlpha: EWMA_ALPHA, dippingBelow: DIP, lowBelow: LOW, lowRunDays: 3 },
      falseCallDefinition: 'an episode starts when a person enters the named status after a home ping that was not already flagged',
    },
    cells,
    chart: {
      adherence: 0.7,
      wobble: false,
      slideChannels: 'all',
      falseFlags: chartFalse,
      rows: chartCells.filter((c) => c.delta > 0).map((c) => ({ delta: c.delta, vire: c.detection.dippingOrLow, questionnaire: c.questionnaire! })),
    },
  }
}

function jsonl(output: DetectOutput): string {
  return output.cells.map((cell) => JSON.stringify(cell)).join('\n') + '\n'
}

export async function writeOutputs(output: DetectOutput): Promise<void> {
  await Bun.write(new URL('./detect.jsonl', import.meta.url), jsonl(output))
  await Bun.write(new URL('../web/public/detect.json', import.meta.url), JSON.stringify(output, null, 2) + '\n')
}

if (import.meta.main) {
  const output = runSimulation()
  await writeOutputs(output)
  const practical = output.chart
  console.log(JSON.stringify({
    seed: output.seed,
    peoplePerCell: output.peoplePerCell,
    gitCommit: output.gitCommit,
    falseFlags: practical.falseFlags,
    chart: practical.rows.map((r) => ({ delta: r.delta, vireMedianDays: r.vire.medianDays, questionnaireMedianDays: r.questionnaire.medianDays })),
  }, null, 2))
}
