// Vire shared types: imported by web (alias @shared) and server (../shared/types).
// Keep this file dependency-free. Change it only together with CONTRACT.md.

/** The four channels of an echo. */
export type Channel = 'smile' | 'voice' | 'heart' | 'move'
export const CHANNELS: Channel[] = ['smile', 'voice', 'heart', 'move']

/** Ping protocol v1. Durations in ms. Order is fixed. */
export type PhaseKey = 'settle' | 'nod' | 'laugh' | 'speak' | 'breathe'
export const PING_PHASES: { key: PhaseKey; ms: number }[] = [
  { key: 'settle', ms: 8000 }, // rest: baseline face, pulse, stillness
  { key: 'nod', ms: 6000 }, // "nod when you're ready": head amplitude + velocity
  { key: 'laugh', ms: 12000 }, // contagious laughter plays at +1000 ms: smile echo
  { key: 'speak', ms: 12000 }, // one spoken sentence: prosody, pauses
  { key: 'breathe', ms: 20000 }, // two slow breaths (5 s in, 5 s out): heart swing
]

export type HeartSource = 'airpods' | 'camera' | 'none'
export type MoveSource = 'airpods' | 'camera'

export interface SmileFeatures {
  /** ms from laughter onset to smile onset (smile > baseline + 0.15); null if no smile */
  latencyMs: number | null
  /** peak smile 0..1 above baseline */
  peak: number
  /** area under (smile - baseline) over the laugh phase, in smile-seconds */
  auc: number
  /** cheek raise (AU6) at the smile peak, 0..1: the Duchenne marker */
  duchenne: number
  /** ms the smile stayed above half of its peak */
  durationMs: number
  /** resting smile level during settle */
  baseline: number
  /** the face was already above the settle level when the laughter began */
  alreadySmiling?: boolean
}

export interface VoiceFeatures {
  /** fraction of the speak phase with voiced speech, 0..1 */
  speechFraction: number
  pauseCount: number
  meanPauseMs: number
  f0MedianHz: number | null
  /** pitch variability in semitones (prosody liveliness) */
  f0SdSemitones: number | null
  loudnessSdDb: number
  /** syllable nuclei per second of speech */
  syllableRateHz: number | null
}

export interface HeartFeatures {
  restBpm: number | null
  /** peak to trough of the heart rate that moves with the two paced breaths (lock-in at the breath's period), bpm */
  swingBpm: number | null
  /** standard error of the lock-in swing estimate, bpm */
  swingSe?: number
  /** 0..1 signal quality */
  quality: number
  source: HeartSource
}

export interface MoveFeatures {
  /** largest nod excursion in degrees */
  nodAmplitudeDeg: number | null
  /** peak nod angular velocity, deg/s */
  nodPeakVelDegS: number | null
  nodCount: number
  /** RMS head angular velocity during settle + breathe, deg/s */
  restlessness: number
  source: MoveSource
}

export interface PingFeatures {
  smile: SmileFeatures
  voice: VoiceFeatures
  heart: HeartFeatures
  move: MoveFeatures
  /** personal face model, when the person has done the tune step: each muscle's peak in the laugh phase (MUSCLES order, 0..1 of own range) */
  muscles?: number[]
  /** share of laugh-phase frames the personal model read as each face (0..1 each) */
  faces?: Partial<Record<TuneFace, number>>
  /** AirPods-only smile seconds in the laugh phase (ear model), for comparison with the camera's */
  earSmileAuc?: number | null
}

/** 10 Hz traces for the clinician view. Same length arrays, t in ms from ping start. */
export interface PingTraces {
  t: number[]
  smile: number[]
  cheek: number[]
  headPitch: number[]
  bpm: (number | null)[]
  rms: number[]
  f0: (number | null)[]
  /** phase start offsets in ms */
  phases: { key: PhaseKey; at: number }[]
}

export type PingKind = 'full' | 'mini' | 'hall'
/** where the ping was taken: at home, or in the clinic during the TMS course (calibration) */
export type PingSetting = 'home' | 'clinic'

export interface PingUpload {
  userId: string
  kind: PingKind
  setting: PingSetting
  startedAt: string // ISO
  features: PingFeatures
  traces?: PingTraces
  device: { ua: string; native: boolean; airpodsMotion: boolean; airpodsHr: boolean }
  /** channels the phone could not measure this time (too loud, too dark, face lost). The server treats them as null. */
  unreadable?: Channel[]
  stim?: string
  /** the phone's finished step readings; mirrors display this exact result */
  stepReadings?: Partial<Record<PhaseKey, StepReading>>
}

export interface StepReading {
  value: number | null
  unit: string
  readable: boolean
  reason?: string
}

export interface EchoComponent {
  channel: Channel
  /** raw response in natural units (see CONTRACT.md) */
  value: number | null
  unit: string
  /** z vs the person's own baseline; null until 3 pings exist */
  z: number | null
  /** 0..100, 50 = your usual */
  strength: number
  /** short plain-language line, e.g. "Your smile came 0.4 s slower than usual" */
  note: string
  /** the same channel's reading in words, shared by the phone and the big screen */
  reading?: string
}

export interface Echo {
  pingId: string
  at: string
  components: EchoComponent[]
  /** 0..100 overall, 50 = your usual */
  strength: number
  /** smoothed drift from the person's well signature, in SD units (negative = flatter) */
  drift: number
  status: 'calibrating' | 'steady' | 'dipping' | 'low'
  /** one warm sentence for the person */
  message: string
  suggestion: DoseSuggestion | null
  stim?: string
  wallCounted?: boolean
  /** person's test-retest spread in echo points; prior is 8 */
  wobble?: number
  /** full pings counted for the personal usual */
  pingsSoFar?: number
  /** anonymous hall guest number and the live count, only on a hall visit */
  hallGuest?: number
  hallCount?: number
}

/** The two-question weekly check the clinic already knows. Scores stay as item answers and a total. */
export interface PHQ2Check {
  id: string
  userId: string
  at: string
  items: [number, number]
  total: number
}
export interface PHQ2Upload {
  userId: string
  at?: string
  items: [number, number]
}
export type PHQ2 = PHQ2Check

export type DoseKind = 'breathe' | 'smile' | 'forest' | 'walk' | 'reach' | 'wait'
export const DOSES: DoseKind[] = ['breathe', 'smile', 'forest', 'walk', 'reach', 'wait']

export interface DoseSuggestion {
  dose: DoseKind
  /** why this one, for the person */
  reason: string
  /** expected lift in echo strength points, with the model's uncertainty */
  expected: number
  uncertainty: number
  /** a lead smaller than this is not ranked as a winner */
  wobble?: number
  /** true while the person's own data cannot separate the choices */
  tooEarly?: boolean
}

export interface DoseUpload {
  userId: string
  dose: DoseKind
  startedAt: string
  durationS: number
  /** echo strength before (the day's ping) and after (mini ping) */
  prePingId: string | null
  postPingId: string | null
  /** optional one-tap rating: -1 worse, 0 same, 1 better */
  felt: -1 | 0 | 1 | null
  /** dose-specific measurements, e.g. { cadenceSpm, headRangeDeg, breathsPerMin } */
  metrics: Record<string, number>
}

export interface DoseBelief {
  dose: DoseKind
  n: number
  /** posterior mean lift in echo strength points */
  mean: number
  sd: number
}

export interface DoseResult {
  reward: number
  /** measured post-minus-pre echo points before self-report blending/control adjustment */
  change?: number | null
  beliefs: DoseBelief[]
  message: string
}

// ---- clinic ----

export interface PatientRow {
  id: string
  name: string
  synthetic: boolean
  live: boolean
  /** days since the TMS course ended */
  daysSinceCourse: number | null
  lastPingAt: string | null
  /** pings in the last 7 days */
  adherence7: number
  strength: number | null
  drift: number
  status: Echo['status']
  /** 0..1 priority for a call */
  priority: number
  /** one line: why this person is where they are in the list */
  reason: string
  /** last 28 daily strengths for a sparkline (null = no ping that day) */
  spark: (number | null)[]
  boosterRequested: boolean
  /** when this person joined, shown to distinguish equal names */
  joinedAt?: string
  /** latest weekly PHQ-2, if answered */
  latestPHQ2?: { at: string; total: number }
  /** the outer loop: drift the practices did not answer, and the booster (server/outerloop.ts) */
  outer?: OuterRow
}

export interface PatientDetail extends PatientRow {
  course: { start: string; end: string; sessions: number } | null
  /** well signature: per-channel baseline value + spread, measured at the end of the course */
  signature: { channel: Channel; center: number; spread: number; unit: string }[]
  /** every ping, oldest first */
  timeline: {
    pingId: string
    at: string
    setting: PingSetting
    kind: PingKind
    strength: number
    drift: number
    components: { channel: Channel; value: number | null; z: number | null; strength: number }[]
  }[]
  beliefs: DoseBelief[]
  doses: { at: string; dose: DoseKind; reward: number; felt: number | null }[]
  /** clinician summary, 2-3 sentences */
  summary: string
  wobble?: number
  phq2?: PHQ2Check[]
  /** every practice the phone offered, oldest first (the outer loop) */
  practices?: PracticeRec[]
  /** the next free booster slots, soonest first */
  boosterSlots?: string[]
}

// ---- the outer loop (clinic): practices on the phone, drift they did not answer, a booster on demand ----

/** the practices in the AirPods; the same kinds as shared/earsession.ts SessionKind */
export type PracticeKind = 'breathe' | 'scan' | 'walk'

/** one practice the phone offered */
export interface PracticeRec {
  at: string
  kind: PracticeKind
  /** 'drift': the day read below the person's usual; 'asked': the person opened one themselves */
  why: 'drift' | 'asked'
  done: boolean
  /** percent stiller after than before (as shared/earlearn.ts scores it); null when not done or not read */
  settle: number | null
}

export interface BoosterBooking {
  /** the slot, ISO */
  at: string
  /** when it was booked */
  bookedAt: string
  /** 'clinic': booked on this screen and stored on the server; 'simulated': part of a simulated person's story */
  by: 'clinic' | 'simulated'
}

export type OuterState = 'steady' | 'answered' | 'drifting' | 'escalated' | 'booked' | 'after'

export interface OuterRow {
  state: OuterState
  /** calendar days in a row below the usual band (0 = inside it) */
  driftDays: number
  /** practices in the current drift (or, once answered, in the drift that ended) */
  inDrift: { offered: number; done: number; settled: number }
  /** what helps this person most, as the phone's learner says it */
  working: {
    said: 'learned' | 'leaning' | 'early' | 'none'
    best: PracticeKind | null
    /** sessions of `best` that settled, of `n` done */
    settled: number
    n: number
    /** done sessions of every kind */
    total: number
    text: string
  }
  /** one sentence the nurse can say on the phone; escalated and booked only */
  sentence: string | null
  /** day the drift met the rule (several days below the usual in spite of practices) */
  escalatedAt: string | null
  booster: BoosterBooking | null
  /** after a booster: days since and the drift now */
  after: { days: number; drift: number; simulated: boolean } | null
  /** short line for the list */
  note: string
}

// ---- personal face model (round 2) ----

/** Muscle groups the personal model reports, each 0..1 of the person's own range. */
export const MUSCLES = ['smile', 'cheek', 'browDown', 'browUp', 'frown', 'jaw', 'eyes', 'nose'] as const
export type Muscle = (typeof MUSCLES)[number]
/** The faces a person makes in the tune step. */
export const TUNE_FACES = ['rest', 'smile', 'sad', 'angry', 'surprised'] as const
export type TuneFace = (typeof TUNE_FACES)[number]

// ---- live relay (WebSocket) ----

export interface LiveFrame {
  type: 'frame'
  t: number
  phase: PhaseKey | 'idle' | 'dose'
  smile: number
  cheek: number
  pitch: number
  yaw: number
  bpm: number | null
  wave: number
  rms: number
  f0: number | null
  // ---- round 2, all optional ----
  roll?: number
  /** where head angles and the pulse come from right now */
  headSource?: MoveSource
  heartSource?: HeartSource
  /** MUSCLES order, each 0..1 of this person's own range (personal face model) */
  muscles?: number[]
  /** what the personal model reads on the face right now */
  face?: { label: TuneFace; p: number }
  /** smile 0..1 estimated from AirPods motion alone by the ear model the camera trained; absent when there is none */
  earSmile?: number
  /** finished phone readings for the phase; the stage replaces its estimate with these */
  stepReadings?: Partial<Record<PhaseKey, StepReading>>
  // ---- round 5: AirPods first ----
  /** false while the camera is off and the AirPods alone are followed; absent = the camera is on */
  camera?: boolean
  /** the person's own ear model, from AirPods motion alone: 0..1 per thing it can follow, and which are happening now */
  ear?: Partial<Record<import('./ear').EarEvent, number>>
  earOn?: import('./ear').EarEvent[]
  /** AirPods rotation rate, deg/s (how fast the head is turning right now) */
  rate?: number
}
/** Face wireframe for the big screen: 478 landmarks as x,y,z integers (image-normalised x1000). ~12 Hz, relayed, never stored. */
export interface LiveMesh {
  type: 'mesh'
  t: number
  pts: number[]
}
export type LiveMessage =
  | LiveFrame
  | LiveMesh
  | { type: 'reading'; readings: Partial<Record<PhaseKey, StepReading>> }
  /** the tune step on the big screen: which face is being asked for, then the trained model's own check */
  | { type: 'tune'; step: TuneFace | 'training' | 'done'; accuracy?: number; earAccuracy?: number | null }
  /** the teaching minute on the big screen: what is asked for now, then what the AirPods learned (round 5) */
  | { type: 'teach'; state: 'step' | 'training' | 'done'; ask?: import('./ear').EarAsk; say?: string; index?: number; of?: number; model?: import('./ear').EarModel2 | null }
  /** the search for this person's model in a sandbox of its own, as it goes (round 5) */
  | { type: 'search'; job: import('./ear').EarJob }
  | { type: 'phase'; phase: PhaseKey | 'idle' | 'dose'; at: number }
  | { type: 'echo'; echo: Echo }
  | { type: 'hello'; role: 'sensor' | 'viewer'; name?: string }

// ---- hall wall (round 2, appended by WALL) ----
// Hall guests ping once or twice, so they have no personal baseline: everything here is the raw channel value
// (CONTRACT units) set against the hall's own distribution, never a strength from population priors.
// It shows how a hackathon weekend wears people down (tiredness, less sleep). It is not a diagnosis and says
// nothing about depression. Only numbers are stored.

/** `POST /api/users` body. `visitor: true` is a hall guest: on the wall, never in the clinic lists. Names are kept short (24 characters for a person, 16 for a hall nickname). */
export interface UserCreate {
  name?: string
  clinicCode?: string
  visitor?: boolean
}
/** Optional extras the server reads on `POST /api/pings` next to `PingUpload`. */
export interface PingUploadExtras {
  /** set when the phone could not create its user first (offline): the server then creates it as a hall guest */
  visitor?: boolean
  /** e2e and mock traffic is stored for debugging but never counted as a person at the hall */
  test?: boolean
}

export type WallDeviceFamily = 'ios' | 'android' | 'native' | 'desktop' | 'other'

/** Median and middle half of some raw channel values. All null when n = 0. */
export interface WallStat {
  n: number
  median: number | null
  q1: number | null
  q3: number | null
}
/** One hour of the hall. `h` = whole hours since `WallState.since` (0 = Friday 18:00-19:00 Helsinki). */
export interface WallHour extends WallStat {
  h: number
}

export interface WallChannel {
  channel: Channel
  unit: string
  /** share (0..1) of the hall's pings where the phone could read this channel; null before the first ping */
  readRate: number | null
  /** where the hall sits: each visitor's latest readable value */
  now: WallStat
  /** value at every 5th percentile of `now` (21 numbers, p0..p100); empty under 3 values */
  quantiles: number[]
  /** the same values in equal-width bins, for drawing; null under 3 values */
  hist: { lo: number; hi: number; counts: number[] } | null
  /** one entry per hour that has a ping, oldest first. Under n = 3 a bucket is a hint, not a reading: do not draw it as one. */
  hours: WallHour[]
  /** returning visitors: latest minus first, for those whose channel was readable both times. `up`/`down` count people. */
  change: WallStat & { up: number; down: number }
  /** drawing range for raw values: the plausible range, widened to the hall's own */
  domain: [number, number]
}

/** Every counted ping as columns (oldest first, the newest 2000): the wall draws these as unlabelled dots. */
export interface WallPoints {
  /** hours since `since`, 2 decimals */
  h: number[]
  /** anonymous visitor number, to join one person's pings */
  who: number[]
  values: Record<Channel, (number | null)[]>
}

export interface WallDot {
  /** anonymous key for this visitor (never the user id) */
  key: string
  /** nickname or "guest 14", never more */
  label: string
  at: string
  /** hours since `since` */
  h: number
  values: Record<Channel, number | null>
  /** 0..100: share of the other people in the hall whose latest value is below this one; null when unreadable or fewer than 3 others */
  pct: Record<Channel, number | null>
  /** which ping of theirs this is (1 = first) */
  nth: number
  /** this ping came 3+ hours after their first */
  returning: boolean
}

/** The visitor named by `GET /api/wall?u=<userId>`. */
export interface WallMe extends WallDot {
  /** false when these pings are kept out of the hall's numbers (test traffic from the dev machines) */
  counted: boolean
  pings: number
  /** their first ping, when they have two or more */
  first: { at: string; h: number; values: Record<Channel, number | null> } | null
  hoursBetween: number | null
  /** latest minus first per channel; null when either was unreadable */
  change: Record<Channel, number | null> | null
  /** all of their pings, oldest first */
  trail: { h: number; values: Record<Channel, number | null> }[]
}

/** `GET /api/wall` (add `?u=<userId>` for `me`, `?demo=<visitors>` for simulated data to check a layout). */
export interface WallState {
  generatedAt: string
  /** Friday 18:00 Helsinki, the start of the hackathon */
  since: string
  /** Sunday 14:00 Helsinki, the end of the peer review */
  until: string
  /** hours since `since`, 1 decimal */
  hoursIn: number
  /** true only for `?demo=`: made-up data, always shown with a "simulated" tag */
  simulated: boolean
  /** hall guests who started (scanned and opened the flow) */
  started: number
  /** hall guests with at least one finished ping */
  visitors: number
  pings: number
  /** visitors with two or more pings at least `minGapH` hours apart */
  returning: number
  minGapH: number
  /** CHANNELS order */
  channels: WallChannel[]
  points: WallPoints
  /** the newest echoes, newest first (up to 12) */
  latest: WallDot[]
  /** real-world sensor evidence: share of pings where each channel was readable, overall and by device */
  readRates: Record<Channel, number | null>
  devices: { family: WallDeviceFamily; label: string; visitors: number; pings: number; readRates: Record<Channel, number | null> }[]
  me: WallMe | null
}

// ---- daily ElevenLabs media ----
export interface DailyAssetStatus {
  source: 'generated' | 'fallback'
  generatedAt: string | null
  callMs: number | null
  endpoint: string | null
  model: string | null
  seconds: number | null
  file: string
}
export interface DailyStatus {
  date: string
  question: string
  laugh: DailyAssetStatus
  questionAudio: DailyAssetStatus
}

// ---- hall clinic (round 4, WALL) ----
export interface HallPersonRow {
  guest: number
  at: string
  family: string
  tune: boolean
  readings: Record<Channel, { value: number | null; unit: string; readable: boolean; reason?: string }>
  seconds: number | null
}
export interface HallChannelSummary {
  channel: Channel
  unit: string
  read: number
  total: number
  median: number | null
  min: number | null
  max: number | null
  values: (number | null)[]
}
export interface HallToday {
  count: number
  generatedAt: string
  channels: HallChannelSummary[]
  people: HallPersonRow[]
}
