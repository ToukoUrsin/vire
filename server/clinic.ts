// Clinic view: priority, the one-line reason and the clinician summary. Pure functions over a Person + Analysis.
import type { BoosterBooking, Channel, OuterRow, PatientDetail, PatientRow } from '../shared/types'
import { CHANNELS, DIP, DOSE_LABEL, UNITS, beliefs, clamp, dayIndex, mean, median, round } from './engine'
import type { Analysis, Person, Prior } from './engine'
import { PRACTICE_LABEL, outerOf, practicesOf } from './outerloop'

export interface RowFacts {
  daysSilent: number | null
  slope7: number
  /** calendar days since the echo went below the dipping line and stayed there */
  flatDays: number
  /** calendar days the echo has been clearly above the signature */
  riseDays: number
  /** channels below the signature over the last 3 pings, lowest first, with their mean z */
  below: { channel: Channel; z: number }[]
  above: { channel: Channel; z: number }[]
  sudden: { daysAgo: number; from: number; to: number } | null
  prevAdherence7: number
  nFull: number
  sig: string
  /** the words for this person: simulated people are simulated AirPods days, real phones did the one-minute camera check */
  airpods: boolean
}

/**
 * The words the clinic uses. Simulated people are simulated days with AirPods in: their four simulated signals carry the
 * AirPods names. The internal keys and the maths stay the camera check's (smile, voice, heart, move); every simulated
 * signal falls with drift, so "below" reads in the direction each name makes sense in.
 * Real phones did the one-minute camera check: their readings keep what was measured.
 */
export const AIR_NAME: Record<Channel, string> = { smile: 'walks', voice: 'head down', heart: 'heart rate', move: 'head movement' }
export const AIR_BELOW: Record<Channel, string> = { smile: 'fewer walks', voice: 'head down longer', heart: 'heart rate higher', move: 'less head movement' }
export const AIR_ABOVE: Record<Channel, string> = { smile: 'more walks', voice: 'head down less', heart: 'heart rate lower', move: 'more head movement' }
const CAM_NAME: Record<Channel, string> = { smile: 'smile', voice: 'voice', heart: 'heart', move: 'nod' }

/** "today" / "yesterday" / "3 days ago" said the way each kind of person was measured */
const ago = (d: number | null, air: boolean) =>
  air
    ? d == null ? 'no days with AirPods in yet' : d === 0 ? 'AirPods in today' : d === 1 ? 'AirPods last in yesterday' : `AirPods last in ${d} days ago`
    : d == null ? 'no camera checks yet' : d === 0 ? 'last camera check today' : d === 1 ? 'last camera check yesterday' : `last camera check ${d} days ago`

/** One rounded latest full-ping strength, shared by list sentences and the patient chart. */
export function echoNow(a: Analysis): number | null {
  const latest = a.echoes.filter((e) => e.kind === 'full').at(-1)
  return latest ? Math.round(latest.strength) : null
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`

/** least-squares slope of y over x; 0 with fewer than 3 points */
export function slope(points: [number, number][]): number {
  if (points.length < 3) return 0
  const mx = mean(points.map((p) => p[0]))
  const my = mean(points.map((p) => p[1]))
  let num = 0
  let den = 0
  for (const [x, y] of points) {
    num += (x - mx) * (y - my)
    den += (x - mx) ** 2
  }
  return den ? num / den : 0
}

/** 0..1. Noisy-OR of four signals, so any one of them can lift a person up the list and silence counts on its own. */
export function priorityOf(drift: number, status: PatientRow['status'], slope7: number, daysSilent: number | null): number {
  const d = clamp(-drift / 2.5, 0, 1)
  const s = status === 'low' ? 1 : status === 'dipping' ? 0.5 : status === 'calibrating' ? 0.1 : 0
  const sl = clamp((-slope7 - 1.5) / 4, 0, 1) // a week's slope is noisy: only a clear fall counts
  const q = daysSilent == null ? 0 : clamp((daysSilent - 1) / 6, 0, 1)
  return round(1 - (1 - 0.6 * d) * (1 - 0.4 * s) * (1 - 0.3 * sl) * (1 - 0.7 * q), 3)
}

export function rowFacts(p: Person, a: Analysis, now: number): RowFacts {
  const today = dayIndex(now)
  const last = p.pings.length ? Math.max(...p.pings.map((x) => new Date(x.at).getTime())) : null
  const daysSilent = last == null ? null : Math.max(0, today - dayIndex(last))
  const recent = a.days.filter((d) => d.day > today - 7)
  const slope7 = recent.length >= 4 ? slope(recent.map((d) => [d.day, d.strength])) : 0

  let flatDays = 0
  let firstFlat: number | null = null
  for (let i = a.days.length - 1; i >= 0 && a.days[i]!.drift <= DIP; i--) firstFlat = a.days[i]!.day
  if (firstFlat != null) flatDays = today - firstFlat + 1

  const lastFull = a.echoes.filter((e) => e.kind === 'full').slice(-3)
  const chan = CHANNELS.map((channel) => {
    const zs = lastFull.map((e) => e.components.find((c) => c.channel === channel)?.z).filter((z): z is number => z != null)
    return { channel, z: zs.length ? round(mean(zs), 1) : 0 }
  })
  const below = chan.filter((c) => c.z <= -0.75).sort((x, y) => x.z - y.z)
  const above = chan.filter((c) => c.z >= 0.6).sort((x, y) => y.z - x.z)

  // a sudden drop: within the last week the echo fell well below the level of the days before, and stayed there
  let sudden: RowFacts['sudden'] = null
  for (let i = 3; i < a.days.length && !sudden; i++) {
    const d = a.days[i]!
    if (d.day <= today - 7) continue
    const before = median(a.days.slice(Math.max(0, i - 5), i).map((x) => x.strength))
    const after = mean(a.days.slice(i).map((x) => x.strength))
    // sudden means the first low day is already most of the way down; a slide gets there step by step
    const recentDrop = today - d.day <= 3 && before >= 35 && before - d.strength >= 0.5 * (before - after)
    if (before >= 42 && before - after >= 18 && (before - d.strength >= 0.7 * (before - after) || recentDrop)) sudden = { daysAgo: today - d.day, from: Math.round(before), to: Math.round(after) }
  }
  // how long the echo has been clearly above the signature
  let riseDays = 0
  for (let i = a.days.length - 1; i >= 0 && a.days[i]!.drift >= 0.5; i--) riseDays = today - a.days[i]!.day + 1
  const lastDay = last == null ? today : dayIndex(last)
  const prevAdherence7 = a.days.filter((d) => d.day <= lastDay && d.day > lastDay - 7).length
  const sig = 'their usual'
  return { daysSilent, slope7: round(slope7, 2), flatDays, riseDays, below, above, sudden, prevAdherence7, nFull: a.nFull, sig, airpods: !!p.synthetic }
}

/** Deterministic one-liner: why this person is where they are in the list. */
export function reasonOf(a: Analysis, f: RowFacts, adherence7: number): string {
  const air = f.airpods
  const last = ago(f.daysSilent, air)
  if (f.daysSilent == null) return air ? 'No days with AirPods in yet' : 'No camera checks yet'
  if (a.status === 'calibrating') return air ? `Still learning their usual: ${f.nFull} of 3 days so far; ${last}` : `Still learning their usual: ${f.nFull} of 3 camera checks so far; ${last}`
  const where = air
    ? f.below.length === 4
      ? `all four signals off their usual, ${AIR_BELOW[f.below[0]!.channel]} and ${AIR_BELOW[f.below[1]!.channel]} most`
      : f.below.length
        ? list(f.below.map((b) => AIR_BELOW[b.channel]))
        : 'no one signal far off their usual'
    : f.below.length === 4
      ? `all four readings below their usual, ${CAM_NAME[f.below[0]!.channel]} and ${CAM_NAME[f.below[1]!.channel]} most`
      : f.below.length
        ? `${list(f.below.map((b) => CAM_NAME[b.channel]))} ${f.below.length === 2 ? 'both ' : ''}below their usual`
        : 'no single reading far below their usual'
  const days = air ? 'Their days' : 'Their checks'
  if (f.daysSilent >= 4) {
    const before = a.drift <= DIP ? `${air ? 'their days were' : 'their checks were'} already slipping (${signed(a.drift)} SD)` : `${air ? 'their days were' : 'their checks were'} steady`
    return air
      ? `AirPods not in for ${f.daysSilent} days, after ${f.prevAdherence7} days with them in the week before; ${before} when they went quiet`
      : `No camera check for ${f.daysSilent} days, after ${f.prevAdherence7} in the week before; ${before} when they went quiet`
  }
  if (a.status === 'low' || a.status === 'dipping') {
    if (f.sudden) {
      const when = f.sudden.daysAgo === 0 ? 'today' : f.sudden.daysAgo === 1 ? 'yesterday' : `${f.sudden.daysAgo} days ago`
      return `${days} dropped sharply ${when} (from ${f.sudden.from} to about ${f.sudden.to} since); ${where}; ${last}`
    }
    if (f.flatDays <= 3 && a.drift < -1.4) {
      const when = f.daysSilent === 1 ? 'yesterday' : f.daysSilent && f.daysSilent > 1 ? `${f.daysSilent} days ago` : 'today'
      const now = echoNow(a)
      return `${days} dropped sharply ${when}${now == null ? '' : ` (now ${now}/100)`}; ${where}; ${last}`
    }
    return `Below their usual for ${f.flatDays} ${f.flatDays === 1 ? 'day' : 'days'}; ${where}; ${last}`
  }
  const latest = a.echoes.filter((e) => e.kind === 'full').at(-1)
  if (latest && latest.strength <= 30) return `${air ? 'Last day' : 'Last check'} well below their usual (${Math.round(latest.strength)}/100) after a steady stretch; ${where}; ${last}`
  if (f.riseDays > 0) {
    const up = f.above.map((b) => (air ? AIR_ABOVE[b.channel] : CAM_NAME[b.channel])).slice(0, 3)
    return `Above their usual for ${f.riseDays} ${f.riseDays === 1 ? 'day' : 'days'}${up.length ? `, led by ${list(up)}` : ''}; ${last}`
  }
  if (f.daysSilent >= 2) return `Steady around their usual, but ${last}`
  return air ? `Steady around their usual; AirPods in ${adherence7} of the last 7 days` : `Steady around their usual; checked ${adherence7} of the last 7 days`
}

export function buildRow(p: Person, a: Analysis, o: { now: number; live: boolean; booster: boolean; booking?: BoosterBooking | null }): { row: PatientRow; facts: RowFacts } {
  const today = dayIndex(o.now)
  const byDay = new Map(a.days.map((d) => [d.day, d]))
  const spark: (number | null)[] = []
  for (let i = 27; i >= 0; i--) spark.push(byDay.get(today - i)?.strength ?? null)
  // days with a full ping, whether or not it could be scored yet (a calibrating person has pinged too)
  const adherence7 = new Set(p.pings.filter((x) => x.kind === 'full').map((x) => dayIndex(x.at)).filter((d) => d > today - 7 && d <= today)).size
  const facts = rowFacts(p, a, o.now)
  const lastFull = a.echoes.filter((e) => e.kind === 'full').at(-1)
  const lastAt = p.pings.length ? p.pings.reduce((m, x) => (new Date(x.at).getTime() > new Date(m).getTime() ? x.at : m), p.pings[0]!.at) : null
  const latestPHQ2 = p.phq2?.at(-1)
  // a two-question self-report, shown beside the signals; Vire has not been checked against it
  const phqReason = latestPHQ2 && latestPHQ2.total >= 3
    ? `the two weekly questions (PHQ-2, two taps) ${latestPHQ2.total} of 6, its cut-off is 3`
    : null
  const baseReason = reasonOf(a, facts, adherence7)
  // the outer loop: for people who carry practices (the simulated ones; real phones are not linked yet), or whom the clinic booked
  const practices = practicesOf(p)
  const booking = o.booking ?? null
  const outer = Array.isArray((p as { practices?: unknown }).practices) || booking ? outerOf({ now: o.now, days: a.days, practices, booking }) : undefined
  const upcoming = !!booking && Date.parse(booking.at) > o.now
  // drift the practices did not answer goes to the top of the list
  const outerPriority = outer?.state === 'escalated' ? 0.97 : 0
  const row: PatientRow = {
    id: p.id,
    name: p.name,
    synthetic: p.synthetic,
    live: o.live,
    daysSinceCourse: p.course ? Math.max(0, today - dayIndex(p.course.end)) : null,
    lastPingAt: lastAt,
    adherence7,
    // whole numbers everywhere: the list, the sentence and the chart must show the same figure
    strength: lastFull ? Math.round(lastFull.strength) : null,
    drift: a.drift,
    status: a.status,
    // a falling week only counts once it has taken the person below their usual
    priority: Math.max(priorityOf(a.drift, a.status, facts.slope7 * clamp((50 - (lastFull?.strength ?? 50)) / 15, 0, 1), facts.daysSilent), phqReason ? 0.95 : 0, outerPriority),
    reason: phqReason ? `${baseReason}; ${phqReason}` : baseReason,
    spark,
    boosterRequested: o.booster || upcoming,
    joinedAt: p.createdAt ?? p.course?.start,
    latestPHQ2: latestPHQ2 ? { at: latestPHQ2.at, total: latestPHQ2.total } : undefined,
    outer,
  }
  return { row, facts }
}

/** Deterministic 2-3 sentence summary for a clinician. Facts only: the clinician decides what they mean. */
export function summaryOf(p: Person, a: Analysis, row: PatientRow, f: RowFacts, prior: Prior): string {
  const air = f.airpods
  const unit = air ? (n: number) => `${n} ${n === 1 ? 'day' : 'days'} with AirPods in` : (n: number) => `${n} camera ${n === 1 ? 'check' : 'checks'}`
  const s1 = p.course
    ? air
      ? `${p.name} finished a ${p.course.sessions}-session TMS course ${row.daysSinceCourse} days ago; their usual comes from the last two weeks of the course.`
      : `${p.name} finished a ${p.course.sessions}-session TMS course ${row.daysSinceCourse} days ago; their usual comes from the camera checks of its last two weeks.`
    : a.nFull < 3
      ? `${p.name} has ${unit(a.nFull)} so far, so it is still read against typical values.`
      : `${p.name} has ${unit(a.nFull)} and no clinic calibration; their usual is from their own first ${air ? 'days' : 'checks'}.`
  if (a.nFull < 3) return s1
  const said = (b: { channel: Channel; z: number }, up: boolean) => (air ? `${(up ? AIR_ABOVE : AIR_BELOW)[b.channel]} (${Math.abs(b.z).toFixed(1)} SD)` : `${CAM_NAME[b.channel]} (${signed(b.z)} SD)`)
  // these are the mean of the last 3 days (or checks): said so, since the chart's labels show the latest one
  const last3 = air ? ' over the last 3 days' : ' over the last 3 checks'
  const chans = f.below.length
    ? `, mostly ${list(f.below.slice(0, 2).map((b) => said(b, false)))}${last3}`
    : f.above.length && a.drift > 0.4
      ? `, led by ${list(f.above.slice(0, 2).map((b) => said(b, true)))}${last3}`
      : ''
  const what = air ? 'Their last day with AirPods in' : 'Their last camera check'
  const kept = air ? `AirPods in ${row.adherence7} of the last 7 days` : `checked ${row.adherence7} of the last 7 days`
  let s2: string
  if (f.daysSilent != null && f.daysSilent >= 4) {
    s2 = `${air ? `AirPods not in for ${f.daysSilent} days; before that the last day` : `No camera check for ${f.daysSilent} days; before that the last check`} scored ${echoNow(a) ?? 'not read'}/100 (50 is their usual) with drift ${signed(a.drift)} SD${chans}.`
  } else if (a.status === 'low' || a.status === 'dipping') {
    const how = f.sudden ? `after a sharp drop ${f.sudden.daysAgo} ${f.sudden.daysAgo === 1 ? 'day' : 'days'} ago (from ${f.sudden.from} to about ${f.sudden.to} since)` : `below their usual for ${f.flatDays} ${f.flatDays === 1 ? 'day' : 'days'}`
    s2 = `${what} scored ${echoNow(a) ?? 'not read'}/100 (50 is their usual) with drift ${signed(a.drift)} SD, ${how}${chans}; ${kept}.`
  } else {
    s2 = `${what} scored ${echoNow(a) ?? 'not read'}/100 (50 is their usual) with drift ${signed(a.drift)} SD, ${a.drift >= 0.5 ? 'above their usual' : 'steady around their usual'}${chans.replace(', mostly', ', lowest in')}; ${kept}.`
  }
  const tried = beliefs(p.doses, prior).filter((b) => b.n > 0).sort((x, y) => y.mean - x.mean)
  const top = tried[0]
  const s3 = row.outer && practicesOf(p).length
    ? practiceLine(row.outer, practicesOf(p).length)
    : air
    ? 'No practices yet.'
    : !top
    ? 'No exercises tried at home yet.'
    : top.mean >= 1.5 && top.n >= 2
      ? `${DOSE_LABEL[top.dose]} was followed by the biggest lift at home (${signed(top.mean)} points on average over ${top.n} tries).`
      : top.mean >= 1.5
        ? `${DOSE_LABEL[top.dose]} was followed by a lift the one time it was tried (${signed(top.mean)} points); one try says little.`
        : `No exercise has clearly lifted the score yet (${tried.reduce((n, b) => n + b.n, 0)} tried).`
  const lastStim = air ? undefined : p.pings.filter((x) => x.kind === 'full').at(-1)?.stim
  // the phone picks the laugh; the server knows only which one played
  const LAUGHS: Record<string, string> = { 'laugh-1': 'the warm-up laugh', 'laugh-2': 'the bright laugh', 'laugh-3': 'the long laugh', personal: 'a laugh they saved' }
  const stimLine = lastStim && LAUGHS[lastStim] ? ` Last laugh played: ${LAUGHS[lastStim]}.` : ''
  return `${s1} ${s2} ${s3}${stimLine}`
}

/** the summary's line on the phone's practices: counts only, the same words as the list */
export function practiceLine(o: OuterRow, offered: number): string {
  const w = o.working
  const done = w.total
  // the days below usual have their own count on the list; said here next to the whole count, so the two are not read as one
  // (also when none were done in those days: the list says "0 of 3 practices done" for them, next to "6 were done" here)
  const inRun = o.driftDays > 0 && o.inDrift.offered > 0 && o.inDrift.done < done ? `, ${o.inDrift.done || 'none'} of them in the ${o.driftDays} ${o.driftDays === 1 ? 'day' : 'days'} below usual` : ''
  const head = `So far the phone offered ${offered} ${offered === 1 ? 'practice' : 'practices'} and ${done} ${done === 1 ? 'was' : 'were'} done${inRun}`
  if (!done) return `${head}.`
  if (w.settled === 0 || w.said === 'early' || w.said === 'none' || !w.best) return `${head}; too early to say which one settles them.`
  const label = PRACTICE_LABEL[w.best].toLowerCase()
  return w.said === 'learned'
    ? `${head}; ${label} settles them most (${w.settled} of ${w.n} sessions).`
    : `${head}; ${label} leads so far (${w.settled} of ${w.n} sessions settled).`
}

export function buildDetail(p: Person, a: Analysis, row: PatientRow, f: RowFacts, prior: Prior): PatientDetail {
  return {
    ...row,
    course: p.course,
    signature: CHANNELS.map((channel) => ({
      channel,
      center: round(a.baseline[channel].center, 2),
      spread: round(a.baseline[channel].spread, 2),
      unit: UNITS[channel],
    })),
    timeline: a.echoes.map((e) => ({
      pingId: e.pingId,
      at: e.at,
      setting: e.setting,
      kind: e.kind,
      strength: e.strength,
      drift: e.drift,
      components: e.components.map((c) => ({ channel: c.channel, value: c.value, z: c.z, strength: c.strength })),
    })),
    beliefs: beliefs(p.doses, prior),
    doses: p.doses.map((d) => ({ at: d.at, dose: d.dose, reward: d.reward ?? 0, felt: d.felt })),
    summary: summaryOf(p, a, row, f, prior),
    wobble: a.wobble,
    phq2: p.phq2 ?? [],
    practices: practicesOf(p),
  }
}
