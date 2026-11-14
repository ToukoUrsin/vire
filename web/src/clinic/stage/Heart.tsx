// The heart: a beat that pulses at the measured rate, the number, where it comes from, and the last half minute of it.
import { useEffect, useRef } from 'react'
import type { HeartSource } from '@shared/types'
import { onFrame, palette, rgba, useCanvas } from './loop'
import type { Stage } from './store'

// the classic heart curve, as a unit polygon centred on its middle
const SHAPE = (() => {
  const pts: number[] = []
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2
    pts.push((16 * Math.pow(Math.sin(t), 3)) / 17, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 - 0.1)
  }
  return pts
})()

/** lub-dub: a sharp rise and a soft fall, then a smaller second one */
const thump = (u: number) => {
  const one = (x: number) => (x < 0 ? 0 : Math.exp(-x * 9) * (1 - Math.exp(-x * 70)))
  return one(u) + 0.5 * one(u - 0.3)
}

const WINDOW = 30_000

export function Heart({ stage, source, dim }: { stage: Stage; source: HeartSource | null; dim: boolean }) {
  const numEl = useRef<HTMLElement>(null)
  const beat = useRef({ ph: 0, bpm: 0 })

  const canvas = useCanvas((s, now, dt) => {
    const { ctx, w, h } = s
    const p = palette()
    ctx.clearRect(0, 0, w, h)
    const last = stage.last
    const live = !!last && now - stage.lastFrameAt < 3000
    const finishedUnread = stage.phoneReadings.breathe?.readable === false
    const bpm = finishedUnread ? null : live && last.bpm !== null ? last.bpm : null
    const bt = beat.current
    if (bpm !== null) {
      bt.bpm += (bpm - bt.bpm) * (bt.bpm ? 0.08 : 1)
      bt.ph = (bt.ph + (bt.bpm / 60) * (dt / 1000)) % 1
    }
    const e = bpm !== null ? thump(bt.ph) : 0
    const side = Math.min(h, w * 0.38)
    const cx = side * 0.5
    const cy = h * 0.5
    const r = side * 0.3 * (1 + 0.17 * e)

    if (bpm !== null) {
      // one ring per beat, leaving the heart
      const ring = side * (0.3 + 0.22 * bt.ph)
      ctx.strokeStyle = rgba(p.heart, 0.5 * (1 - bt.ph) * (1 - bt.ph))
      ctx.lineWidth = Math.max(1, side * 0.012)
      ctx.beginPath()
      ctx.arc(cx, cy, ring, 0, Math.PI * 2)
      ctx.stroke()
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, side * 0.52)
      g.addColorStop(0, rgba(p.heart, 0.2 + 0.3 * e))
      g.addColorStop(1, rgba(p.heart, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, side, h)
    }
    ctx.beginPath()
    for (let i = 0; i < SHAPE.length; i += 2) {
      const x = cx + SHAPE[i] * r
      const y = cy + SHAPE[i + 1] * r
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.closePath()
    if (bpm !== null) {
      ctx.fillStyle = rgba(p.heart, 0.78 + 0.22 * e)
      ctx.fill()
    } else {
      // no pulse yet: an outline that waits
      ctx.strokeStyle = rgba(p.heart, 0.4 + 0.2 * Math.sin(now / 600))
      ctx.lineWidth = Math.max(1.5, side * 0.014)
      ctx.setLineDash([side * 0.02, side * 0.03])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // the rate over the last half minute, on the right
    const x0 = Math.min(w * 0.52, side * 1.25)
    const x1 = w - 2
    const y0 = h * 0.18
    const y1 = h * 0.84
    const fr = stage.frames
    let lo = Infinity
    let hi = -Infinity
    let i0 = fr.length
    while (i0 > 0 && now - fr[i0 - 1].at < WINDOW) i0--
    for (let i = i0; i < fr.length; i++) {
      if (finishedUnread) break
      const v = fr[i].bpm
      if (v === null) continue
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    if (hi > lo - 1 && Number.isFinite(lo)) {
      const mid = (lo + hi) / 2
      const half = Math.max(6, (hi - lo) / 2 + 1.5)
      const yOf = (v: number) => y1 - ((v - (mid - half)) / (2 * half)) * (y1 - y0)
      ctx.strokeStyle = rgba(p.ink, 0.12)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, y1 + 0.5)
      ctx.lineTo(x1, y1 + 0.5)
      ctx.stroke()
      ctx.strokeStyle = rgba(p.heart, 0.95)
      ctx.lineWidth = Math.max(2, h * 0.016)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      let pen = false
      let ex = 0
      let ey = 0
      for (let i = i0; i < fr.length; i++) {
        if (finishedUnread) break
        const v = fr[i].bpm
        if (v === null) {
          pen = false
          continue
        }
        ex = x1 - ((now - fr[i].at) / WINDOW) * (x1 - x0)
        ey = yOf(v)
        if (pen) ctx.lineTo(ex, ey)
        else ctx.moveTo(ex, ey)
        pen = true
      }
      ctx.stroke()
      if (pen && live) {
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(ex, ey, Math.max(3, h * 0.022), 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

  useEffect(() => {
    let lastT = 0
    return onFrame((now) => {
      if (now - lastT < 200) return
      lastT = now
      const el = numEl.current
      if (!el) return
      const s = stage.last
      const t = stage.phoneReadings.breathe?.readable === false
        ? 'not read'
        : s && s.bpm !== null && now - stage.lastFrameAt < 3000
          ? String(Math.round(s.bpm))
          : 'finding the pulse'
      if (el.textContent !== t) el.textContent = t
    })
  }, [stage])

  return (
    <section className={`sg-panel sg-heart${dim ? ' is-dim' : ''}`} aria-label="Heart rate">
      <canvas ref={canvas} />
      <div className="sg-heart-side">
        <header>
          <b>Heart</b>
          <small>{source === 'airpods' ? 'AirPods Pro 3' : source === 'camera' ? 'from the camera' : source === 'none' ? 'finding the pulse' : 'from the phone'}</small>
        </header>
        <p>
          <b ref={numEl}>finding the pulse</b>
          <span>{stage.phoneReadings.breathe?.readable === false ? 'not read' : 'now'}</span>
        </p>
      </div>
    </section>
  )
}
