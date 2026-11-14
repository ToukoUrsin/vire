// Where the head points in the forest: degrees from where it pointed at the start, + is the person's left.
// AirPods when they are in, otherwise the camera plus the phone's own rotation when it is held up,
// and a finger on the forest when nothing can sense a turn.
import type { Sense } from '../../../sense/types'
import { CAMERA_REACH_DEG } from '../birds'
import type { Reach } from '../birds'
import { clamp, wrap180 } from '../num'

type Compass = DeviceOrientationEvent & { webkitCompassHeading?: number }

/** a drag takes over from the sensors for this long after the finger moves */
const DRAG_HOLDS_MS = 1200
const PITCH_MAX_DEG = 18

export function createHeading(sense: Sense | null) {
  let head: number | null = null
  let head0: number | null = null
  let pitch: number | null = null
  let pitch0: number | null = null
  let fromAirPods = false
  let phone: number | null = null
  let phone0: number | null = null
  let dragged = 0
  let draggedUntil = 0

  const off = sense?.on('head', (f) => {
    head = f.yaw
    pitch = f.pitch
    fromAirPods = f.source === 'airpods'
    head0 ??= f.yaw
    pitch0 ??= f.pitch
  })

  const onPhoneTurn = (ev: DeviceOrientationEvent) => {
    const e = ev as Compass
    const tilt = e.beta ?? 0
    // only while the phone is held up: flat on a table its compass says nothing about the head
    if (tilt < 35 || tilt > 140) return
    const v = typeof e.webkitCompassHeading === 'number' ? -e.webkitCompassHeading : e.alpha
    if (v == null) return
    phone = v
    phone0 ??= v
  }
  window.addEventListener('deviceorientation', onPhoneTurn)

  const sensed = () => head != null || phone != null

  return {
    sensed,
    /** the camera's zero, so a scripted head (demo signals) can be sent to a forest bearing */
    headZero: () => head0 ?? 0,
    yaw(now: number): number {
      if (!sensed() || now < draggedUntil) return dragged
      const byHead = head != null && head0 != null ? wrap180(head - head0) : 0
      // AirPods already turn with the body; the camera only sees the head against the phone
      const byPhone = !fromAirPods && phone != null && phone0 != null ? wrap180(phone - phone0) : 0
      return wrap180(byHead + byPhone)
    },
    pitch: () => (pitch != null && pitch0 != null ? clamp(pitch - pitch0, -PITCH_MAX_DEG, PITCH_MAX_DEG) : 0),
    /** how far a turn can be followed: all the way round with a motion sensor or a finger, the camera's view otherwise */
    reach: (): Reach => (fromAirPods || phone != null || !sensed() ? 'circle' : CAMERA_REACH_DEG),
    drag(yaw: number) {
      dragged = yaw
      draggedUntil = performance.now() + DRAG_HOLDS_MS
    },
    stop() {
      off?.()
      window.removeEventListener('deviceorientation', onPhoneTurn)
    },
  }
}
export type Heading = ReturnType<typeof createHeading>
