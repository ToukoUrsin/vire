// The forest: where the head has been, and where the next bird goes because of it.
// Bearings are degrees from the direction the person faced at the start; + is their left, like the head yaw.
// Pure, so the placement runs in tests.
import { clamp, plural, wrap180 } from './num'

export const BIRDS = 3
/** a bird is found by facing it this closely for this long */
export const CONE_DEG = 13
export const HOLD_S = 1.5
/** not found after this long: say where it is */
export const HINT_AFTER_S = 8
/** and after this long, and every eight seconds after, it comes a third of the way to the person */
export const CLOSER_AFTER_S = 16
export const CLOSER_EVERY_S = 8
/** each way from the start that the camera can follow a head while the person still sees the phone */
export const CAMERA_REACH_DEG = 40

const BIN_DEG = 10
const BINS = 360 / BIN_DEG
/** a new bird is a real turn away, but never so far that the first one is behind the person */
const MIN_TURN_DEG = 30
const MAX_TURN_DEG = 90
/** and not on top of one already found */
const APART_DEG = 20

/** how far the head can be followed: the whole circle (a motion sensor), or this many degrees each way (the camera) */
export type Reach = 'circle' | number

export const emptyVisits = (): number[] => new Array<number>(BINS).fill(0)

const binOf = (bearing: number) => clamp(Math.floor((wrap180(bearing) + 180) / BIN_DEG), 0, BINS - 1)
const centreOf = (bin: number) => -180 + (bin + 0.5) * BIN_DEG

/** the head pointed this way for this many seconds */
export function visit(visits: number[], bearing: number, seconds: number) {
  visits[binOf(bearing)]! += seconds
}

const inReach = (bearing: number, reach: Reach) => reach === 'circle' || Math.abs(bearing) <= reach

interface Spot {
  bearing: number
  /** seconds the head has spent here and just beside it */
  seen: number
  /** degrees to the nearest bird already found */
  apart: number
  turn: number
}

function spots(visits: number[], heading: number, reach: Reach, found: number[], minTurn: number, apartMin: number): Spot[] {
  const out: Spot[] = []
  for (let i = 0; i < BINS; i++) {
    const bearing = centreOf(i)
    if (!inReach(bearing, reach)) continue
    const turn = Math.abs(wrap180(bearing - heading))
    if (turn < minTurn || turn > MAX_TURN_DEG) continue
    const apart = found.reduce((least, f) => Math.min(least, Math.abs(wrap180(bearing - f))), 180)
    if (apart < apartMin) continue
    // a glance past a direction counts a little for its neighbours, so a bird lands inside an unvisited stretch, not on its edge
    const seen = visits[i]! + 0.5 * (visits[(i + BINS - 1) % BINS]! + visits[(i + 1) % BINS]!)
    out.push({ bearing, seen, apart, turn })
  }
  return out
}

/** keep the spots that share the lowest value of `key`, give or take `slack` */
function lowest(xs: Spot[], key: (s: Spot) => number, slack: number): Spot[] {
  const least = Math.min(...xs.map(key))
  return xs.filter((s) => key(s) <= least + slack)
}

/**
 * Where the next bird calls from: the least-visited direction within reach. Level directions go to the one
 * furthest from the birds already found, then to the smaller turn, then to chance (`rnd` is Math.random in the app).
 */
export function placeBird(visits: number[], heading: number, reach: Reach, found: number[], rnd: () => number): number {
  let open = spots(visits, heading, reach, found, MIN_TURN_DEG, APART_DEG)
  // a narrow reach can run out of room: first allow a bird near an old one, then a smaller turn
  if (!open.length) open = spots(visits, heading, reach, found, MIN_TURN_DEG, 0)
  if (!open.length) open = spots(visits, heading, reach, found, MIN_TURN_DEG / 2, 0)
  if (!open.length) return wrap180(heading + (rnd() < 0.5 ? -1 : 1) * MIN_TURN_DEG)
  open = lowest(open, (s) => s.seen, 0.05)
  open = lowest(open, (s) => -s.apart, 1)
  open = lowest(open, (s) => s.turn, 1)
  return open[Math.floor(rnd() * open.length)]!.bearing
}

/** the bird comes a third of the way toward where the head points */
export function closer(bearing: number, heading: number): number {
  return wrap180(bearing + wrap180(heading - bearing) / 3)
}

/** where the bird is, in words, from where the head points now */
export function whereWords(bearing: number, heading: number): string {
  const err = wrap180(bearing - heading)
  const side = err > 0 ? 'left' : 'right'
  const turn = Math.abs(err)
  if (turn < 30) return `A little to your ${side}. Turn that way.`
  if (turn < 75) return `To your ${side}. Turn that way.`
  if (turn < 135) return `Over your ${side} shoulder. Turn that way.`
  return `Behind your ${side} shoulder. Turn that way.`
}

export interface Turned {
  /** furthest the head has gone to each side of the start, degrees */
  left: number
  right: number
}

/** Follows the head through the ±180 seam, so a full turn reads as 360 and not as nothing. */
export function createTurnMeter() {
  let last: number | null = null
  let at = 0
  const turned: Turned = { left: 0, right: 0 }
  return {
    turned,
    feed(yaw: number) {
      if (last != null) at += wrap180(yaw - last)
      last = yaw
      turned.left = Math.max(turned.left, at)
      turned.right = Math.max(turned.right, -at)
    },
    rangeDeg: () => Math.min(360, Math.round(turned.left + turned.right)),
  }
}

export function forestEndLine(rangeDeg: number, found: number): string {
  if (found === 0) return `You turned through ${rangeDeg} degrees. No bird was found this time.`
  return `You turned through ${rangeDeg} degrees and found ${plural(found, 'bird')}.`
}
