// The hall wall: what a hall of hackers looks like as four raw channels over a weekend.
// Pure functions only (no I/O, no clock): the server feeds them rows, the tests feed them fixtures and `?demo=` feeds
// them simulated rows. Hall guests ping once or twice, so nothing here uses a personal baseline or the population
// priors: raw channel values are set against the hall's own distribution.
// What it may claim: how a hackathon weekend wears people down (tiredness, less sleep). Never a diagnosis.
import type { Channel, WallChannel, WallDeviceFamily, WallDot, WallHour, WallMe, WallStat, WallState } from '../shared/types'
import { CHANNELS, UNITS, clamp, hashSeed, mulberry32, randNormal, round } from './engine'
import type { Rng } from './engine'

const HOUR = 3600_000
/** Friday 13.11.2026 18:00 in Helsinki (UTC+2): the hackathon starts. */
export const WALL_T0 = Date.parse('2026-11-13T16:00:00Z')
/** Sunday 14:00 Helsinki, the end of the peer review, 44 hours later. */
export const WALL_HOURS = 44
/** two pings this far apart make a returning visitor */
export const MIN_GAP_H = 3
const MAX_POINTS = 2000
const LATEST = 12

// ---------- what a public endpoint lets in ----------

/** Values no phone can produce: a ping carrying one is refused. Everything below is kept, however odd. */
export const HARD_MAX: Record<Channel, number> = { smile: 30, voice: 48, heart: 200, move: 4000 }
/** The range a chart starts from; it widens to the hall's own values. */
const PLAUSIBLE_MAX: Record<Channel, number> = { smile: 3.6, voice: 4.8, heart: 18, move: 130 }

export function absurd(values: Record<Channel, number | null>): boolean {
  return CHANNELS.some((ch) => {
    const v = values[ch]
    return v != null && (!Number.isFinite(v) || v < 0 || v > HARD_MAX[ch])
  })
}

// A nickname goes up on a big screen in a hall: letters and digits only, 16 characters, nothing crude.
const CRUDE =
  /fuck|shit|cunt|bitch|nigg|fagg|penis|vagin|pussy|dick|cock|porn|rape|nazi|hitler|whore|slut|sex|vittu|vitun|huora|pillu|kyrp|mulkku|neekeri|homo|paska/
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '!': 'i' }
export const NICK_MAX = 16

/** The nickname as the wall may show it, or null when there is none worth showing (the guest number stands in). */
export function cleanNick(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _\-'!?&+#]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICK_MAX)
    .trim()
  if (!s || !/[\p{L}\p{N}]/u.test(s)) return null
  const flat = s
    .toLowerCase()
    .replace(/[0134578!]/g, (c) => LEET[c] ?? c)
    .replace(/[^\p{L}]/gu, '')
  if (CRUDE.test(flat) || /^guest\s*\d*$/i.test(s)) return null
  return s
}

const FAMILY_LABEL: Record<WallDeviceFamily, string> = {
  ios: 'iOS Safari',
  android: 'Android Chrome',
  native: 'Native shell',
  desktop: 'Laptop browser',
  other: 'Other',
}
const FAMILIES: WallDeviceFamily[] = ['ios', 'android', 'native', 'desktop', 'other']

/** Device family from the user agent. Every browser on an iPhone is WebKit, so they all read as iOS Safari. */
export function deviceFamily(ua: string, native: boolean): WallDeviceFamily {
  if (native) return 'native'
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Windows NT|Macintosh|X11|CrOS|Linux x86_64/.test(ua)) return 'desktop'
  return 'other'
}
/** Automated traffic (the team's own tests) is stored like any ping but kept out of the hall's numbers. */
export const isTestUa = (ua: string) => /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Lighthouse|^curl|^Wget|^Bun\/|^node|undici|axios|python|Go-http-client|PostmanRuntime|^smoke$/i.test(ua)

// ---------- small statistics ----------

/** linear-interpolated quantile of an ascending array */
export function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * clamp(p, 0, 1)
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)
}
export function stat(xs: number[]): WallStat {
  if (!xs.length) return { n: 0, median: null, q1: null, q3: null }
  const s = [...xs].sort((a, b) => a - b)
  return { n: s.length, median: round(quantile(s, 0.5), 2), q1: round(quantile(s, 0.25), 2), q3: round(quantile(s, 0.75), 2) }
}
/** share (0..100) of `others` below `v`, ties counting half; null under 3 others */
export function percentile(v: number | null, others: number[]): number | null {
  if (v == null || others.length < 3) return null
  let below = 0
  for (const x of others) below += x < v ? 1 : x === v ? 0.5 : 0
  return Math.round((100 * below) / others.length)
}
const share = (k: number, n: number) => (n ? round(k / n, 3) : null)
const niceCeil = (x: number) => {
  const step = 10 ** Math.floor(Math.log10(x)) / 2
  return round(Math.ceil(x / step) * step, 2)
}

// ---------- the wall ----------

export interface WallUser {
  id: string
  /** nickname or "guest 14" */
  label: string
  /** anonymous key shown instead of the id */
  key: string
}
export interface WallPing {
  userId: string
  /** epoch ms */
  t: number
  values: Record<Channel, number | null>
  family: WallDeviceFamily
  /** false = stored but kept out of the hall's numbers (test traffic) */
  counted: boolean
}
export interface WallInput {
  users: WallUser[]
  /** full pings of hall guests */
  pings: WallPing[]
  /** guests who opened the flow, whether or not they finished a ping */
  started: number
  now: number
  t0?: number
  simulated?: boolean
  /** user id for the `me` block */
  me?: string | null
}

const nulls = (): Record<Channel, number | null> => ({ smile: null, voice: null, heart: null, move: null })
const rounded = (v: Record<Channel, number | null>) => {
  const out = nulls()
  for (const ch of CHANNELS) out[ch] = v[ch] == null ? null : round(v[ch], 2)
  return out
}

export function buildWall(input: WallInput): WallState {
  const t0 = input.t0 ?? WALL_T0
  const hOf = (t: number) => round((t - t0) / HOUR, 2)
  const userOf = new Map(input.users.map((u) => [u.id, u]))
  const inWindow = input.pings.filter((p) => p.t >= t0 && p.t <= input.now + 300_000 && userOf.has(p.userId)).sort((a, b) => a.t - b.t)
  const pings = inWindow.filter((p) => p.counted)

  // one entry per visitor, in order of their first ping
  const byUser = new Map<string, WallPing[]>()
  for (const p of pings) {
    const list = byUser.get(p.userId)
    if (list) list.push(p)
    else byUser.set(p.userId, [p])
  }
  const who = new Map([...byUser.keys()].map((id, i) => [id, i + 1]))
  const isBack = (list: WallPing[]) => list.length >= 2 && list.at(-1)!.t - list[0]!.t >= MIN_GAP_H * HOUR
  const back = [...byUser.values()].filter(isBack)

  /** each visitor's latest readable value per channel: the hall "now" */
  const latestOf = new Map<string, Record<Channel, number | null>>()
  for (const [id, list] of byUser) {
    const v = nulls()
    for (const ch of CHANNELS) v[ch] = list.findLast((p) => p.values[ch] != null)?.values[ch] ?? null
    latestOf.set(id, v)
  }
  const others = (ch: Channel, except: string) => {
    const out: number[] = []
    for (const [id, v] of latestOf) if (id !== except && v[ch] != null) out.push(v[ch])
    return out
  }
  const pctOf = (userId: string, values: Record<Channel, number | null>) => {
    const out = nulls()
    for (const ch of CHANNELS) out[ch] = percentile(values[ch], others(ch, userId))
    return out
  }

  const channels: WallChannel[] = CHANNELS.map((channel) => {
    const all = pings.map((p) => p.values[channel]).filter((v): v is number => v != null)
    const now = [...latestOf.values()].map((v) => v[channel]).filter((v): v is number => v != null).sort((a, b) => a - b)
    const hi = Math.min(HARD_MAX[channel], Math.max(PLAUSIBLE_MAX[channel], all.length >= 3 ? niceCeil(quantile([...all].sort((a, b) => a - b), 0.98) * 1.05) : 0))
    const domain: [number, number] = [0, hi]

    const buckets = new Map<number, number[]>()
    for (const p of pings) {
      const h = Math.floor((p.t - t0) / HOUR)
      const v = p.values[channel]
      if (!buckets.has(h)) buckets.set(h, [])
      if (v != null) buckets.get(h)!.push(v)
    }
    const hours: WallHour[] = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([h, xs]) => ({ h, ...stat(xs) }))

    const diffs: number[] = []
    for (const list of back) {
      const a = list[0]!.values[channel]
      const b = list.at(-1)!.values[channel]
      if (a != null && b != null) diffs.push(b - a)
    }
    const BINS = 16
    const counts = Array.from({ length: BINS }, () => 0)
    for (const v of now) counts[clamp(Math.floor(((v - domain[0]) / (domain[1] - domain[0])) * BINS), 0, BINS - 1)]!++
    return {
      channel,
      unit: UNITS[channel],
      readRate: share(all.length, pings.length),
      now: stat(now),
      quantiles: now.length >= 3 ? Array.from({ length: 21 }, (_, i) => round(quantile(now, i / 20), 2)) : [],
      hist: now.length >= 3 ? { lo: domain[0], hi: domain[1], counts } : null,
      hours,
      change: { ...stat(diffs), up: diffs.filter((d) => d > 0).length, down: diffs.filter((d) => d < 0).length },
      domain,
    }
  })

  const shown = pings.slice(-MAX_POINTS)
  const col = (ch: Channel) => shown.map((p) => (p.values[ch] == null ? null : round(p.values[ch], 2)))
  const dot = (p: WallPing, list: WallPing[]): WallDot => {
    const u = userOf.get(p.userId)!
    return {
      key: u.key,
      label: u.label,
      at: new Date(p.t).toISOString(),
      h: hOf(p.t),
      values: rounded(p.values),
      pct: pctOf(p.userId, p.values),
      nth: list.indexOf(p) + 1,
      returning: p.t - list[0]!.t >= MIN_GAP_H * HOUR,
    }
  }

  const rates = (ps: WallPing[]) => {
    const out = nulls()
    for (const ch of CHANNELS) out[ch] = share(ps.filter((p) => p.values[ch] != null).length, ps.length)
    return out
  }
  const devices = FAMILIES.map((family) => {
    const ps = pings.filter((p) => p.family === family)
    return { family, label: FAMILY_LABEL[family], visitors: new Set(ps.map((p) => p.userId)).size, pings: ps.length, readRates: rates(ps) }
  }).filter((d) => d.pings > 0)

  // `me` also answers for someone whose pings are kept out of the hall's numbers, so a test phone still sees its own page
  let me: WallMe | null = null
  const mine = input.me ? inWindow.filter((p) => p.userId === input.me) : []
  if (mine.length) {
    const first = mine[0]!
    const last = mine.at(-1)!
    const change = nulls()
    for (const ch of CHANNELS) change[ch] = mine.length >= 2 && first.values[ch] != null && last.values[ch] != null ? round(last.values[ch] - first.values[ch], 2) : null
    me = {
      ...dot(last, mine),
      counted: last.counted,
      pings: mine.length,
      first: mine.length >= 2 ? { at: new Date(first.t).toISOString(), h: hOf(first.t), values: rounded(first.values) } : null,
      hoursBetween: mine.length >= 2 ? round((last.t - first.t) / HOUR, 1) : null,
      change: mine.length >= 2 ? change : null,
      trail: mine.map((p) => ({ h: hOf(p.t), values: rounded(p.values) })),
    }
  }

  return {
    generatedAt: new Date(input.now).toISOString(),
    since: new Date(t0).toISOString(),
    until: new Date(t0 + WALL_HOURS * HOUR).toISOString(),
    hoursIn: round((input.now - t0) / HOUR, 1),
    simulated: !!input.simulated,
    started: Math.max(input.started, byUser.size),
    visitors: byUser.size,
    pings: pings.length,
    returning: back.length,
    minGapH: MIN_GAP_H,
    channels,
    points: {
      h: shown.map((p) => hOf(p.t)),
      who: shown.map((p) => who.get(p.userId)!),
      values: { smile: col('smile'), voice: col('voice'), heart: col('heart'), move: col('move') },
    },
    latest: pings
      .slice(-LATEST)
      .reverse()
      .map((p) => dot(p, byUser.get(p.userId)!)),
    readRates: rates(pings),
    devices,
    me,
  }
}

// ---------- simulated hall: for `?demo=` (always tagged "simulated") and for seeding a test instance ----------

const NICKS = ['mika', 'ada', 'null ptr', 'kahvi', 'segfault', 'sini', 'noodle', 'ctrl-z', 'otso', 'pixel', 'ville', 'sudo', 'aurora', 'moi', 'laku', 'bit flip', 'emma', 'jq', 'tabs', 'yaml', 'aino', 'grep', 'lumi', '0xCAFE']
const SIM_CENTER: Record<Channel, number> = { smile: 1.55, voice: 2.3, heart: 8.6, move: 62 }
/** how much of each channel a whole weekend takes away in the simulation (a layout aid, not a finding) */
const SIM_WEAR: Record<Channel, number> = { smile: 0.38, voice: 0.2, heart: 0.16, move: 0.28 }
const SIM_MISS: Record<WallDeviceFamily, Record<Channel, number>> = {
  ios: { smile: 0.04, voice: 0.09, heart: 0.22, move: 0.02 },
  android: { smile: 0.06, voice: 0.11, heart: 0.34, move: 0.03 },
  native: { smile: 0.03, voice: 0.08, heart: 0.04, move: 0 },
  desktop: { smile: 0.05, voice: 0.1, heart: 0.27, move: 0.04 },
  other: { smile: 0.1, voice: 0.15, heart: 0.5, move: 0.1 },
}
export const SIM_UA: Record<WallDeviceFamily, string> = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  native: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 VireShell/2',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  other: 'Mozilla/5.0 (Nintendo Switch) AppleWebKit/606.4 (KHTML, like Gecko) NF/6.0',
}

/** how busy the hall is at each clock hour (Helsinki): few people ping at five in the morning */
const busy = (clock: number) => (clock >= 2 && clock < 7 ? 0.12 : clock >= 7 && clock < 10 ? 0.6 : clock < 2 ? 0.55 : 1)
/** 0 = fresh, towards 1 = worn: rises over the weekend, worst before dawn, a little better after a morning */
function wear(h: number): number {
  const clock = (18 + h) % 24
  const night = clock >= 1 && clock < 8 ? 0.16 : 0
  const morning = clock >= 9 && clock < 14 ? -0.08 : 0
  return clamp(h / 46 + night + morning, 0, 1.1)
}

export interface SimPing {
  /** hours since the start */
  h: number
  values: Record<Channel, number | null>
}
export interface SimVisitor {
  n: number
  nick: string | null
  family: WallDeviceFamily
  pings: SimPing[]
}

/** `n` hall guests over the first `hours` of the weekend, deterministic in the seed. */
export function simulateHall(n: number, hours: number, seed = 7): SimVisitor[] {
  const rng: Rng = mulberry32(hashSeed(`hall:${seed}:${n}`))
  const span = clamp(hours, 0.2, WALL_HOURS)
  // arrival times by inverse CDF of the busy curve, in 6-minute steps
  const steps = Math.max(2, Math.round(span * 10))
  const cdf: number[] = []
  let acc = 0
  for (let i = 0; i < steps; i++) cdf.push((acc += busy((18 + (i / steps) * span) % 24)))
  const arrive = () => {
    const x = rng() * acc
    const i = cdf.findIndex((c) => c >= x)
    return (((i < 0 ? steps - 1 : i) + rng()) / steps) * span
  }
  const pick = <T,>(items: [T, number][]): T => {
    let x = rng() * items.reduce((s, it) => s + it[1], 0)
    for (const [item, w] of items) if ((x -= w) <= 0) return item
    return items[0]![0]
  }
  const out: SimVisitor[] = []
  for (let k = 0; k < n; k++) {
    const family = pick<WallDeviceFamily>([['ios', 0.52], ['android', 0.36], ['native', 0.03], ['desktop', 0.07], ['other', 0.02]])
    const own = {} as Record<Channel, number>
    for (const ch of CHANNELS) own[ch] = SIM_CENTER[ch] * Math.exp(0.3 * randNormal(rng))
    const read = (h: number): SimPing => {
      const values = nulls()
      for (const ch of CHANNELS) {
        if (rng() < SIM_MISS[family][ch]) continue
        values[ch] = round(clamp(own[ch] * (1 - SIM_WEAR[ch] * wear(h)) * Math.exp(0.16 * randNormal(rng)), 0.02, HARD_MAX[ch] / 4), 2)
      }
      return { h: round(h, 3), values }
    }
    const first = arrive()
    const pings = [read(first)]
    let last = first
    for (const p of [0.3, 0.25]) {
      const room = span - last - (MIN_GAP_H + 0.2)
      if (room <= 0 || rng() > p) break
      last += MIN_GAP_H + 0.2 + rng() * Math.min(room, 16)
      pings.push(read(last))
    }
    out.push({ n: k + 1, nick: rng() < 0.3 ? NICKS[Math.floor(rng() * NICKS.length)]! : null, family, pings })
  }
  return out.sort((a, b) => a.pings[0]!.h - b.pings[0]!.h).map((v, i) => ({ ...v, n: i + 1 }))
}

/** The simulated hall as a wall. `u` puts the `me` block on a simulated returning visitor. */
export function demoWall(n: number, now: number, opts: { t0?: number; me?: boolean } = {}): WallState {
  const t0 = opts.t0 ?? WALL_T0
  const hours = clamp((now - t0) / HOUR, 0.2, WALL_HOURS)
  const people = simulateHall(clamp(Math.round(n) || 0, 0, 600), hours)
  const users: WallUser[] = people.map((v) => ({ id: `sim${v.n}`, label: v.nick ?? `guest ${v.n}`, key: `sim${v.n}` }))
  const pings: WallPing[] = people.flatMap((v) => v.pings.map((p) => ({ userId: `sim${v.n}`, t: t0 + p.h * HOUR, values: p.values, family: v.family, counted: true })))
  const back = people.filter((v) => v.pings.length >= 2).at(-1) ?? people.at(-1)
  return buildWall({ users, pings, started: Math.round(people.length * 1.25), now, t0, simulated: true, me: opts.me && back ? `sim${back.n}` : null })
}
