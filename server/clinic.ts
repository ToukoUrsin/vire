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
}

/** One rounded latest full-ping strength, shared by list sentences and the patient chart. */
export function echoNow(a: Analysis): number | null {
  const latest = a.echoes.filter((e) => e.kind === 'full').at(-1)
  return latest ? Math.round(latest.strength) : null
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const ago = (d: number | null) => (d == null ? 'no pings yet' : d === 0 ? 'last ping today' : d === 1 ? 'last ping yesterday' : `last ping ${d} days ago`)
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
  const sig = a.baseline.smile.source === 'clinic' ? 'the well signature' : 'their usual'
  return { daysSilent, slope7: round(slope7, 2), flatDays, riseDays, below, above, sudden, prevAdherence7, nFull: a.nFull, sig }
}

/** Deterministic one-liner: why this person is where they are in the list. */
export function reasonOf(a: Analysis, f: RowFacts, adherence7: number): string {
  const lastPing = ago(f.daysSilent)
  if (f.daysSilent == null) return 'No pings yet'
  if (a.status === 'calibrating') return `Still calibrating: ${f.nFull} of 3 pings so far; ${lastPing}`
  const names = f.below.map((b) => b.channel)
  const where =
    names.length === 4
      ? `all four channels below ${f.sig}, ${names[0]} and ${names[1]} most`
      : names.length
        ? `${list(names)} ${names.length === 2 ? 'both ' : ''}below ${f.sig}`
        : `no single channel far below ${f.sig}`
  if (f.daysSilent >= 4) {
    const before = a.drift <= DIP ? `echo was already slipping (${signed(a.drift)} SD)` : 'echo was steady'
    return `No ping for ${f.daysSilent} days after ${f.prevAdherence7} pings in the week before; ${before} when they went quiet`
  }
  if (a.status === 'low' || a.status === 'dipping') {
    if (f.sudden) {
      const when = f.sudden.daysAgo === 0 ? 'today' : f.sudden.daysAgo === 1 ? 'yesterday' : `${f.sudden.daysAgo} days ago`
      return `Echo dropped sharply ${when} (from ${f.sudden.from} to about ${f.sudden.to} since); ${where}; ${lastPing}`
    }
    if (f.flatDays <= 3 && a.drift < -1.4) {
      const when = f.daysSilent === 1 ? 'yesterday' : f.daysSilent && f.daysSilent > 1 ? `${f.daysSilent} days ago` : 'today'
      const now = echoNow(a)
      return `Echo dropped sharply ${when}${now == null ? '' : ` (now ${now}/100)`}; ${where}; ${lastPing}`
    }
    return `Echo has flattened for ${f.flatDays} ${f.flatDays === 1 ? 'day' : 'days'}; ${where}; ${lastPing}`
  }
  const latest = a.echoes.filter((e) => e.kind === 'full').at(-1)
  if (latest && latest.strength <= 30) return `Latest ping well below ${f.sig} (${Math.round(latest.strength)}/100) after a steady stretch; ${where}; ${lastPing}`
  if (f.riseDays > 0) {
    const up = f.above.map((b) => b.channel).slice(0, 3)
    return `Echo above ${f.sig} for ${f.riseDays} ${f.riseDays === 1 ? 'day' : 'days'}${up.length ? `, led by ${list(up)}` : ''}; ${lastPing}`
  }
  if (f.daysSilent >= 2) return `Steady around ${f.sig}, but ${lastPing}`
  return `Steady around ${f.sig}; pinged ${adherence7} of the last 7 days`
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
  const phqReason = latestPHQ2 && latestPHQ2.total >= 3
    ? `PHQ-2: ${latestPHQ2.total} of 6, at or over the cut-off of 3; echo ${a.status}`
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
  const s1 = p.course
    ? `${p.name} finished a ${p.course.sessions}-session TMS course ${row.daysSinceCourse} days ago; the well signature comes from the clinic pings of its last two weeks.`
    : a.nFull < 3
      ? `${p.name} has ${a.nFull} ${a.nFull === 1 ? 'ping' : 'pings'} so far, so the echo is still read against population values.`
      : `${p.name} has ${a.nFull} pings and no clinic calibration; the baseline is their own first pings.`
  if (a.nFull < 3) return s1
  const chans = f.below.length
    ? `, most in ${list(f.below.slice(0, 2).map((b) => `${b.channel} (${signed(b.z)} SD)`))}`
    : f.above.length && a.drift > 0.4
      ? `, led by ${list(f.above.slice(0, 2).map((b) => `${b.channel} (${signed(b.z)} SD)`))}`
      : ''
  let s2: string
  if (f.daysSilent != null && f.daysSilent >= 4) {
    s2 = `No ping for ${f.daysSilent} days; before that the echo sat at ${echoNow(a) ?? 'not read'}/100 with drift ${signed(a.drift)} SD${chans}.`
  } else if (a.status === 'low' || a.status === 'dipping') {
    const how = f.sudden ? `after a sharp drop ${f.sudden.daysAgo} ${f.sudden.daysAgo === 1 ? 'day' : 'days'} ago (from ${f.sudden.from} to about ${f.sudden.to} since)` : `flattening over ${f.flatDays} ${f.flatDays === 1 ? 'day' : 'days'}`
    s2 = `The home echo is now ${echoNow(a) ?? 'not read'}/100 with drift ${signed(a.drift)} SD, ${how}${chans}; pinged ${row.adherence7} of the last 7 days.`
  } else {
    s2 = `The home echo is ${echoNow(a) ?? 'not read'}/100 with drift ${signed(a.drift)} SD, ${a.drift >= 0.5 ? `above ${f.sig}` : `steady around ${f.sig}`}${chans.replace(', most in', ', lowest in')}; pinged ${row.adherence7} of the last 7 days.`
  }
  const tried = beliefs(p.doses, prior).filter((b) => b.n > 0).sort((x, y) => y.mean - x.mean)
  const top = tried[0]
  const s3 = row.outer && practicesOf(p).length
    ? practiceLine(row.outer, practicesOf(p).length)
    : !top
    ? 'No doses tried at home yet.'
    : top.mean >= 1.5 && top.n >= 2
      ? `${DOSE_LABEL[top.dose]} was followed by the biggest lift at home (${signed(top.mean)} points on average over ${top.n} tries).`
      : top.mean >= 1.5
        ? `${DOSE_LABEL[top.dose]} was followed by a lift the one time it was tried (${signed(top.mean)} points); one try says little.`
        : `No dose has clearly lifted the echo yet (${tried.reduce((n, b) => n + b.n, 0)} tried).`
  const lastStim = p.pings.filter((x) => x.kind === 'full').at(-1)?.stim
  // the phone picks the laugh; the server knows only which one played
  const LAUGHS: Record<string, string> = { 'laugh-1': 'the warm-up laugh', 'laugh-2': 'the bright laugh', 'laugh-3': 'the long laugh', personal: 'a laugh they saved' }
  const stimLine = lastStim && LAUGHS[lastStim] ? ` Last laugh played: ${LAUGHS[lastStim]}.` : ''
  return `${s1} ${s2} ${s3}${stimLine}`
}

/** the summary's line on the phone's practices: counts only, the same words as the list */
export function practiceLine(o: OuterRow, offered: number): string {
  const w = o.working
  const done = w.total
  const head = `The phone offered ${offered} ${offered === 1 ? 'practice' : 'practices'} and ${done} ${done === 1 ? 'was' : 'were'} done`
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
