// Local stand-in for the server so the loop never dead-ends when /api is down.
// Same shapes as the real API (shared/types.ts); the numbers are a rough copy of the contract's maths.
import type {
  Channel,
  DoseBelief,
  DoseKind,
  DoseResult,
  DoseSuggestion,
  DoseUpload,
  Echo,
  EchoComponent,
  PingKind,
  PingUpload,
} from '@shared/types'
import { CHANNELS, DOSES } from '@shared/types'
import { UNREAD_NOTE, doseHeadline, echoHeadline } from './words'

/** the owner's history and a hall guest's are kept apart */
const KEY = 'vire.local'
const KEY_VISITOR = 'vire.local.v'
const keyOf = (visitor: boolean) => (visitor ? KEY_VISITOR : KEY)

interface LocalPing {
  echo: Echo
  kind: PingKind
  values: Record<Channel, number | null>
}
interface LocalState {
  pings: LocalPing[]
  beliefs: DoseBelief[]
}

const PRIOR: Record<Channel, { c: number; s: number; unit: string }> = {
  smile: { c: 1.4, s: 0.8, unit: 'smile·s' },
  voice: { c: 2.6, s: 1.0, unit: 'st' },
  heart: { c: 7, s: 3.5, unit: 'bpm' },
  move: { c: 55, s: 25, unit: '°/s' },
}

const DOSE_FOR: Record<Channel, DoseKind> = { heart: 'breathe', move: 'forest', smile: 'walk', voice: 'reach' }

const NOTES: Record<Channel, { up: string; same: string; down: string; none: string; learning: string }> = {
  smile: {
    up: 'Your smile came quickly and stayed a while.',
    same: 'Your smile was about as bright as usual.',
    down: 'Your smile came a little slower today.',
    none: 'Your smile was hard to see this time. Good light helps.',
    learning: 'Vire is learning what your smile usually does.',
  },
  voice: {
    up: 'Your voice moved more than usual.',
    same: 'Your voice sounded like your usual voice.',
    down: 'Your voice was a little flatter today.',
    none: 'Your voice was too quiet to read this time.',
    learning: 'Vire is learning the melody of your voice.',
  },
  heart: {
    up: 'Your heart followed your breath easily.',
    same: 'Your heart answered your breath as it usually does.',
    down: 'Your heart moved less with your breath today.',
    none: 'Your pulse was hard to read this time. Good light helps.',
    learning: 'Vire is learning how your heart follows your breath.',
  },
  move: {
    up: 'Your nod was quick and full.',
    same: 'Your nod was your usual nod.',
    down: 'Your nod was smaller and slower today.',
    none: 'Your nod was hard to catch this time.',
    learning: 'Vire is learning how you usually nod.',
  },
}

function load(visitor = false): LocalState {
  try {
    const raw = localStorage.getItem(keyOf(visitor))
    if (raw) return JSON.parse(raw) as LocalState
  } catch {
    /* fall through */
  }
  return { pings: [], beliefs: [] }
}
function save(s: LocalState, visitor = false) {
  try {
    localStorage.setItem(keyOf(visitor), JSON.stringify({ ...s, pings: s.pings.slice(-90) }))
  } catch {
    /* storage full or blocked: carry on */
  }
}

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

function valuesOf(u: PingUpload): Record<Channel, number | null> {
  const f = u.features
  const mini = u.kind === 'mini'
  const v: Record<Channel, number | null> = {
    smile: f.smile.auc,
    voice: mini ? null : (f.voice.f0SdSemitones ?? f.voice.speechFraction * 4),
    heart: f.heart.quality < 0.3 ? null : f.heart.swingBpm,
    move: mini ? null : f.move.nodPeakVelDegS,
  }
  // what the phone could not measure is not a number
  for (const ch of u.unreadable ?? []) v[ch] = null
  return v
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Takes the channels the phone could not read out of an echo, whatever the server made of them: no value, no z,
 * a petal at the usual, a note that says so, and an overall strength from the channels that were read.
 */
export function leaveOut(echo: Echo, unreadable: Channel[], why?: Partial<Record<Channel, string>>): Echo {
  if (!unreadable.length) return echo
  let changed = false
  const components = echo.components.map((c) => {
    if (!unreadable.includes(c.channel)) return c
    if (c.value != null) changed = true
    return { ...c, value: null, z: null, strength: 50, note: why?.[c.channel] ?? UNREAD_NOTE[c.channel] }
  })
  // the server already left them out: its overall number stands
  if (!changed) return { ...echo, components }
  const live = components.filter((c) => c.value != null)
  return { ...echo, components, strength: live.length ? Math.round(mean(live.map((c) => c.strength))) : 50 }
}

/**
 * Before and after a dose, on the channels both pings read (the mini ping reads smile and heart).
 * Whole points, so the three numbers on screen add up. null when there is nothing to compare.
 */
export function measuredChange(pre: Echo | null, post: Echo | null): { before: number; after: number; change: number; channels: Channel[] } | null {
  if (!pre || !post) return null
  const a = new Map(pre.components.map((c) => [c.channel, c]))
  const channels: Channel[] = []
  const xs: number[] = []
  const ys: number[] = []
  for (const c of post.components) {
    const p = a.get(c.channel)
    if (c.value == null || !p || p.value == null) continue
    channels.push(c.channel)
    xs.push(p.strength)
    ys.push(c.strength)
  }
  if (!channels.length) return null
  const before = Math.round(mean(xs))
  const after = Math.round(mean(ys))
  return { before, after, change: after - before, channels }
}

export function localEcho(u: PingUpload, visitor = false): Echo {
  const st = load(visitor)
  const fulls = st.pings.filter((p) => p.kind === 'full')
  const calibrating = fulls.length < 3
  const values = valuesOf(u)

  const components: EchoComponent[] = CHANNELS.map((channel) => {
    const value = values[channel]
    const past = fulls.map((p) => p.values[channel]).filter((v): v is number => v != null)
    let c = PRIOR[channel].c
    let s = PRIOR[channel].s
    if (past.length >= 3) {
      c = median(past)
      s = Math.max(PRIOR[channel].s * 0.4, 1.4826 * median(past.map((v) => Math.abs(v - c))))
    }
    const ready = past.length >= 3
    const zRaw = value == null ? null : (value - c) / s
    const strength = zRaw == null ? 50 : Math.round(clamp(50 + 15 * zRaw, 0, 100))
    const n = NOTES[channel]
    const note = value == null ? n.none : !ready ? n.learning : zRaw! > 0.5 ? n.up : zRaw! < -0.5 ? n.down : n.same
    const reading = value == null ? undefined : channel === 'smile' ? `A smile worth ${Math.round(value * 10) / 10} s of a full smile.` : channel === 'voice' ? `Moved ${Math.round(value * 10) / 10} semitones.` : channel === 'heart' ? `Swung ${Math.round(value)} beats a minute with your breath.` : `${Math.round(value)} degrees a second.`
    return { channel, value, unit: PRIOR[channel].unit, z: ready ? zRaw : null, strength, note, reading }
  })

  const live = components.filter((c) => c.value != null)
  const strength = live.length ? Math.round(live.reduce((a, c) => a + c.strength, 0) / live.length) : 50
  const meanZ = live.length ? live.reduce((a, c) => a + (c.strength - 50) / 15, 0) / live.length : 0
  const prevDrift = fulls.length ? fulls[fulls.length - 1].echo.drift : 0
  const drift = calibrating ? 0 : 0.3 * meanZ + 0.7 * prevDrift
  const status: Echo['status'] = calibrating ? 'calibrating' : drift > -0.75 ? 'steady' : 'dipping'

  const echo: Echo = {
    pingId: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: u.startedAt,
    components,
    strength,
    drift,
    status,
    message: '',
    suggestion: null,
  }
  echo.message = calibrating && !visitor
    ? 'Thank you. Your usual appears after three pings.'
    : echoHeadline(echo, visitor)
  if (u.kind === 'full' && !visitor) echo.suggestion = suggest(components, st.beliefs)

  st.pings.push({ echo, kind: u.kind, values })
  save(st, visitor)
  return echo
}

function suggest(components: EchoComponent[], beliefs: DoseBelief[]): DoseSuggestion {
  const live = components.filter((c) => c.value != null)
  const weakest = [...live].sort((a, b) => a.strength - b.strength)[0]
  const dose = weakest ? DOSE_FOR[weakest.channel] : 'breathe'
  const b = beliefs.find((x) => x.dose === dose)
  const why: Record<DoseKind, string> = {
    breathe: 'Your heart was the quietest part of today’s echo. Slow breathing speaks to it directly.',
    forest: 'Your nod was the quietest part of today’s echo. The forest asks you to turn your head and look around.',
    walk: 'Your smile was the quietest part of today’s echo. A short walk with a beat often wakes things up.',
    reach: 'Your voice was the quietest part of today’s echo. Ten seconds to someone you like uses it gently.',
    smile: 'Your smile was the quietest part of today’s echo. A minute of other people’s laughter lets your face answer.',
    wait: 'Today, just wait: it shows what one minute does on its own, so the other doses can be compared fairly.',
  }
  return { dose, reason: why[dose], expected: b ? b.mean : 4, uncertainty: b ? b.sd : 5 }
}

export function localEchoes(): Echo[] {
  return load()
    .pings.filter((p) => p.kind === 'full')
    .map((p) => p.echo)
}

/**
 * Remember a server echo too, so history survives the server going away. `replaces` is the local id of a ping
 * that waited in the queue: the server's echo takes its place.
 */
export function rememberEcho(echo: Echo, u: PingUpload, visitor = false, replaces?: string) {
  const st = load(visitor)
  const entry: LocalPing = { echo, kind: u.kind, values: valuesOf(u) }
  const i = replaces ? st.pings.findIndex((p) => p.echo.pingId === replaces) : -1
  if (i >= 0) st.pings[i] = entry
  else st.pings.push(entry)
  save(st, visitor)
}

function localPing(pingId: string | null): Echo | null {
  if (!pingId) return null
  return load().pings.find((x) => x.echo.pingId === pingId)?.echo ?? null
}

export function localDose(u: DoseUpload): DoseResult {
  const st = load()
  // the same rule as the server: the measured change where both pings read something, else what the person said
  const measured = measuredChange(localPing(u.prePingId), localPing(u.postPingId))
  const learns = measured != null || u.felt != null
  const reward = measured ? measured.change : (u.felt ?? 0) * 5
  const beliefs: DoseBelief[] = DOSES.map((dose) => {
    const old = st.beliefs.find((b) => b.dose === dose) ?? { dose, n: 0, mean: 3, sd: 6 }
    if (dose !== u.dose || !learns) return old
    const n = old.n + 1
    // prior counts as one pseudo-observation
    const mean = (old.mean * (old.n + 1) + reward) / (n + 1)
    return { dose, n, mean: Math.round(mean * 10) / 10, sd: Math.round((6 / Math.sqrt(n + 1)) * 10) / 10 }
  })
  st.beliefs = beliefs
  save(st)
  return { reward, beliefs, message: doseHeadline(u.dose, measured ? measured.change : null, u.felt) }
}

export function clearLocal() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(KEY_VISITOR)
  } catch {
    /* ignore */
  }
}
