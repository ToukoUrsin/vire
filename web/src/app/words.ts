// Every sentence that speaks about a number is written here, from that number, so the words and the picture cannot disagree.
import type { Channel, DoseBelief, DoseKind, Echo, HeartSource, MoveSource } from '@shared/types'

export const HONEST = 'A measured loop, not a diagnosis.'

/** a petal counts as past (or inside) the usual from here: the same line the per-channel notes use */
const NEAR = 6
const FAR = 18

const PART: Record<Channel, string> = { smile: 'your smile', voice: 'your voice', heart: 'your heart', move: 'your nod' }

function list(chs: Channel[]): string {
  const xs = chs.map((c) => PART[c])
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`
}

/** the plain sentence for what could not be measured; null when everything was */
export function unreadLine(chs: Channel[]): string | null {
  if (!chs.length) return null
  return `I couldn’t read ${list(chs)} today, so ${chs.length > 1 ? 'they are' : 'it is'} left out of this echo.`
}

/** the fallback note for a channel left out, when the ping did not say why */
export const UNREAD_NOTE: Record<Channel, string> = {
  smile: 'I couldn’t read your smile today.',
  voice: 'I couldn’t read your voice today.',
  heart: 'I couldn’t read your heart today.',
  move: 'I couldn’t read your nod today.',
}

/** The one line over an echo. Written from the echo's own strength and status, never from a free-text message. */
export function echoHeadline(echo: Echo, visitor = false): string {
  if (!echo.components.some((c) => c.value != null)) return 'I couldn’t read enough for an echo this time.'
  if (echo.status === 'calibrating') return visitor ? 'Here is your first echo.' : 'Thank you. Vire is still learning your usual.'
  const d = echo.strength - 50
  const lately = echo.status === 'dipping' || echo.status === 'low'
  if (d >= FAR) return 'Your echo came back clearly stronger than your usual today.'
  if (d >= NEAR) return 'Your echo came back a little stronger than your usual today.'
  if (d <= -FAR) return `Your echo is clearly quieter than your usual today${lately ? ', as it has been lately' : ''}.`
  if (d <= -NEAR) return `Your echo is a little quieter than your usual today${lately ? ', as it has been lately' : ''}.`
  return lately
    ? 'Your echo is close to your usual today. Over the last few days it has run a little quieter.'
    : 'Your echo is close to your usual today.'
}

export const DOSE_WORD: Record<DoseKind, string> = {
  breathe: 'slow breathing',
  smile: 'smiling along',
  forest: 'the forest',
  walk: 'the walk',
  reach: 'reaching out',
  wait: 'waiting quietly',
}

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`

/**
 * What one dose did, this time. `change` is the measured difference in whole points (after minus before, on the
 * channels both pings read); null when there was nothing to compare, and then only what the person said counts.
 */
export function doseHeadline(dose: DoseKind, change: number | null, felt: -1 | 0 | 1 | null): string {
  const w = DOSE_WORD[dose]
  if (change != null) {
    if (change >= 2) return `Your echo rose ${points(change)} after ${w}.`
    if (change <= -2) return `Your echo was ${points(-change)} quieter after ${w} this time.`
    return `Your echo stayed about the same after ${w}.`
  }
  if (felt == null) return `Vire couldn’t measure a change this time, so its guess about ${w} stays where it was.`
  const said = felt > 0 ? 'a bit better' : felt < 0 ? 'a bit worse' : 'about the same'
  return `You felt ${said} after ${w}. Vire couldn’t measure the change this time, so it goes by what you said.`
}

/** the small tag on the dose just tried: today's own result, next to the running guess */
export function todayTag(change: number | null, felt: -1 | 0 | 1 | null): string | null {
  if (change != null) return `today ${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}`
  if (felt == null) return null
  return felt > 0 ? 'today: felt better' : felt < 0 ? 'today: felt worse' : 'today: felt the same'
}

/** Vire's running guess for one dose, for next time */
export function beliefWords(b: DoseBelief): string {
  if (b.n === 0) return 'not tried yet'
  const m = Math.round(b.mean)
  const sure = b.n < 3 ? ', early days' : b.sd > 3 ? ', still unsure' : ''
  if (m >= 1) return `about ${points(m)} up${sure}`
  if (m <= -1) return `about ${points(-m)} down${sure}`
  return `about the same${sure}`
}

/** where the head and heart signals come from, plainly */
export function sourceLine(head: MoveSource | null, heart: HeartSource | null): string {
  const h = head === 'airpods' ? 'AirPods' : 'camera'
  const p = heart === 'airpods' ? 'AirPods Pro 3' : heart === 'none' ? 'not read' : 'camera'
  return `Head: ${h} · Heart: ${p}`
}
