// What a session did, read from the AirPods alone: the same still stretch before and after the practice (how
// much the head moved, the heart rate), the asked smiles before and after, what the sound asked for and whether
// the breath went with it, and for a walk whether steps were felt. Pure, so the phone, the server and the tests
// all get the same numbers.
import { earMeasures } from './earday'
import type { EarRecording } from './ear'
import type { EarSessionRec, SessionKind, SessionPhase } from './earsession'
import { walkRead } from './earwalk'
import type { WalkRead } from './earwalk'

export interface CheckRead {
  /** how much the head moved in the still stretch, degrees a second (median) */
  moveDegS: number | null
  /** how far the earbuds shifted in the asked smiles, degrees */
  smileDeg: number | null
  smiles: number
  asked: number
  /** heart rate in the still stretch; null when nothing measured it */
  heartBpm: number | null
}

export interface SessionRead {
  at: string
  kind: SessionKind
  day: number | null
  before: CheckRead
  after: CheckRead
  /** how much less the head moved after than before, in percent (positive: stiller). The learner's score. */
  settle: number | null
  /** smile size after minus before, degrees */
  smileChange: number | null
  /** heart rate after minus before, beats a minute */
  heartChange: number | null
  /** what measured the heart: 'airpods' (the iPhone's workout session), 'camera', or null */
  heartFrom: 'airpods' | 'camera' | null
  /** names of what Health said measured the samples, when the iPhone told us */
  heartSources: string[]
  /** seconds between two heart-rate samples, typically; null with fewer than three */
  heartEveryS: number | null
  /** how many heart-rate samples came in the whole session */
  heartSamples: number
  /**
   * How far the heart rate swung with each asked breath at the slowest pace, beats a minute peak to trough.
   * Only when the samples came at least three to a breath and a swing of a beat or more stood out at that pace
   * once the slow drift was taken out; null otherwise (then only its settling is said).
   */
  heartSwing: number | null
  /** the first and the last pace the sound asked for, breaths a minute */
  paceFirst: number | null
  paceLast: number | null
  /** the slowest pace the sound asked for: the swing of the heart rate is looked for there */
  paceSlowest: number | null
  /** the person's own pace before the sound, when it could be read */
  paceOwn: number | null
  /** seconds into the practice when the sound first reached its slowest pace (it only slows when the AirPods read the breath following, or a still head) */
  slowestAtS: number | null
  /** how long the practice ran, seconds */
  practiceS: number | null
  /** the hour of the day it started, on the person's own clock (0 to 23); null when the phone did not say */
  hour: number | null
  /** why Vire offered it, when it did: the sentence with the numbers, and whether the threshold was a stated default */
  offered: { rule: string; why: string; byDefault: boolean } | null
  /** times the phone checked whether the breath went with the sound, and how many of them it did */
  checks: number
  followed: number
  /** how many pace decisions were made on stillness because no breath could be read */
  byStillness: number
  /** the slowest pace the breath was read following; null when it never was */
  paceFollowed: number | null
  /** a walk: what the AirPods felt of it */
  walk: WalkRead | null
  /** did the practice happen as far as the AirPods can tell: a walk counts only when steps were felt for a third of it */
  happened: boolean
  /** AirPods samples a second over the session */
  hz: number
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const median = (v: number[]) => {
  if (!v.length) return null
  const s = v.slice().sort((a, b) => a - b)
  return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2
}
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)
const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100)

/** the rows and the asked steps between two times, as a minute of their own (times from t0) */
function slice(s: EarSessionRec, t0: number, t1: number, steps = true): EarRecording {
  return {
    v: 1,
    at: s.at,
    userId: null,
    device: { shell: s.device.shell, gyro: s.device.gyro, hz: s.device.hz, ua: '' },
    head: s.head.filter((r) => r[0] >= t0 && r[0] < t1).map((r) => [r[0] - t0, ...r.slice(1)]),
    face: [],
    voice: [],
    steps: steps ? s.steps.filter((x) => x.t0 >= t0 && x.t1 <= t1 + 1).map((x) => ({ ask: x.ask, t0: x.t0 - t0, t1: x.t1 - t0 })) : [],
  }
}

/** the still stretch of a phase: its longest asked rest, without the first moments (the head is still arriving) */
function stillOf(s: EarSessionRec, ph: SessionPhase): { t0: number; t1: number } | null {
  const rests = s.steps.filter((x) => x.ask === 'rest' && x.t0 >= ph.t0 && x.t1 <= ph.t1 + 1)
  if (!rests.length) return null
  const r = rests.reduce((a, b) => (b.t1 - b.t0 > a.t1 - a.t0 ? b : a))
  return { t0: r.t0 + Math.min(2000, (r.t1 - r.t0) * 0.2), t1: r.t1 }
}

const hrRows = (s: EarSessionRec, from: SessionRead['heartFrom']) =>
  from === 'airpods' ? s.airHr.filter((r) => r[1] > 0) : from === 'camera' ? s.pulse.filter((r) => r[2] >= 0.5 && r[1] > 0).map((r) => [r[0], r[1]]) : []

function check(s: EarSessionRec, name: 'before' | 'after', from: SessionRead['heartFrom']): CheckRead {
  const ph = s.phases.find((p) => p.name === name)
  if (!ph) return { moveDegS: null, smileDeg: null, smiles: 0, asked: 0, heartBpm: null }
  const still = stillOf(s, ph)
  // the smiles before are the check-in's when there was one: the still stretch before the practice asks for none
  const from0 = name === 'before' ? (s.phases.find((p) => p.name === 'checkin')?.t0 ?? ph.t0) : ph.t0
  const smiles = slice(s, from0, ph.t1)
  const sm = smiles.head.length >= 20 && smiles.steps.some((x) => x.ask === 'smile') ? earMeasures(smiles) : null
  const part = still ? slice(s, still.t0, still.t1, false) : null
  const move = part && part.head.length >= 20 ? earMeasures(part).moveDegS : null
  // a heart-rate sample is a few seconds old when it comes: the stretch is read a little wider
  const hr = still ? hrRows(s, from).filter((r) => r[0] >= still.t0 - 3000 && r[0] <= still.t1 + 3000).map((r) => r[1]) : []
  return { moveDegS: round2(move), smileDeg: round2(sm?.smileDeg ?? null), smiles: sm?.smiles ?? 0, asked: sm?.asked ?? 0, heartBpm: hr.length >= 2 ? round1(mean(hr)) : null }
}

/** the part of the heart rate that moves at the asked breath, at the slowest pace played: peak to trough */
function swing(s: EarSessionRec, hr: number[][], everyS: number | null): number | null {
  if (!s.breaths.length || everyS === null) return null
  const slow = Math.min(...s.breaths.map((b) => b.perMin))
  const at = s.breaths.filter((b) => b.perMin === slow)
  const period = 60 / slow
  if (at.length < 4 || everyS > period / 3) return null
  const t0 = at[0].t0
  const t1 = at[at.length - 1].t1
  const rows = hr.filter((r) => r[0] >= t0 && r[0] <= t1)
  if (rows.length < 12) return null
  // take the slow drift out first (a heart rate that settles is not a swing), then ask how much of what is left
  // sits at the asked pace: a swing is only said when it is at least a beat and a quarter of the variation
  const n = rows.length
  const tm = mean(rows.map((r) => r[0]))!
  const m = mean(rows.map((r) => r[1]))!
  let sxx = 0
  let sxy = 0
  for (const r of rows) {
    sxx += (r[0] - tm) ** 2
    sxy += (r[0] - tm) * (r[1] - m)
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  let c = 0
  let q = 0
  let v = 0
  for (const r of rows) {
    const y = r[1] - m - slope * (r[0] - tm)
    const ph = (2 * Math.PI * ((r[0] - t0) / 1000)) / period
    c += y * Math.cos(ph)
    q += y * Math.sin(ph)
    v += y * y
  }
  const amp = (2 / n) * Math.hypot(c, q)
  const share = v > 0 ? (amp * amp * n) / 2 / v : 0
  return 2 * amp >= 1 && share >= 0.25 ? round1(2 * amp) : null
}

export function readSession(s: EarSessionRec): SessionRead {
  const heartFrom: SessionRead['heartFrom'] = s.airHr.filter((r) => r[1] > 0).length >= 3 ? 'airpods' : s.pulse.filter((r) => r[2] >= 0.5 && r[1] > 0).length >= 60 ? 'camera' : null
  const before = check(s, 'before', heartFrom)
  const after = check(s, 'after', heartFrom)
  const settle = before.moveDegS !== null && after.moveDegS !== null && before.moveDegS > 0 ? Math.max(-100, Math.min(100, Math.round((1 - after.moveDegS / before.moveDegS) * 100))) : null
  const head = s.head
  const span = head.length > 1 ? (head[head.length - 1][0] - head[0][0]) / 1000 : 0
  const hr = hrRows(s, heartFrom)
  const everyS = hr.length >= 3 ? round1(median(hr.slice(1).map((r, i) => (r[0] - hr[i][0]) / 1000))) : null
  const adapt = s.adapt ?? []
  const followed = adapt.filter((a) => a.follows)
  const practice = s.phases.find((p) => p.name === 'session')
  const walk = s.kind === 'walk' && practice ? walkRead(s.head, practice.t0, practice.t1) : null
  const slowest = s.breaths.length ? Math.min(...s.breaths.map((b) => b.perMin)) : null
  const firstSlowest = slowest === null ? null : s.breaths.find((b) => b.perMin === slowest)!
  const started = Date.parse(s.at)
  return {
    at: s.at,
    kind: s.kind,
    day: typeof s.day === 'number' ? s.day : null,
    before,
    after,
    settle,
    smileChange: before.smileDeg !== null && after.smileDeg !== null ? round2(after.smileDeg - before.smileDeg) : null,
    heartChange: before.heartBpm !== null && after.heartBpm !== null ? round1(after.heartBpm - before.heartBpm) : null,
    heartFrom,
    heartSources: [...new Set((s.heartSamples ?? []).map((x) => [x.src, x.model].filter(Boolean).join(', ')))].slice(0, 6),
    heartEveryS: everyS,
    heartSamples: hr.length,
    heartSwing: swing(s, hr, everyS),
    paceFirst: s.breaths.length ? s.breaths[0].perMin : null,
    paceLast: s.breaths.length ? s.breaths[s.breaths.length - 1].perMin : null,
    paceSlowest: slowest,
    paceOwn: s.own && s.own.perMin !== null ? round1(s.own.perMin) : null,
    slowestAtS: firstSlowest && practice ? Math.max(0, Math.round((firstSlowest.t0 - practice.t0) / 1000)) : null,
    practiceS: practice ? Math.round((practice.t1 - practice.t0) / 1000) : null,
    hour: typeof s.tzMin === 'number' && Number.isFinite(started) ? new Date(started + s.tzMin * 60_000).getUTCHours() : null,
    offered: s.offered ?? null,
    checks: adapt.length,
    followed: followed.length,
    byStillness: adapt.filter((a) => a.by === 'stillness').length,
    paceFollowed: followed.length ? Math.min(...followed.map((a) => a.from)) : null,
    walk,
    happened: s.kind !== 'walk' || (!!walk && walk.ofS > 0 && walk.walkedS >= walk.ofS / 3),
    hz: span > 0 ? Math.round(((head.length - 1) / span) * 10) / 10 : 0,
  }
}
