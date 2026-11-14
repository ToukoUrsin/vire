// Typed mock of the clinic API: a deterministic synthetic cohort of 24 people.
// Used while the server is down and behind `?mock=1`. Everything here is simulated and labelled so in the UI.
import { CHANNELS, DOSES } from '@shared/types'
import type { BoosterBooking, Channel, DoseBelief, DoseKind, PatientDetail, PatientRow, PingTraces } from '@shared/types'
import { synthTraces } from './dev/synth'

export type PatientDetailX = PatientDetail & { traces?: PingTraces | null }

const DAY = 86_400_000
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const sstep = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a), 0, 1)
  return u * u * (3 - 2 * u)
}

function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => {
    const u = Math.max(1e-9, next())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
  return { next, gauss }
}

type Profile = 'steady' | 'recovered' | 'dipping' | 'low' | 'quiet' | 'calibrating' | 'live'

interface Seed {
  name: string
  profile: Profile
  /** days since the course ended (for calibrating: days since it started) */
  days: number
  /** profile depth: how far the echo has fallen, in SD */
  depth?: number
  /** days of silence at the end */
  silent?: number
  lead?: Channel[]
}

const PEOPLE: Seed[] = [
  { name: 'Helmi S.', profile: 'low', days: 47, depth: 2.15, lead: ['smile', 'voice'] },
  { name: 'Onni L.', profile: 'quiet', days: 33, depth: 1.2, silent: 6, lead: ['voice', 'move'] },
  { name: 'Venla H.', profile: 'low', days: 61, depth: 1.8, lead: ['move', 'smile'] },
  { name: 'Eero M.', profile: 'dipping', days: 26, depth: 1.7, lead: ['heart', 'voice'] },
  { name: 'Aada N.', profile: 'dipping', days: 52, depth: 1.55, lead: ['smile'] },
  { name: 'Toivo R.', profile: 'quiet', days: 74, depth: 0.2, silent: 4 },
  { name: 'Lumi T.', profile: 'dipping', days: 19, depth: 1.45, lead: ['voice'] },
  { name: 'Aino K.', profile: 'recovered', days: 40, depth: 1.2, lead: ['smile', 'heart'] },
  { name: 'Eino J.', profile: 'steady', days: 12 },
  { name: 'Sofia V.', profile: 'steady', days: 88 },
  { name: 'Leo A.', profile: 'steady', days: 35 },
  { name: 'Ella K.', profile: 'steady', days: 57 },
  { name: 'Oliver S.', profile: 'steady', days: 23 },
  { name: 'Isla M.', profile: 'recovered', days: 66, depth: 0.9, lead: ['move'] },
  { name: 'Elias H.', profile: 'steady', days: 102 },
  { name: 'Pihla R.', profile: 'steady', days: 44 },
  { name: 'Noel L.', profile: 'steady', days: 16 },
  { name: 'Kerttu P.', profile: 'steady', days: 79 },
  { name: 'Joel T.', profile: 'steady', days: 30 },
  { name: 'Hilla N.', profile: 'steady', days: 9 },
  { name: 'Niilo V.', profile: 'calibrating', days: 9 },
  { name: 'Seela J.', profile: 'calibrating', days: 4 },
  { name: 'Aatos M.', profile: 'calibrating', days: 2 },
  { name: 'Stage phone', profile: 'live', days: 0 },
]

const POP: Record<Channel, { center: number; spread: number; unit: string; digits: number }> = {
  smile: { center: 3.2, spread: 0.8, unit: 'smile·s', digits: 2 },
  voice: { center: 3.4, spread: 0.65, unit: 'st', digits: 2 },
  heart: { center: 11, spread: 2.6, unit: 'bpm', digits: 1 },
  move: { center: 96, spread: 20, unit: '°/s', digits: 0 },
}
const CH_WORD: Record<Channel, string> = { smile: 'smile', voice: 'voice', heart: 'heart swing', move: 'nod' }
const DOSE_WORD: Record<DoseKind, string> = { breathe: 'slow breathing', smile: 'smiling along', forest: 'the forest', walk: 'the tempo walk', reach: 'a voice note to a friend', wait: 'just waiting' }

function hexId(r: () => number) {
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(r() * 16).toString(16)
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

function startOfDay(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function build(seed: Seed, idx: number, now: number): PatientDetailX {
  const R = rng(4201 + idx * 7919)
  const r = R.next
  const g = R.gauss
  const id = hexId(r)
  const today = startOfDay(now)
  const courseLen = 40
  const sessions = [30, 30, 30, 25, 36][Math.floor(r() * 5)]
  const calibrating = seed.profile === 'calibrating'
  const live = seed.profile === 'live'

  const courseStart = calibrating ? today - seed.days * DAY : today - (seed.days + courseLen) * DAY
  const courseEnd = courseStart + courseLen * DAY
  const sig = CHANNELS.map((channel) => {
    const p = POP[channel]
    const k = 0.82 + 0.36 * r()
    return { channel, center: +(p.center * k).toFixed(p.digits), spread: +(p.spread * (0.85 + 0.3 * r())).toFixed(p.digits), unit: p.unit }
  })
  // each person's fall is led by one or two channels
  const lead = seed.lead ?? []
  const weight = Object.fromEntries(CHANNELS.map((c) => [c, lead.includes(c) ? 1.35 + 0.2 * r() : lead.length ? 0.62 + 0.2 * r() : 1])) as Record<Channel, number>
  const hour = 7.5 + 13 * r()
  const adherence = seed.profile === 'steady' || seed.profile === 'recovered' ? 0.8 + 0.18 * r() : 0.88
  const depth = seed.depth ?? 0
  const N = seed.days
  const effect: Record<DoseKind, number> = { breathe: 0, smile: 0, forest: 0, walk: 0, reach: 0, wait: 0 }
  const order = (['breathe', 'forest', 'walk', 'reach'] as DoseKind[]).sort(() => r() - 0.5)
  order.forEach((d, i) => (effect[d] = [6.5, 3.6, 1.4, -0.6][i] + g() * 0.6))

  /** the underlying drift, in SD, on home day k (1 = the day after the course ended) */
  const trend = (k: number): number => {
    const wave = 0.18 * Math.sin(k / 5.3 + idx)
    switch (seed.profile) {
      case 'low':
        return wave * 0.5 - depth * sstep(N - 17, N - 5, k)
      case 'dipping':
        return wave * 0.5 - depth * sstep(N - 10, N - 1, k)
      case 'quiet':
        return wave - depth * sstep(N - (seed.silent ?? 5) - 9, N - (seed.silent ?? 5), k)
      case 'recovered':
        return wave - depth * sstep(N - 22, N - 15, k) * (1 - sstep(N - 12, N - 5, k))
      default:
        return wave
    }
  }

  type Ping = PatientDetail['timeline'][number]
  const timeline: Ping[] = []
  const doses: PatientDetail['doses'] = []
  const comp = (z: Record<Channel, number | null>): Ping['components'] =>
    CHANNELS.map((channel, i) => {
      const zc = z[channel]
      if (zc === null) return { channel, value: null, z: null, strength: 50 }
      const s = sig[i]
      const value = Math.max(s.center * 0.05, s.center + s.spread * zc)
      const zz = (value - s.center) / s.spread
      return { channel, value: +value.toFixed(POP[channel].digits), z: +zz.toFixed(2), strength: Math.round(clamp(50 + 15 * zz, 0, 100)) }
    })
  const overall = (c: Ping['components']) => {
    const got = c.filter((x) => x.z !== null)
    return got.length ? Math.round(got.reduce((s, x) => s + x.strength, 0) / got.length) : 50
  }

  // clinic pings during the course: ill at the start, well by the end
  const zIll = -2.3 - 0.7 * r()
  const clinicDays = [1, 4, 8, 11, 15, 18, 22, 25, 29, 32, 36, 39]
  for (const d of clinicDays) {
    const at = courseStart + d * DAY + (9.5 + 3 * r()) * 3_600_000
    if (at > now) break
    if (live) break
    const base = zIll * (1 - sstep(3, 33, d))
    const z = Object.fromEntries(CHANNELS.map((c) => [c, base * (0.85 + 0.3 * r()) + g() * 0.38])) as Record<Channel, number | null>
    const components = comp(z)
    timeline.push({ pingId: `${id.slice(0, 6)}-c${d}`, at: new Date(at).toISOString(), setting: 'clinic', kind: 'full', strength: overall(components), drift: 0, components })
  }

  // home pings after the course
  const silent = seed.silent ?? 0
  if (!calibrating && !live) {
    for (let k = 1; k <= N; k++) {
      if (k > N - silent) break
      const isToday = k === N
      if (isToday && hour > new Date(now).getHours() + new Date(now).getMinutes() / 60) continue
      const forced = seed.profile === 'low' || seed.profile === 'dipping' ? k > N - 12 && (k + idx) % 6 !== 0 : false
      if (!forced && r() > adherence) continue
      const at = courseEnd + k * DAY - (24 - hour) * 3_600_000 + g() * 2_400_000
      const tk = trend(k)
      const z = Object.fromEntries(CHANNELS.map((c) => [c, tk * weight[c] + g() * 0.42])) as Record<Channel, number | null>
      if (r() < 0.06) z.heart = null
      const components = comp(z)
      const strength = overall(components)
      const pingId = `${id.slice(0, 6)}-h${k}`
      timeline.push({ pingId, at: new Date(at).toISOString(), setting: 'home', kind: 'full', strength, drift: 0, components })
      // a flat echo offers a dose; some are taken, then re-measured with a mini ping
      if (strength < 45 && r() < 0.62) {
        const dose = r() < 0.55 ? order[0] : order[Math.floor(r() * 4)]
        const reward = +(effect[dose] + g() * 2.6).toFixed(1)
        const lift = reward / 15
        const mz: Record<Channel, number | null> = {
          smile: (components[0].z ?? 0) + lift * 1.1 + g() * 0.15,
          voice: null,
          heart: components[2].z === null ? null : components[2].z + lift * 0.9 + g() * 0.15,
          move: null,
        }
        const mc = comp(mz)
        doses.push({ at: new Date(at + 150_000).toISOString(), dose, reward, felt: reward > 4 ? 1 : reward < -1 ? -1 : r() < 0.5 ? 0 : 1 })
        timeline.push({ pingId: `${pingId}m`, at: new Date(at + 420_000).toISOString(), setting: 'home', kind: 'mini', strength: clamp(Math.round(strength + reward), 0, 100), drift: 0, components: mc })
      }
    }
  }
  if (live) {
    // a real phone that joined today: two pings, still calibrating
    for (const minsAgo of [55, 9]) {
      const z = Object.fromEntries(CHANNELS.map((c) => [c, g() * 0.4])) as Record<Channel, number | null>
      const components = comp(z).map((c) => ({ ...c, z: null, strength: 50 }))
      timeline.push({ pingId: `${id.slice(0, 6)}-l${minsAgo}`, at: new Date(now - minsAgo * 60_000).toISOString(), setting: 'home', kind: 'full', strength: 50, drift: 0, components })
    }
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at))

  // drift: EWMA (alpha 0.3) of the daily mean z over full pings
  let ewma: number | null = null
  let lastDay = -1
  let dayZ: number[] = []
  const flush = () => {
    if (!dayZ.length) return
    const m = dayZ.reduce((a, b) => a + b, 0) / dayZ.length
    ewma = ewma === null ? m : 0.3 * m + 0.7 * ewma
    dayZ = []
  }
  for (const p of timeline) {
    const day = startOfDay(Date.parse(p.at))
    if (day !== lastDay) {
      flush()
      lastDay = day
    }
    if (p.kind === 'full') dayZ.push((p.strength - 50) / 15)
    const preview: number = dayZ.length ? (ewma === null ? dayZ[0] : 0.3 * (dayZ.reduce((a, b) => a + b, 0) / dayZ.length) + 0.7 * ewma) : (ewma ?? 0)
    p.drift = +preview.toFixed(2)
  }
  flush()
  const drift: number = +(ewma ?? 0).toFixed(2)

  const full = timeline.filter((p) => p.kind === 'full')
  const home = full.filter((p) => p.setting === 'home')
  const last = full[full.length - 1] ?? null
  const fewPings = calibrating || live || full.length < 3
  const status: PatientRow['status'] = fewPings ? 'calibrating' : drift > -0.75 ? 'steady' : drift > -1.5 ? 'dipping' : 'low'

  const spark: (number | null)[] = []
  for (let i = 27; i >= 0; i--) {
    const d0 = today - i * DAY
    const day = full.filter((p) => {
      const t = Date.parse(p.at)
      return t >= d0 && t < d0 + DAY
    })
    spark.push(day.length ? Math.round(day.reduce((s, p) => s + p.strength, 0) / day.length) : null)
  }
  const adherence7 = spark.slice(-7).filter((v) => v !== null).length
  const silentDays = last ? Math.floor((today + DAY - 1 - Date.parse(last.at)) / DAY) : 0

  // which channels lead the change, from the last five home pings
  const recent = home.slice(-5)
  const chMean = CHANNELS.map((c, i) => {
    const zs = recent.map((p) => p.components[i].z).filter((z): z is number => z !== null)
    return { c, z: zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0 }
  }).sort((a, b) => a.z - b.z)
  const leaders = chMean.filter((x) => x.z < -0.8).slice(0, 2).map((x) => CH_WORD[x.c])
  const leadText = leaders.length === 2 ? `${leaders[0]} and ${leaders[1]}` : (leaders[0] ?? '')
  let below = 0
  for (let i = home.length - 1; i >= 0 && home[i].drift < -0.75; i--) below++
  const first = seed.name.split(' ')[0]

  const beliefs: DoseBelief[] = DOSES.map((dose) => {
    const xs = doses.filter((d) => d.dose === dose).map((d) => d.reward)
    const n = xs.length
    const mean = (2.5 + xs.reduce((a, b) => a + b, 0)) / (n + 1)
    return { dose, n, mean: +mean.toFixed(1), sd: +(4.2 / Math.sqrt(n + 1) + 0.5).toFixed(1) }
  })
  const best = [...beliefs].filter((b) => b.n >= 2).sort((a, b) => b.mean - a.mean)[0]

  let priority = 0.06 + 0.1 * r()
  let reason = 'Holding their usual.'
  let summary = `${first} has pinged ${adherence7} of the last 7 days and the echo sits inside the well signature measured at the end of the course. Nothing to do.`
  if (status === 'calibrating') {
    priority = 0.05
    reason = live ? 'Joined today from a real phone. Signature still forming.' : `Course in week ${Math.max(1, Math.ceil(seed.days / 7))}. Signature still forming.`
    summary = live
      ? 'A real device connected to this clinic. Two pings so far, so the echo is compared with population priors until a personal baseline exists.'
      : `${first} is in week ${Math.max(1, Math.ceil(seed.days / 7))} of the TMS course. Clinic pings are building the well signature; home watching starts when the course ends.`
  } else if (status === 'low') {
    priority = clamp(0.78 + (-drift - 1.5) * 0.2, 0, 0.98)
    reason = `Below their well signature for ${below} pings in a row${leadText ? `; ${leadText} lead the drop` : ''}.`
    summary = `${first}'s echo has fallen ${(-drift).toFixed(1)} SD below the signature measured at the end of the course and has stayed there for ${below} pings. ${leadText ? `The drop is led by ${leadText}. ` : ''}${best ? `${cap(DOSE_WORD[best.dose])} still lifts it by about ${best.mean.toFixed(0)} points, but the lift does not hold overnight. ` : ''}Worth a call and a look at a booster session.`
  } else if (silentDays >= 3) {
    priority = clamp(0.3 + 0.04 * silentDays + Math.max(0, -drift) * 0.3, 0, 0.9)
    reason = drift < -0.5 ? `No ping for ${silentDays} days, after a week of drifting down.` : `No ping for ${silentDays} days after ${home.length} steady ones.`
    summary = `${first} pinged ${home.length} times after the course and then stopped ${silentDays} days ago. ${drift < -0.5 ? `The last pings were already ${(-drift).toFixed(1)} SD under the signature${leadText ? `, led by ${leadText}` : ''}. ` : 'The echo was inside the signature when the pings stopped. '}Silence is not a measurement, but it is the most common thing before a relapse is noticed.`
  } else if (status === 'dipping') {
    priority = clamp(0.36 + (-drift - 0.75) * 0.3, 0, 0.6)
    reason = `Drifting down for ${Math.max(below, 2)} pings${leadText ? `; ${leadText} first` : ''}.`
    summary = `${first}'s echo is ${(-drift).toFixed(1)} SD under the well signature and still moving down. ${leadText ? `${cap(leadText)} changed first. ` : ''}${best ? `${cap(DOSE_WORD[best.dose])} has lifted it by about ${best.mean.toFixed(0)} points on ${best.n} tries. ` : ''}Not urgent; look again in two days.`
  } else if (seed.profile === 'recovered') {
    priority = 0.2 + 0.05 * r()
    reason = `Back in range after a dip two weeks ago${best ? `; ${DOSE_WORD[best.dose]} helped` : ''}.`
    summary = `${first} dipped two weeks ago and came back without a booster. ${best ? `${cap(DOSE_WORD[best.dose])} lifted the echo by about ${best.mean.toFixed(0)} points on ${best.n} tries. ` : ''}The last week sits inside the signature.`
  }

  const vigor = clamp(1 + (last ? (last.strength - 50) / 15 : 0) * 0.27, 0.35, 1.2)
  return {
    id,
    name: seed.name,
    synthetic: !live,
    live,
    daysSinceCourse: calibrating || live ? null : N,
    lastPingAt: last?.at ?? null,
    adherence7,
    strength: last?.strength ?? null,
    drift,
    status,
    priority: +priority.toFixed(2),
    reason,
    spark,
    boosterRequested: false,
    course: live ? null : { start: new Date(courseStart).toISOString(), end: new Date(courseEnd).toISOString(), sessions },
    signature: sig,
    timeline,
    beliefs,
    doses,
    summary,
    traces: last ? synthTraces(vigor, idx + 1) : null,
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

let cohort: PatientDetailX[] | null = null
function all(): PatientDetailX[] {
  if (!cohort) {
    const now = Date.now()
    cohort = PEOPLE.map((p, i) => build(p, i, now))
  }
  return cohort
}

export function mockPatients(): PatientRow[] {
  return all()
    .map((d): PatientRow => ({
      id: d.id,
      name: d.name,
      synthetic: d.synthetic,
      live: d.live,
      daysSinceCourse: d.daysSinceCourse,
      lastPingAt: d.lastPingAt,
      adherence7: d.adherence7,
      strength: d.strength,
      drift: d.drift,
      status: d.status,
      priority: d.priority,
      reason: d.reason,
      spark: d.spark,
      boosterRequested: d.boosterRequested,
      outer: d.outer,
    }))
    .sort((a, b) => b.priority - a.priority)
}

export function mockPatient(id: string): PatientDetailX | null {
  return all().find((d) => d.id === id) ?? null
}

/** the mock books the next weekday at 09:00 (or the asked time) and keeps it in memory */
export function mockSetBooster(id: string, on: boolean, at?: string): BoosterBooking | null {
  const d = mockPatient(id)
  if (!d) return null
  d.boosterRequested = on
  if (!on) {
    if (d.outer) d.outer = { ...d.outer, booster: null, state: d.outer.escalatedAt ? 'escalated' : 'drifting' }
    return null
  }
  const t = new Date()
  t.setDate(t.getDate() + 1)
  while (t.getDay() === 0 || t.getDay() === 6) t.setDate(t.getDate() + 1)
  t.setHours(9, 0, 0, 0)
  const booking: BoosterBooking = { at: at ?? t.toISOString(), bookedAt: new Date().toISOString(), by: 'clinic' }
  if (d.outer) d.outer = { ...d.outer, booster: booking, state: 'booked' }
  return booking
}

/** rooms the mock relay pretends to have */
export function mockRooms() {
  const livePerson = all().find((d) => d.live)
  return livePerson ? [{ code: livePerson.id.slice(0, 6).toUpperCase(), name: 'Aino', since: new Date().toISOString() }] : []
}
