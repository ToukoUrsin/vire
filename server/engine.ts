// Vire learning engine: pure functions only (no I/O, no clock, no global randomness).
// Baseline (median + MAD) -> z -> strength -> drift (EWMA) -> status, plain-word notes, and the dose bandit.
import type {
  Channel,
  DoseBelief,
  DoseKind,
  DoseSuggestion,
  Echo,
  EchoComponent,
  PingFeatures,
  PingKind,
  PingSetting,
  PHQ2Check,
} from '../shared/types'

export const CHANNELS: Channel[] = ['smile', 'voice', 'heart', 'move']
export const DOSES: DoseKind[] = ['breathe', 'smile', 'forest', 'walk', 'reach', 'wait']
export const UNITS: Record<Channel, string> = { smile: 'smile·s', voice: 'st', heart: 'bpm', move: '°/s' }

/** Population priors, used until a person has 3 pings of their own. */
export const PRIORS: Record<Channel, { center: number; spread: number }> = {
  smile: { center: 1.6, spread: 0.7 },
  voice: { center: 2.4, spread: 0.7 },
  heart: { center: 9, spread: 3 },
  move: { center: 60, spread: 22 },
}

export const EWMA_ALPHA = 0.3
export const DIP = -0.75
export const LOW = -1.5
const DAY = 86400_000
/** Days are cut on Helsinki winter time (UTC+2): the clinic and the cohort live there. */
export const TZ_OFFSET_MS = 2 * 3600_000

export type Status = Echo['status']

// ---------- small maths ----------

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
export const round = (x: number, dp = 1) => {
  const k = 10 ** dp
  return Math.round(x * k) / k
}
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
/** median absolute deviation, scaled to be comparable with a standard deviation */
export function mad(xs: number[], center = median(xs)): number {
  return 1.4826 * median(xs.map((x) => Math.abs(x - center)))
}
export const dayIndex = (at: string | number) => Math.floor((new Date(at).getTime() + TZ_OFFSET_MS) / DAY)
export const dayKey = (at: string | number) => new Date(new Date(at).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)

// ---------- seeded randomness ----------

export type Rng = () => number
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export function randNormal(rng: Rng): number {
  let u = 0
  while (u === 0) u = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}
/** Gamma(shape, scale 1), Marsaglia-Tsang */
export function randGamma(shape: number, rng: Rng): number {
  if (shape < 1) return randGamma(shape + 1, rng) * Math.pow(rng() || 1e-12, 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x = 0
    let v = 0
    do {
      x = randNormal(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng() || 1e-12
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

// ---------- records ----------

export interface PingRec {
  id: string
  at: string
  setting: PingSetting
  kind: PingKind
  values: Record<Channel, number | null>
  stim?: string
  alreadySmiling?: boolean
  smileLatencyMs?: number | null
  heartSwingSe?: number | null
}
export interface DoseRec {
  at: string
  dose: DoseKind
  /** post strength - pre strength; null when it could not be measured */
  reward: number | null
  felt: number | null
}
export interface Person {
  id: string
  name: string
  synthetic: boolean
  course: { start: string; end: string; sessions: number } | null
  pings: PingRec[]
  doses: DoseRec[]
  phq2?: PHQ2Check[]
  createdAt?: string
}

/** The four echo channel values of a ping, as defined in CONTRACT.md. */
export function channelValues(f: PingFeatures, kind: PingKind): Record<Channel, number | null> {
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const mini = kind === 'mini'
  const f0sd = num(f?.voice?.f0SdSemitones)
  const frac = num(f?.voice?.speechFraction)
  const quality = num(f?.heart?.quality) ?? 0
  return {
    smile: num(f?.smile?.auc),
    voice: mini ? null : (f0sd ?? (frac != null ? frac * 4 : null)),
    heart: quality < 0.3 ? null : num(f?.heart?.swingBpm),
    move: mini ? null : num(f?.move?.nodPeakVelDegS),
  }
}

// ---------- baseline ----------

export interface ChannelBaseline {
  center: number
  spread: number
  n: number
  /** clinic = well signature from the end of the course; home = first 7 pings; prior = population */
  source: 'clinic' | 'home' | 'prior'
  seen: number
}
export type Baseline = Record<Channel, ChannelBaseline>

const byTime = (a: PingRec, b: PingRec) => new Date(a.at).getTime() - new Date(b.at).getTime()

export function computeBaseline(pingsIn: PingRec[], courseEnd?: string | null): Baseline {
  const full = pingsIn.filter((p) => p.kind === 'full').sort(byTime)
  const clinic = full.filter((p) => p.setting === 'clinic')
  const endMs = courseEnd ? new Date(courseEnd).getTime() : clinic.length ? new Date(clinic[clinic.length - 1]!.at).getTime() : 0
  const well = clinic.filter((p) => {
    const t = new Date(p.at).getTime()
    return t >= endMs - 14 * DAY && t <= endMs + DAY
  })
  const home = full.filter((p) => p.setting === 'home').slice(0, 7)
  const first = full.slice(0, 7)
  const sets: { pings: PingRec[]; source: 'clinic' | 'home' }[] = [
    { pings: well, source: 'clinic' },
    { pings: home, source: 'home' },
    { pings: first, source: 'home' },
  ]
  const out = {} as Baseline
  for (const ch of CHANNELS) {
    const prior = PRIORS[ch]
    let chosen: ChannelBaseline = { center: prior.center, spread: prior.spread, n: 0, source: 'prior', seen: 0 }
    let seen = 0
    for (const s of sets) {
      const xs = s.pings.map((p) => p.values[ch]).filter((v): v is number => v != null && ((ch === 'smile' || ch === 'move' || ch === 'voice') ? v !== 0 : true))
      seen = Math.max(seen, xs.length)
      if (xs.length >= 3) {
        const center = median(xs)
        // floor the spread: a handful of pings can sit almost on top of each other
        const spread = Math.max(mad(xs, center), 0.35 * prior.spread, 0.14 * Math.abs(center))
        chosen = { center, spread, n: xs.length, source: s.source, seen: xs.length }
        break
      }
    }
    out[ch] = { ...chosen, seen: Math.max(chosen.seen, seen) }
  }
  return out
}

// ---------- echo maths ----------

export interface EchoCalc {
  pingId: string
  at: string
  setting: PingSetting
  kind: PingKind
  /** `raw` is the strength before clamping to 0..100: rewards are measured on it so a lift still counts at the floor */
  components: { channel: Channel; value: number | null; z: number | null; strength: number; raw: number; alreadySmiling?: boolean; notSeen?: boolean; smileLatencyMs?: number | null; heartSwingSe?: number | null }[]
  strength: number
  meanZ: number | null
  drift: number
  status: Status
}
export interface DayPoint {
  day: number
  meanZ: number
  drift: number
  strength: number
  pings: number
}
export interface Analysis {
  baseline: Baseline
  nFull: number
  echoes: EchoCalc[]
  /** one entry per day that has a full ping, oldest first */
  days: DayPoint[]
  drift: number
  status: Status
  /** test-retest spread in whole echo points, with an 8 point prior */
  wobble: number
}

export const zScore = (value: number, center: number, spread: number) => (value - center) / (spread || 1)
export const strengthOf = (z: number) => clamp(50 + 15 * z, 0, 100)
/** The phone and clinic share this gate: mini pings never establish a personal usual. */
export const fullPingCount = (pings: Pick<PingRec, 'kind'>[]) => pings.filter((p) => p.kind === 'full').length
export const isCalibrating = (pings: Pick<PingRec, 'kind'>[] | number) => (typeof pings === 'number' ? pings : fullPingCount(pings)) < 3

export function statusOf(days: { drift: number }[], drift: number): Status {
  if (drift > DIP) return 'steady'
  let run = 0
  for (let i = days.length - 1; i >= 0 && days[i]!.drift < LOW; i--) run++
  return run >= 3 ? 'low' : 'dipping'
}

/** Everything the server shows about a person's pings, recomputed from scratch against the current baseline. */
export function analyze(pingsIn: PingRec[], courseEnd?: string | null): Analysis {
  const pings = [...pingsIn].sort(byTime)
  const baseline = computeBaseline(pings, courseEnd)
  const nFull = fullPingCount(pings)
  const calibrating = isCalibrating(nFull)
  const days: DayPoint[] = []
  const echoes: EchoCalc[] = []
  let drift = 0
  let prevDrift: number | null = null
  let zSum = 0
  let sSum = 0
  for (const p of pings) {
    const mini = p.kind === 'mini'
    const components = CHANNELS.map((channel) => {
      const value = mini && (channel === 'voice' || channel === 'move') ? null : p.values[channel]
      // Hall pings are raw readings, not personal echoes. Keep their values visible
      // without letting them create a personal usual.
      const hall = p.kind === 'hall'
      // A channel made only of no-response pings has no personal usual. Keep it
      // explicitly unread even when a later ping happens to produce a value.
      const unseen = baseline[channel].seen === 0 && !hall
      if (value == null || unseen) return { channel, value: null, z: null, strength: 50, raw: 50, ...(baseline[channel].seen === 0 ? { notSeen: true } : {}) }
      if (hall) return { channel, value: round(value, 2), z: null, strength: 50, raw: value }
      // A channel gets its own usual after three readable values. Other channels
      // keep learning independently; one dark/quiet sensor must not hold them back.
      const ready = baseline[channel].n >= 3
      const b = ready ? baseline[channel] : PRIORS[channel]
      const z = zScore(value, b.center, b.spread)
      return { channel, value: round(value, 2), z: ready ? round(z, 2) : null, strength: round(strengthOf(z)), raw: 50 + 15 * z, ...(channel === 'smile' && p.alreadySmiling ? { alreadySmiling: true } : {}), ...(channel === 'smile' ? { smileLatencyMs: p.smileLatencyMs ?? null } : {}), ...(channel === 'heart' ? { heartSwingSe: p.heartSwingSe ?? null } : {}) }
    })
    const present = components.filter((c) => c.value != null)
    const strength = present.length ? round(mean(present.map((c) => c.strength))) : 50
    const zs = present.map((c) => c.z).filter((z): z is number => z != null)
    const meanZ = zs.length ? mean(zs) : null
    if (!mini && meanZ != null) {
      const d = dayIndex(p.at)
      let today = days[days.length - 1]
      if (!today || today.day !== d) {
        if (today) prevDrift = today.drift
        today = { day: d, meanZ: 0, drift: 0, strength: 0, pings: 0 }
        days.push(today)
        zSum = 0
        sSum = 0
      }
      zSum += meanZ
      sSum += strength
      today.pings++
      today.meanZ = zSum / today.pings
      today.strength = round(sSum / today.pings)
      drift = prevDrift == null ? today.meanZ : EWMA_ALPHA * today.meanZ + (1 - EWMA_ALPHA) * prevDrift
      today.drift = drift
    }
    echoes.push({
      pingId: p.id,
      at: p.at,
      setting: p.setting,
      kind: p.kind,
      components,
      strength,
      meanZ,
      drift: round(drift, 2),
      status: calibrating ? 'calibrating' : statusOf(days, drift),
    })
  }
  const fullStrengths = echoes.filter((e) => e.kind === 'full').map((e) => e.strength)
  const paired = fullStrengths.slice(1).map((v, i) => Math.abs(v - fullStrengths[i]!))
  // Eight points is the stated prior. Repeated, identical readings shrink it only gradually, so one lucky pair
  // cannot turn noise into a recommendation; the same inputs always remain inside the wobble.
  const wobble = round(clamp(0.7 * 8 + 0.3 * (paired.length ? median(paired) : 8), 2, 20))
  return { baseline, nFull, echoes, days, drift: round(drift, 2), status: calibrating ? 'calibrating' : statusOf(days, drift), wobble }
}

// ---------- plain words ----------

const NOTES: Record<Channel, [string, string, string, string, string]> = {
  //       well above                                    a little above                                     usual                                              a little below                                           well below
  smile: [
    'Your smile came easily, fuller than your usual',
    'Your smile was a little fuller than your usual',
    'Your smile was right around your usual',
    'Your smile came a little slower than your usual',
    'Your smile stayed quieter than your usual today',
  ],
  voice: [
    'Your voice had more colour than your usual',
    'Your voice had a little more lift than your usual',
    'Your voice sounded like your usual',
    'Your voice was a little flatter than your usual',
    'Your voice stayed flatter than your usual today',
  ],
  heart: [
    'Your heart followed your breath more than your usual',
    'Your heart followed your breath a touch more than your usual',
    'Your heart followed your breath the way it usually does',
    'Your heart moved a little less with your breath than your usual',
    'Your heart barely followed your breath today, less than your usual',
  ],
  move: [
    'Your nod was quicker and bigger than your usual',
    'Your nod was a little quicker than your usual',
    'Your nod was just like your usual',
    'Your nod was a little slower than your usual',
    'Your nod was smaller and slower than your usual today',
  ],
}
const MISSING: Record<Channel, string> = {
  smile: "We couldn't see your smile this time",
  voice: "We couldn't hear your voice this time",
  heart: "We couldn't read your heart this time",
  move: "We couldn't catch your nod this time",
}
// The first pings have no "usual" to compare with. Say what each number is, once each; the message under the echo
// says that Vire is still learning (four lines of "still learning" told a first-time user nothing).
const LEARNING: Record<Channel, string> = {
  smile: 'Your smile back at the laughter',
  voice: 'Your voice moving as you spoke',
  heart: 'Your heart swinging with two slow breaths',
  move: 'Your nod, and how quick it was',
}

export function componentNote(channel: Channel, value: number | null, z: number | null): string {
  if (value == null) return MISSING[channel]
  if (z == null) return LEARNING[channel]
  const n = NOTES[channel]
  if (z >= 1.2) return n[0]
  if (z >= 0.4) return n[1]
  if (z > -0.4) return n[2]
  if (z > -1.2) return n[3]
  return n[4]
}

/** Deterministic fallback for the one warm sentence. The LLM may rephrase it, never replace its meaning. */
export function echoMessage(e: EchoCalc, nFull: number): string {
  if (e.kind === 'mini') {
    return 'That was your echo after the dose. Vire keeps what it learns about you.'
  }
  if (e.status === 'calibrating') {
    const left = Math.max(1, 3 - nFull)
    return `Thank you for today's ping. Your usual appears after three pings: ${left} to go.`
  }
  if (e.status === 'low') return 'Your echo has been quieter than your usual for a few days. Be gentle with yourself today; one small thing is enough.'
  if (e.status === 'dipping') return 'Your echo is a little flatter than your usual these days. One small thing through your earbuds might help.'
  if (e.strength >= 58) return 'Your echo came back full today, a little above your usual.'
  if (e.strength <= 25) return 'Your echo was quieter than your usual today. One quiet day is only one day; your week still looks like you.'
  if (e.strength <= 40) return 'Your echo was a little quieter today, and your week still looks like you.'
  return 'Your echo is right around your usual today.'
}

export function toEcho(e: EchoCalc, message: string, suggestion: DoseSuggestion | null, stim?: string, wobble?: number, pingsSoFar?: number): Echo {
  const components: EchoComponent[] = e.components.map((c) => ({
    channel: c.channel,
    value: c.value,
    unit: UNITS[c.channel],
    z: c.z,
    strength: c.strength,
    ...(c.value == null ? {} : { reading: c.channel === 'smile' ? `A smile worth ${round(c.value, 1)} s of a full smile${c.smileLatencyMs != null ? `, starting ${round(c.smileLatencyMs / 1000, 1)} s after the laugh` : ''}.` : c.channel === 'voice' ? `Moved ${round(c.value, 1)} semitones.` : c.channel === 'heart' ? `Swung ${Math.round(c.value)} beats a minute with your breath${c.heartSwingSe != null ? `, give or take ${Math.ceil(c.heartSwingSe)}` : ''}.` : `${Math.round(c.value)} ${Math.round(c.value) === 1 ? 'degree' : 'degrees'} a second.` }),
    note: c.notSeen ? ({ smile: "Vire hasn't seen your smile yet. A clear smile when the laughter plays.", voice: "Vire hasn't heard your voice yet. Say the sentence when it asks.", move: "Vire hasn't seen your nod yet. A clear nod when the voice asks.", heart: "Vire hasn't read your heart yet. Follow the two slow breaths." }[c.channel]) : c.channel === 'smile' && c.alreadySmiling ? 'Already smiling when the laughter started; your smile grew from there' : componentNote(c.channel, c.value, e.status === 'calibrating' ? null : c.z),
  }))
  return { pingId: e.pingId, at: e.at, components, strength: e.strength, drift: e.drift, status: e.status, message, suggestion, stim, ...(wobble == null ? {} : { wobble }), ...(pingsSoFar == null ? {} : { pingsSoFar }) }
}

// ---------- dose bandit: Thompson sampling on a Normal-Gamma posterior ----------

/** mean ~ N(mu, 1/(kappa*tau)), tau ~ Gamma(alpha, rate beta) */
export interface NG {
  mu: number
  kappa: number
  alpha: number
  beta: number
}
export type Prior = Record<DoseKind, NG>
export const DEFAULT_NG: NG = { mu: 3, kappa: 1, alpha: 2, beta: 30 }
export const defaultPrior = (): Prior => ({ breathe: DEFAULT_NG, smile: DEFAULT_NG, forest: DEFAULT_NG, walk: DEFAULT_NG, reach: DEFAULT_NG, wait: DEFAULT_NG })

export function ngUpdate(p: NG, xs: number[]): NG {
  const n = xs.length
  if (!n) return p
  const m = mean(xs)
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0)
  const kappa = p.kappa + n
  return {
    mu: (p.kappa * p.mu + n * m) / kappa,
    kappa,
    alpha: p.alpha + n / 2,
    beta: p.beta + 0.5 * ss + (p.kappa * n * (m - p.mu) ** 2) / (2 * kappa),
  }
}
/** posterior mean of the lift and the sd of that mean */
export const ngBelief = (p: NG) => ({ mean: p.mu, sd: Math.sqrt(p.beta / (p.kappa * Math.max(p.alpha - 1, 0.5))) })
export function ngSample(p: NG, rng: Rng): number {
  const tau = randGamma(p.alpha, rng) / p.beta
  return p.mu + randNormal(rng) / Math.sqrt(p.kappa * tau)
}

/** Cohort prior: what each dose does on average across everyone, worth one observation. */
export function cohortPrior(rewards: { dose: DoseKind; reward: number | null }[]): Prior {
  const out = defaultPrior()
  for (const d of DOSES) {
    const xs = rewards.filter((r) => r.dose === d && r.reward != null).map((r) => r.reward as number)
    if (xs.length < 5) continue
    const m = mean(xs)
    const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)
    out[d] = { mu: m, kappa: 1, alpha: 2, beta: Math.max(v, 4) }
  }
  return out
}

const rewardsOf = (history: DoseRec[], dose: DoseKind) =>
  history.filter((h) => h.dose === dose && h.reward != null).map((h) => h.reward as number)

export function posteriors(history: DoseRec[], prior: Prior): Prior {
  const out = {} as Prior
  for (const d of DOSES) out[d] = ngUpdate(prior[d], rewardsOf(history, d))
  return out
}

export function beliefs(history: DoseRec[], prior: Prior): DoseBelief[] {
  const post = posteriors(history, prior)
  return DOSES.map((dose) => {
    const b = ngBelief(post[dose])
    return { dose, n: rewardsOf(history, dose).length, mean: round(b.mean), sd: round(b.sd) }
  })
}

/** One Thompson draw per dose; the highest draw wins. */
export function thompson(post: Prior, rng: Rng): DoseKind {
  let best: DoseKind = 'breathe'
  let top = -Infinity
  for (const d of DOSES) {
    const x = ngSample(post[d], rng)
    if (x > top) {
      top = x
      best = d
    }
  }
  return best
}

export const DOSE_LABEL: Record<DoseKind, string> = {
  breathe: 'Slow breathing',
  smile: 'Smile along',
  forest: 'The forest',
  walk: 'A tempo walk',
  reach: 'A voice note to a friend',
  wait: 'Just wait',
}
const lower = (s: string) => s[0]!.toLowerCase() + s.slice(1)

/** Says what the bandit has learned about this dose for this person, in the person's words. */
export function doseReason(dose: DoseKind, history: DoseRec[], prior: Prior): string {
  const label = DOSE_LABEL[dose]
  if (dose === 'wait') return 'Some days Vire asks you to do nothing for a minute, to see what a minute does on its own.'
  const mine = rewardsOf(history, dose)
  if (!mine.length) {
    // no claim about other people here: the cohort behind the prior is simulated
    return `You haven't tried ${lower(label)} yet.`
  }
  const recent = mine.slice(-5)
  const lifted = recent.filter((r) => r >= 1).length
  if (recent.length === 1) {
    return lifted
      ? `${label} lifted your echo by ${Math.round(recent[0]!)} points last time.`
      : `${label} didn't move your echo last time. One more try tells Vire more.`
  }
  if (lifted * 2 >= recent.length) return `${label} has lifted your echo ${lifted} of the last ${recent.length} times.`
  return `${label} has lifted your echo ${lifted} of the last ${recent.length} times. Vire is checking it once more to be sure.`
}

export function suggest(history: DoseRec[], prior: Prior, rng: Rng, wobble = 8): DoseSuggestion {
  // Reserve roughly one day in six for a quiet minute with no dose.
  if (rng() < 1 / 6) {
    const b = ngBelief(posteriors(history, prior).wait)
    return { dose: 'wait', reason: 'Some days Vire asks you to do nothing for a minute, to see what a minute does on its own.', expected: round(b.mean), uncertainty: round(b.sd), wobble, tooEarly: true }
  }
  const post = posteriors(history, prior)
  const dose = thompson(post, rng)
  const b = ngBelief(post[dose])
  const ranked = DOSES.map((d) => ({ dose: d, mean: ngBelief(post[d]).mean })).sort((a, b) => b.mean - a.mean)
  const lead = (ranked[0]?.mean ?? 0) - (ranked[1]?.mean ?? 0)
  const tooEarly = lead <= wobble
  const reason = tooEarly
    ? `${doseReason(dose, history, prior)} Too early to say which works best for you, so today is a try.`
    : doseReason(dose, history, prior)
  return { dose, reason, expected: round(b.mean), uncertainty: round(b.sd), wobble, tooEarly }
}

/**
 * Reward = post strength - pre strength, on the channels both pings measured (a mini ping has smile + heart).
 * Taken before the 0..100 clamp: someone at the floor who lifts a little has still lifted.
 */
export function doseReward(pre: EchoCalc | null | undefined, post: EchoCalc | null | undefined, felt: number | null): number | null {
  if (pre && post) {
    const diffs: number[] = []
    for (const c of post.components) {
      const p = pre.components.find((x) => x.channel === c.channel)
      if (c.value != null && p && p.value != null) diffs.push(c.raw - p.raw)
    }
    // one mini ping against a young baseline can swing wildly: cap what a single dose may teach
    if (diffs.length) {
      const measured = mean(diffs)
      // The trace is 70% of the lesson and the person's answer is 30%: both count.
      const said = felt == null ? null : felt * 10
      return round(clamp(said == null ? measured : measured * 0.7 + said * 0.3, -30, 30))
    }
  }
  return felt == null ? null : felt * 5
}

export function doseMessage(dose: DoseKind, reward: number | null): string {
  const label = DOSE_LABEL[dose]
  if (reward == null) return `Done. ${label} is noted; a mini ping afterwards tells Vire what it did for you.`
  const pts = Math.abs(Math.round(reward))
  if (reward >= 2) return `Your echo came back ${pts} ${pts === 1 ? 'point' : 'points'} fuller after ${lower(label)}. Vire will remember that.`
  if (reward <= -2) return `Your echo was a little quieter after ${lower(label)} this time. That is useful too: Vire learns what suits you.`
  return `Your echo stayed about the same after ${lower(label)}. That is useful too: Vire learns what suits you.`
}
