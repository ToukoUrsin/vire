// The forest's sound: a bed, a stream that stays where it is, and one bird at a bearing.
// The listener turns with the head, so the forest stays put. Bearings: degrees, + is the person's left.
import { audio } from '../../audio'
import type { Handle } from '../../audio'

const BIRD_CLIPS = ['bird-1', 'bird-2', 'bird-3', 'bird-4', 'bird-5', 'bird-6']
/** the stream sits behind the left shoulder: a fixed landmark that makes every head turn audible */
const STREAM_BEARING = 118
/** quiet between two calls of the same bird */
const CALL_GAP_MS = 900

type OldListener = { setOrientation(...a: number[]): void }
type OldPanner = { setPosition(...a: number[]): void }

function place(p: PannerNode, bearing: number, distance: number) {
  const r = (bearing * Math.PI) / 180
  const x = -Math.sin(r) * distance
  const z = -Math.cos(r) * distance
  if (p.positionX) {
    p.positionX.value = x
    p.positionY.value = 0.3
    p.positionZ.value = z
    return
  }
  ;(p as unknown as OldPanner).setPosition(x, 0.3, z)
}

function panner(ctx: AudioContext, out: AudioNode, bearing: number, distance: number): PannerNode {
  const p = ctx.createPanner()
  p.panningModel = 'HRTF'
  p.distanceModel = 'inverse'
  p.refDistance = 1
  p.rolloffFactor = 0.5
  place(p, bearing, distance)
  p.connect(out)
  return p
}

export function createForestSound() {
  const ctx = audio.ctx
  const out = audio.out
  const handles: Handle[] = []
  const streamPan = ctx && out ? panner(ctx, out, STREAM_BEARING, 2.6) : null
  const birdPan = ctx && out ? panner(ctx, out, 0, 2) : null
  const clips = audio.available(BIRD_CLIPS)
  let call: AudioBuffer | null = null
  let nextCallAt = 0

  const keep = (h: Handle | null) => {
    if (h) handles.push(h)
  }
  keep(audio.play('forest-bed', { loop: true, gain: 0.6, fadeIn: 2.5 }) ?? audio.wind(0.1))
  if (streamPan) keep(audio.play('stream', { loop: true, gain: 0.7, fadeIn: 3, dest: streamPan }))

  const turnListener = (yaw: number) => {
    const listener = ctx?.listener
    if (!ctx || !listener) return
    const r = (yaw * Math.PI) / 180
    const fx = -Math.sin(r)
    const fz = -Math.cos(r)
    if (listener.forwardX) {
      const t = ctx.currentTime
      listener.forwardX.setTargetAtTime(fx, t, 0.03)
      listener.forwardY.setTargetAtTime(0, t, 0.03)
      listener.forwardZ.setTargetAtTime(fz, t, 0.03)
      return
    }
    ;(listener as unknown as OldListener).setOrientation(fx, 0, fz, 0, 1, 0)
  }

  return {
    turnListener,
    /** bird number `n` (0 is the first) starts calling from `bearing` */
    newBird(n: number, bearing: number) {
      const name = clips.length ? clips[n % clips.length]! : null
      call = name ? audio.buffer(name) : audio.birdBuffer(n + 1)
      nextCallAt = 0
      if (birdPan) place(birdPan, bearing, 2)
    },
    moveBird(bearing: number) {
      if (birdPan) place(birdPan, bearing, 1.7)
    },
    /** call again whenever the last call and its pause are over */
    callIfDue(now: number) {
      if (!call || !birdPan || now < nextCallAt) return
      audio.playBuffer(call, { gain: 1, dest: birdPan })
      nextCallAt = now + call.duration * 1000 + CALL_GAP_MS
    },
    quietBird() {
      call = null
    },
    found() {
      if (!audio.play('found', { gain: 0.9 })) audio.bell(0.3, 1046)
    },
    stop() {
      handles.forEach((h) => h.stop(500))
      window.setTimeout(() => {
        streamPan?.disconnect()
        birdPan?.disconnect()
        turnListener(0)
      }, 700)
    },
  }
}
export type ForestSound = ReturnType<typeof createForestSound>
