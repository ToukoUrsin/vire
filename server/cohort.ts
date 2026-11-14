// Synthetic cohort: 50 fictional patients, generated deterministically from a seed with dates relative to "now".
// Everything here is flagged synthetic: true in the API. No real person is represented.
import type { BoosterBooking, Channel, DoseKind, PhaseKey, PingKind, PingTraces, PHQ2Check, PracticeKind, PracticeRec } from '../shared/types'
import { COHORT_SEED } from '../shared/cohort'
import { learn } from '../shared/earlearn'
import {
  CHANNELS,
  DEFAULT_NG,
  DOSES,
  TZ_OFFSET_MS,
  analyze,
  clamp,
  dayIndex,
  doseReward,
  hashSeed,
  mulberry32,
  ngSample,
  ngUpdate,
  randNormal,
  round,
} from './engine'
import type { DoseRec, Person, PingRec, Rng } from './engine'
import { DIP } from './engine'

/** boosted: drifted in spite of practices, had a booster session (simulated) and the line after it is simulated too */
export type Archetype = 'steady' | 'drift' | 'drop' | 'improving' | 'quiet' | 'boosted'

export interface SynthPerson extends Person {
  archetype: Archetype
  /** the generator's ground truth, for tests and the demo script only */
  truth: { effects: Record<DoseKind, number>; best: DoseKind; practice: PracticeKind }
  /** every practice the phone offered (the inner loop), simulated */
  practices: PracticeRec[]
  /** a booster that is part of this simulated person's story */
  booster: BoosterBooking | null
}

const DAY = 86400_000
const HOUR = 3600_000

// name, archetype, best dose (null = drawn from the seed)
export const ROSTER: [string, Archetype, DoseKind | null][] = [
  ['Aino K.', 'drift', 'forest'],
  ['Mikko L.', 'steady', 'walk'],
  ['Eino P.', 'steady', 'breathe'],
  ['Helmi S.', 'drop', 'reach'],
  ['Onni V.', 'steady', null],
  ['Aada M.', 'improving', 'walk'],
  ['Väinö H.', 'quiet', null],
  ['Lumi T.', 'steady', 'forest'],
  ['Eero N.', 'drift', 'breathe'],
  ['Siiri R.', 'steady', null],
  ['Toivo J.', 'steady', 'reach'],
  ['Venla A.', 'drift', null],
  ['Ilmari K.', 'steady', null],
  ['Kerttu L.', 'steady', 'breathe'],
  ['Oskari M.', 'drop', null],
  ['Elsa H.', 'steady', null],
  ['Veikko S.', 'boosted', null],
  ['Pihla R.', 'steady', 'walk'],
  ['Juho T.', 'drift', 'walk'],
  ['Enni V.', 'quiet', 'forest'],
  ['Lauri P.', 'steady', null],
  ['Saimi N.', 'improving', 'forest'],
  ['Antti J.', 'drift', null],
  ['Hilla O.', 'steady', 'reach'],
  ['Aleksi R.', 'steady', null],
  ['Sanna E.', 'steady', null],
  ['Jere K.', 'steady', null],
  ['Noora P.', 'steady', null],
  ['Rasmus L.', 'steady', null],
  ['Iida V.', 'steady', null],
  ['Matias H.', 'steady', null],
  ['Saara M.', 'steady', null],
  ['Niklas T.', 'steady', null],
  ['Johanna A.', 'steady', null],
  ['Kasperi N.', 'steady', null],
  ['Emilia O.', 'steady', null],
  ['Ville S.', 'steady', null],
  ['Ronja J.', 'steady', null],
  ['Markus U.', 'steady', null],
  ['Anni K.', 'steady', null],
  ['Roope D.', 'steady', null],
  ['Linnea F.', 'steady', null],
  ['Tuomas G.', 'steady', null],
  ['Nea I.', 'steady', null],
  ['Joonas C.', 'steady', null],
  ['Vilma B.', 'steady', null],
  ['Elias W.', 'steady', null],
  ['Pinja Y.', 'steady', null],
  ['Arttu Z.', 'steady', null],
  ['Oona Q.', 'steady', null],
]
// where each slow drifter ends up today, in SD of their own signature: a mix of dipping and low
const DRIFT_TARGETS = [-2.4, -1.5, -1.9, -1.7, -2.5]

// ---- the outer loop's story (practices, a booster), pinned per person so the demo reads the same every day ----
// steady people whose usual dipped for about a week and came back while they did practices: [starts, lasts, depth]
const DIPS: Record<string, [number, number, number]> = { 'Mikko L.': [27, 9, -2.1], 'Lumi T.': [21, 8, -2.0], 'Kerttu L.': [36, 9, -2.2] }
// the practice that settles each person most in the moment (others: drawn)
const BEST_PRACTICE: Record<string, PracticeKind> = { 'Aino K.': 'breathe', 'Mikko L.': 'walk', 'Lumi T.': 'scan', 'Kerttu L.': 'breathe', 'Eero N.': 'breathe', 'Veikko S.': 'scan', 'Juho T.': 'walk' }
// how often an offered practice is done (others: drawn); Venla is offered them and mostly does not do them
const PRACTICE_DONE: Record<string, number> = { 'Aino K.': 0.85, 'Eero N.': 0.8, 'Juho T.': 0.75, 'Venla A.': 0.15, 'Veikko S.': 0.85, 'Antti J.': 0.7 }
// Antti's drift met the rule and the (simulated) clinic booked a booster for the next working day but one
const SEEDED_BOOKING = 'Antti J.'
// the boosted person's booster session was this many days ago
const BOOSTER_AGO = 15
const PRACTICES: PracticeKind[] = ['breathe', 'scan', 'walk']

const RANGE: Record<Channel, [number, number]> = { smile: [0.2, 4.2], voice: [0.8, 4.2], heart: [2.5, 19], move: [15, 125] }
const CENTER: Record<Channel, [number, number]> = { smile: [1.3, 3.0], voice: [1.9, 3.3], heart: [7, 14], move: [55, 98] }

const uni = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo)
const smooth = (x: number) => {
  const t = clamp(x, 0, 1)
  return t * t * (3 - 2 * t)
}
/** epoch ms of `hour` o'clock (Helsinki) on day index `day` */
const atDay = (day: number, hour: number) => day * DAY - TZ_OFFSET_MS + hour * HOUR

export function synthId(name: string): string {
  const a = hashSeed(`vire:${name}`).toString(16).padStart(8, '0')
  const b = hashSeed(`${name}:eriv`).toString(16).padStart(8, '0')
  return (a + b).slice(0, 12)
}

function makePerson(name: string, archetype: Archetype, bestIn: DoseKind | null, target: number, now: number, seed: number): SynthPerson {
  const rng = mulberry32(hashSeed(name) ^ seed)
  const id = synthId(name)
  const today = dayIndex(now)
  const nowHour = (now + TZ_OFFSET_MS - today * DAY) / HOUR

  // ---- course ----
  let homeDays = 14 + Math.floor(rng() * 99) // 2..16 weeks at home
  if (archetype === 'drift' || archetype === 'improving' || archetype === 'boosted') homeDays = Math.max(homeDays, 56)
  if (DIPS[name]) homeDays = Math.max(homeDays, DIPS[name][0] + 21)
  if (archetype === 'quiet') homeDays = Math.max(homeDays, 26)
  const courseDays = 28 + Math.floor(rng() * 15) // 4..6 weeks
  const sessions = clamp(Math.round((courseDays / 7) * 5) - Math.floor(rng() * 2), 20, 30)
  const endDay = today - homeDays
  const startDay = endDay - courseDays

  // ---- the person ----
  const center = {} as Record<Channel, number>
  const sd = {} as Record<Channel, number>
  const load = {} as Record<Channel, number>
  for (const ch of CHANNELS) {
    center[ch] = uni(rng, CENTER[ch][0], CENTER[ch][1])
    sd[ch] = center[ch] * uni(rng, 0.11, 0.16)
  }
  // which channels carry a change: smile and voice usually lead, heart least; normalised to mean 1
  const raw = { smile: uni(rng, 0.9, 1.5), voice: uni(rng, 0.7, 1.4), heart: uni(rng, 0.2, 0.9), move: uni(rng, 0.4, 1.2) }
  const lead = name === 'Aino K.' // the demo's lead case is pinned, not left to the seed: smile and voice go first, over 18 days
  if (lead) Object.assign(raw, { smile: 1.5, voice: 1.35, heart: 0.3, move: 0.7 })
  const rawMean = (raw.smile + raw.voice + raw.heart + raw.move) / 4
  for (const ch of CHANNELS) load[ch] = raw[ch] / rawMean
  const illZ = uni(rng, -2.8, -1.9)
  const drawn = archetype === 'steady' && rng() < 0.25 ? uni(rng, 0.5, 0.65) : uni(rng, 0.74, 0.96)
  const adherence = lead ? 0.92 : drawn
  const habitHour = uni(rng, 7.5, 19.5)
  const restBpm = uni(rng, 58, 78)

  // the simulated people were generated before 'smile' existed: leaving it out keeps every one of them as they were
  const cohortDoses = DOSES.filter((d) => d !== 'smile')
  const trialDoses = cohortDoses.filter((d) => d !== 'wait')
  const best: DoseKind = bestIn ?? trialDoses[Math.floor(rng() * trialDoses.length)]!
  const effects = {} as Record<DoseKind, number>
  for (const d of cohortDoses) effects[d] = d === best ? uni(rng, 7, 10) : uni(rng, -1.5, 3)
  effects.smile = 0
  const doseNoise = uni(rng, 2.5, 4)

  const value = (ch: Channel, z: number, noise = 1) =>
    round(clamp(center[ch] + sd[ch] * (z * load[ch] + noise * randNormal(rng)), RANGE[ch][0], RANGE[ch][1]), 2)

  const pings: (PingRec & { rest: number })[] = []
  const doseDrafts: { at: string; dose: DoseKind; pre: string; post: string; felt: number | null }[] = []

  // ---- clinic pings, about twice a week while the echo climbs; the last two weeks sit at the well level ----
  const rampDays = courseDays - 14
  const clinicDays: number[] = []
  for (let d = 1, step = 3; d < rampDays; d += step, step = step === 3 ? 4 : 3) clinicDays.push(d)
  // calibration fortnight: every other day, so the signature rests on seven pings rather than four
  for (let d = courseDays - 13; d <= courseDays; d += 2) clinicDays.push(d)
  for (const [i, d] of clinicDays.entries()) {
    const z = illZ * (1 - smooth(d / rampDays))
    const values = {} as Record<Channel, number | null>
    for (const ch of CHANNELS) values[ch] = value(ch, z / load[ch], 0.7) // illness flattens every channel alike; the clinic is a quiet room
    pings.push({ id: `${id}-c${i}`, at: new Date(atDay(startDay + d, uni(rng, 9, 15))).toISOString(), setting: 'clinic', kind: 'full', values, rest: restBpm })
  }

  // ---- latent state at home ----
  const quietDays = archetype === 'quiet' ? 4 + Math.floor(rng() * 6) : 0
  const drawnOnset = archetype === 'drift' ? 14 + Math.floor(rng() * 8) : archetype === 'drop' ? 3 + Math.floor(rng() * 4) : 21
  const onset = lead ? 18 : drawnOnset
  const dropZ = uni(rng, -2.9, -2.2)
  const riseZ = uni(rng, 1.0, 1.5)
  const quietZ = target // some slip before they go quiet, some just stop
  const offset = archetype === 'steady' ? uni(rng, -0.15, 0.3) : 0
  const dip = DIPS[name]
  const state = (d: number): number => {
    const ago = homeDays - d // days before today
    if (dip) {
      // a dip of about a week: down over three days, held, back over three days
      const [from, len, depth] = dip
      const into = from - ago
      const shape = into < 0 || into > len ? 0 : Math.min(smooth(into / 3), smooth((len - into) / 3))
      return offset + depth * shape
    }
    switch (archetype) {
      case 'boosted': {
        // slides from about four weeks before the booster, low for the last days before it, back within a week after (simulated)
        const B = BOOSTER_AGO
        if (ago > B) return -2.3 * smooth((B + 18 - ago) / 12)
        return -2.3 * (1 - smooth((B - ago) / 8)) + 0.1
      }
      case 'drift':
        return target * clamp(1 - ago / onset, 0, 1)
      case 'drop':
        return ago < onset ? dropZ : 0
      case 'improving':
        return riseZ * smooth(1 - ago / onset)
      case 'quiet':
        return quietZ * smooth(1 - (ago - quietDays - 4) / 9) // slipping for a while, then silence
      default:
        return offset
    }
  }

  // ---- home pings + doses ----
  const sim: Record<DoseKind, number[]> = { breathe: [], smile: [], forest: [], walk: [], reach: [], wait: [] }
  let wobble = 0
  for (let d = 1; d <= homeDays; d++) {
    const day = endDay + d
    const ago = homeDays - d
    wobble = 0.6 * wobble + 0.22 * randNormal(rng)
    const z = state(d) + wobble
    const hour = clamp(habitHour + 1.2 * randNormal(rng), 6.5, 22)
    let p = adherence
    if (archetype === 'quiet') p = ago < quietDays ? 0 : ago === quietDays ? 1 : ago < quietDays + 7 ? adherence * 0.8 : adherence
    if ((archetype === 'drift' || archetype === 'drop') && ago <= 4) p = 1 // their latest numbers are fresh
    const pinged = rng() < p && !(ago === 0 && hour > nowHour)
    const wantsDose = rng() < 0.4 + (z < -0.6 ? 0.25 : 0)
    if (!pinged) continue
    const values = {} as Record<Channel, number | null>
    for (const ch of CHANNELS) values[ch] = value(ch, z)
    if (rng() < 0.04) values.heart = null // the pulse does not always read
    const at = atDay(day, hour)
    const pre = { id: `${id}-h${d}`, at: new Date(at).toISOString(), setting: 'home' as const, kind: 'full' as const, values, rest: restBpm }
    pings.push(pre)
    if (!wantsDose || at + 20 * 60_000 > now) continue
    // the simulated person follows their own bandit, so each ends up with a different favourite
    let dose: DoseKind = 'breathe'
    let top = -Infinity
    for (const k of trialDoses) {
      const draw = ngSample(ngUpdate(DEFAULT_NG, sim[k]), rng)
      if (draw > top) {
        top = draw
        dose = k
      }
    }
    const lift = effects[dose] + doseNoise * randNormal(rng)
    sim[dose].push(lift)
    const after = { smile: null, voice: null, heart: null, move: null } as Record<Channel, number | null>
    for (const ch of ['smile', 'heart'] as Channel[]) {
      const v = values[ch]
      if (v != null) after[ch] = round(clamp(v + sd[ch] * (lift / 15 + 0.12 * randNormal(rng)), RANGE[ch][0], RANGE[ch][1]), 2)
    }
    const post = { id: `${id}-m${d}`, at: new Date(at + 9 * 60_000).toISOString(), setting: 'home' as const, kind: 'mini' as const, values: after, rest: restBpm }
    pings.push(post)
    const felt = rng() < 0.3 ? null : lift > 3 ? 1 : lift < -1.5 ? -1 : 0
    doseDrafts.push({ at: new Date(at + 3 * 60_000).toISOString(), dose, pre: pre.id, post: post.id, felt })
  }

  // rewards are measured exactly the way they are for a real person: from the stored pings
  const course = { start: new Date(atDay(startDay, 9)).toISOString(), end: new Date(atDay(endDay, 15)).toISOString(), sessions }
  const analysis = analyze(pings, course.end)
  const calc = new Map(analysis.echoes.map((e) => [e.pingId, e]))
  const doses: DoseRec[] = doseDrafts.map((d) => ({ at: d.at, dose: d.dose, felt: d.felt, reward: doseReward(calc.get(d.pre), calc.get(d.post), d.felt) }))

  // Weekly clinic anchor, on its own random stream so adding checks never changes any echo or dose.
  const checkRng = mulberry32(hashSeed(`${id}:phq2:${seed}`))
  const phq2: PHQ2Check[] = []
  for (let week = 0; week < Math.ceil(homeDays / 7); week++) {
    if (checkRng() < 0.18) continue // skipped weeks are part of the simulated home data
    const d = Math.min(homeDays, (week + 1) * 7)
    const latent = state(d)
    const total = clamp(Math.round(1.3 - latent * 1.1 + randNormal(checkRng) * 0.65), 0, 6)
    const first = clamp(Math.round(total * (0.42 + checkRng() * 0.16)), 0, 3)
    const second = total - first > 3 ? 3 : total - first
    const hour = d === homeDays ? Math.min(18, Math.max(7, nowHour)) : 18
    phq2.push({ id: `${id}-q${week}`, userId: id, at: new Date(atDay(endDay + d, hour)).toISOString(), items: [first, second], total: first + second })
  }

  // ---- the inner loop's practices, on their own random stream so they never change an echo, a dose or a check ----
  // The phone offers one on a day that reads below the usual band; now and then the person opens one themselves.
  // The kind offered is the phone's own pick (shared/earlearn.ts), so the clinic and the phone say the same thing.
  const prng = mulberry32(hashSeed(`${id}:practice:${seed}`))
  const practice: PracticeKind = BEST_PRACTICE[name] ?? PRACTICES[Math.floor(prng() * PRACTICES.length)]!
  const settleOf = {} as Record<PracticeKind, number>
  for (const k of PRACTICES) settleOf[k] = k === practice ? uni(prng, 14, 22) : uni(prng, -6, 6)
  const doneP = PRACTICE_DONE[name] ?? uni(prng, 0.55, 0.9)
  const firstHome = new Map<number, PingRec>()
  for (const x of pings) if (x.setting === 'home' && x.kind === 'full' && !firstHome.has(dayIndex(x.at))) firstHome.set(dayIndex(x.at), x)
  const practices: PracticeRec[] = []
  for (const d of analysis.days) {
    const ping = firstHome.get(d.day)
    if (!ping) continue
    const low = d.drift <= DIP
    const asked = prng() < 0.06
    const doneRoll = prng()
    const noise = randNormal(prng)
    if (!low && !asked) continue
    const at = Date.parse(ping.at) + 6 * 60_000
    if (at > now) continue
    const kind = learn(practices.filter((p) => p.done).map((p) => ({ kind: p.kind, settle: p.settle, at: p.at })), PRACTICES).next
    const done = !low || doneRoll < doneP
    practices.push({ at: new Date(at).toISOString(), kind, why: low ? 'drift' : 'asked', done, settle: done ? round(settleOf[kind] + 12 * noise, 1) : null })
  }

  let booster: BoosterBooking | null = null
  if (archetype === 'boosted') booster = { at: new Date(atDay(today - BOOSTER_AGO, 11)).toISOString(), bookedAt: new Date(atDay(today - BOOSTER_AGO - 4, 15)).toISOString(), by: 'simulated' }
  if (name === SEEDED_BOOKING) {
    let day = today + 2
    while ((day + 4) % 7 === 0 || (day + 4) % 7 === 6) day++
    booster = { at: new Date(atDay(day, 11)).toISOString(), bookedAt: new Date(atDay(today - 1, 14)).toISOString(), by: 'simulated' }
  }

  return { id, name, synthetic: true, course, pings, doses, phq2, createdAt: course.start, archetype, truth: { effects, best, practice }, practices, booster }
}

// one person goes quiet while steady, the next after slipping for a week
const QUIET_BEFORE = [-0.2, -1.7]

export function generateCohort(now: number, seed = COHORT_SEED, roster: readonly [string, Archetype, DoseKind | null][] = ROSTER): SynthPerson[] {
  let drifter = 0
  let quiet = 0
  return roster.map(([name, archetype, best]) => {
    const target = archetype === 'drift' ? DRIFT_TARGETS[drifter++ % DRIFT_TARGETS.length]! : archetype === 'quiet' ? QUIET_BEFORE[quiet++ % QUIET_BEFORE.length]! : 0
    return makePerson(name, archetype, best, target, now, seed)
  })
}

// ---------- traces ----------

const PHASES: Record<PingKind, { key: PhaseKey; ms: number }[]> = {
  full: [
    { key: 'settle', ms: 8000 },
    { key: 'nod', ms: 6000 },
    { key: 'laugh', ms: 12000 },
    { key: 'speak', ms: 12000 },
    { key: 'breathe', ms: 20000 },
  ],
  mini: [
    { key: 'laugh', ms: 8000 },
    { key: 'breathe', ms: 10000 },
  ],
  hall: [
    { key: 'nod', ms: 5000 },
    { key: 'laugh', ms: 10000 },
    { key: 'speak', ms: 8000 },
    { key: 'breathe', ms: 10000 },
  ],
}

/** Plausible 10 Hz traces that integrate back to the ping's channel values. Deterministic per ping id. */
export function synthTraces(ping: PingRec, restBpm = 68): PingTraces {
  const rng = mulberry32(hashSeed(ping.id))
  const phases: { key: PhaseKey; at: number }[] = []
  let total = 0
  for (const p of PHASES[ping.kind]) {
    phases.push({ key: p.key, at: total })
    total += p.ms
  }
  const start = (k: PhaseKey) => phases.find((p) => p.key === k)?.at ?? -1
  const lenOf = (k: PhaseKey) => PHASES[ping.kind].find((p) => p.key === k)?.ms ?? 0
  const { smile: auc, voice: f0sd, heart: swing, move: vel } = ping.values

  // smile: a rise-hold-fall bump whose area is the smile·s value
  const base = 0.04 + 0.05 * rng()
  const a = auc ?? 0
  const peak = clamp(0.14 + 0.2 * a, 0.05, 0.9)
  const latency = 500 + 1400 / (0.6 + a) + 200 * rng()
  const rise = 700
  const fall = 1400
  const hold = Math.max(0, (a / peak) * 1000 - (rise + fall) / 2)
  const sOn = start('laugh') + 1000 + latency

  // nod: two or three dips at ~1.1 Hz; peak velocity = amplitude * 2*pi*f
  const f = 1.1
  const amp = (vel ?? 0) / (2 * Math.PI * f)
  const nods = 2 + Math.floor(rng() * 2)
  const nOn = start('nod') + 900 + 600 * rng()

  // speech: a few bursts; pitch wanders with the person's pitch SD
  const f0med = 110 + 110 * rng()
  const sStart = start('speak')
  const bursts: [number, number][] = []
  if (sStart >= 0) {
    let t = sStart + 700 + 500 * rng()
    while (t < sStart + lenOf('speak') - 800) {
      const dur = 900 + 1800 * rng()
      bursts.push([t, Math.min(t + dur, sStart + lenOf('speak') - 300)])
      t += dur + 350 + 900 * rng()
    }
  }
  const ph1 = rng() * 6.28
  const ph2 = rng() * 6.28

  const bStart = start('breathe')
  const out: PingTraces = { t: [], smile: [], cheek: [], headPitch: [], bpm: [], rms: [], f0: [], phases }
  let slow = 0
  for (let t = 0; t < total; t += 100) {
    const x = t - sOn
    const bump = x < 0 ? 0 : x < rise ? x / rise : x < rise + hold ? 1 : x < rise + hold + fall ? 1 - (x - rise - hold) / fall : 0
    const s = clamp(base + peak * smooth(bump) + 0.012 * randNormal(rng), 0, 1)
    const n = t - nOn
    const nodding = n >= 0 && n < (nods / f) * 1000
    slow = 0.9 * slow + 0.25 * randNormal(rng)
    const pitch = (nodding ? -amp * Math.sin(2 * Math.PI * f * (n / 1000)) : 0) + slow
    let bpm: number | null = null
    if (swing != null) {
      const b = t - bStart
      const wave = bStart >= 0 && b >= 0 ? (swing / 2) * -Math.cos((2 * Math.PI * b) / 10000) * smooth(b / 2500) : 0
      bpm = round(restBpm + wave + 0.5 * randNormal(rng) + 1.2 * Math.sin(t / 7000 + ph1))
    }
    const speaking = bursts.some(([b0, b1]) => t >= b0 && t < b1)
    const st = (f0sd ?? 0) * (0.95 * Math.sin(t / 430 + ph2) + 0.75 * Math.sin(t / 1130 + ph1) + 0.3 * randNormal(rng))
    out.t.push(t)
    out.smile.push(round(s, 3))
    out.cheek.push(round(clamp(0.03 + 0.62 * (s - base) + 0.01 * randNormal(rng), 0, 1), 3))
    out.headPitch.push(round(pitch, 2))
    out.bpm.push(bpm)
    out.rms.push(round(speaking ? 0.07 + 0.09 * Math.abs(Math.sin(t / 190 + ph1)) + 0.02 * rng() : 0.004 + 0.004 * rng(), 4))
    out.f0.push(speaking ? round(f0med * 2 ** (st / 12)) : null)
  }
  return out
}
