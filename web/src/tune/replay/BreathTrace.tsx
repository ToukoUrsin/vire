// The claim of the breathing practice, drawn: the sound's rise and fall, and the head's slow movement as the AirPods
// felt it, side by side over the last half minute of the run playing. Whatever was measured is drawn. When no breath
// could be read the head's line is not a wave, and the pace check next to it says so.
import { useMemo } from 'react'
import type { ReplayBundle } from '@shared/earreplay'
import './breath-trace.css'

const W = 340
const H = 58
const SPAN_MS = 28_000
const ease = (x: number) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, x)))) / 2

/** the sound at t: 0 at the bottom of a breath, 1 at the top; null between breaths */
export function seaAt(breaths: ReplayBundle['breaths'], t: number): number | null {
  for (const b of breaths) {
    if (t < b.t0) return null
    if (t < b.tMid) return ease((t - b.t0) / Math.max(1, b.tMid - b.t0))
    if (t < b.t1) return 1 - ease((t - b.tMid) / Math.max(1, b.t1 - b.tMid))
  }
  return null
}

/**
 * How the head's line is drawn against the sound: its size (top to bottom of most of it, degrees) and which way is up.
 * Which way a breath tips a head differs from person to person, so the line is drawn the way up that goes with the
 * sound over the whole practice. That is a choice of drawing: the pace checks never use it.
 */
export function traceScale(slow: [number, number][], breaths: ReplayBundle['breaths']): { top: number; up: 1 | -1 } {
  const sizes = slow.map((r) => Math.abs(r[1])).sort((a, b) => a - b)
  const top = Math.max(0.05, sizes[Math.floor(sizes.length * 0.95)] ?? 0.05)
  let with_ = 0
  for (const r of slow) {
    const s = seaAt(breaths, r[0])
    if (s !== null) with_ += (s - 0.5) * r[1]
  }
  return { top, up: with_ < 0 ? -1 : 1 }
}

export default function BreathTrace({ b, t }: { b: ReplayBundle; t: number }) {
  const slow = b.slow
  const scale = useMemo(() => (slow && slow.length > 20 ? traceScale(slow, b.breaths) : null), [slow, b.breaths])
  if (!slow || !scale) return null
  const from = t - SPAN_MS
  const x = (ms: number) => ((ms - from) / SPAN_MS) * W
  const mid = H / 2
  const reach = H / 2 - 5
  let sea = ''
  let gap = true
  for (let ms = Math.max(from, b.breaths[0]?.t0 ?? from); ms <= t; ms += 250) {
    const s = seaAt(b.breaths, ms)
    if (s === null) {
      gap = true
      continue
    }
    sea += `${gap ? 'M' : 'L'}${x(ms).toFixed(1)},${(mid - (s - 0.5) * 2 * reach).toFixed(1)}`
    gap = false
  }
  let head = ''
  for (const r of slow) {
    if (r[0] < from || r[0] > t) continue
    const y = mid - Math.max(-1, Math.min(1, (scale.up * r[1]) / scale.top)) * reach
    head += `${head ? 'L' : 'M'}${x(r[0]).toFixed(1)},${y.toFixed(1)}`
  }
  const size = scale.top * 2
  return (
    <figure className="bt" data-breath-trace>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The sound's rise and fall, and the head's slow movement, over the last half minute">
        {sea && <path className="bt-sea" d={sea} />}
        {head && <path className="bt-head" d={head} />}
      </svg>
      <figcaption>
        <span className="bt-k-sea">the sea: up is breathe in</span>
        <span className="bt-k-head">
          the head&rsquo;s slow movement, {size < 1 ? size.toFixed(1) : Math.round(size)}° top to bottom{b.scripted ? ' (a stand-in)' : ''}
        </span>
      </figcaption>
    </figure>
  )
}
