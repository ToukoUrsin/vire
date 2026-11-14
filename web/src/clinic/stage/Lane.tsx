// The focus lane: the one thing being asked right now, drawn as its answer arrives. The trace starts at the left when
// the phase starts and reaches the right when it ends, so the lane is also the clock of the phase.
import { useEffect, useRef } from 'react'
import type { MoveSource, PhaseKey } from '@shared/types'
import { eased, onFrame, palette, rgba, useCanvas } from './loop'
import type { Surface } from './loop'
import { LAUGH_ONSET_MS } from './store'
import type { Mode, RunPhase, Sample, Stage } from './store'
import { stepReadingText, stepReadingWhy } from '../../app/echoText'

type Kind = PhaseKey | 'dose' | 'none'
const DOSE_WINDOW = 40_000
const MOVE_TINT = '#aab4f2'
const VOICE_TINT = '#8fe0d4'
const PITCH_INK = '#f1fffc'

const COPY: Record<Kind, { title: string; unit: string; wait: string }> = {
  none: { title: '', unit: '', wait: '' },
  settle: { title: 'Resting face', unit: 'resting pulse', wait: 'finding the pulse' },
  nod: { title: 'Head pitch', unit: 'at the fastest moment of the nod', wait: 'waiting for the nod' },
  laugh: { title: 'Smile', unit: 'from the laughter to the smile', wait: 'waiting for the smile' },
  speak: { title: 'Voice: loudness and pitch', unit: 'semitones of pitch movement', wait: 'waiting for the voice' },
  breathe: { title: 'Heart rate, breath by breath', unit: 'beats a minute, lowest to highest', wait: 'following the breath' },
  dose: { title: 'Heart rate during the dose', unit: 'beats a minute', wait: 'finding the pulse' },
}

function kindOf(stage: Stage, mode: Mode): { kind: Kind; ph: RunPhase | null } {
  if (mode === 'dose') return { kind: 'dose', ph: null }
  const run = stage.run
  const ph = run && run.phases.length ? run.phases[run.phases.length - 1] : null
  return ph ? { kind: ph.key, ph } : { kind: 'none', ph: null }
}

/** a line with a soft halo, without shadowBlur (cheap enough for 60 fps on a projector laptop) */
function glowLine(ctx: CanvasRenderingContext2D, pts: number[], color: string, halo: string, width: number) {
  if (pts.length < 4) return
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
    ctx.stroke()
  }
  ctx.strokeStyle = rgba(halo, 0.1)
  ctx.lineWidth = width * 4.2
  path()
  ctx.strokeStyle = rgba(halo, 0.22)
  ctx.lineWidth = width * 2.3
  path()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  path()
}

function fillUnder(ctx: CanvasRenderingContext2D, pts: number[], y0: number, color: string, alpha: number) {
  if (pts.length < 4) return
  let top = y0
  for (let i = 1; i < pts.length; i += 2) top = Math.min(top, pts[i])
  const g = ctx.createLinearGradient(0, top, 0, y0)
  g.addColorStop(0, rgba(color, alpha))
  g.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(pts[0], y0)
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.lineTo(pts[pts.length - 2], y0)
  ctx.closePath()
  ctx.fill()
}

function endDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5)
  g.addColorStop(0, rgba(color, 0.55))
  g.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(x - r * 4.5, y - r * 4.5, r * 9, r * 9)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

export function Lane({ stage, mode, headSource, hasEar, camera }: { stage: Stage; mode: Mode; headSource: MoveSource | null; hasEar: boolean; camera?: boolean | null }) {
  const valEl = useRef<HTMLElement>(null)
  const unitEl = useRef<HTMLElement>(null)
  const scale = useRef({ pitch: 14, lo: 60, hi: 76, level: 0.12 })
  const { kind } = kindOf(stage, mode)

  const canvas = useCanvas((s: Surface, now) => {
    const { ctx, w, h, em } = s
    const p = palette()
    ctx.clearRect(0, 0, w, h)
    const { kind: k, ph } = kindOf(stage, mode)
    if (k === 'none') return
    // the window: this phase from start to end. A phase the mirror joined half way scrolls instead.
    let t0: number
    let t1: number
    if (!ph) {
      t1 = now
      t0 = now - DOSE_WINDOW
    } else if (ph.known) {
      t0 = ph.at
      t1 = Math.max(ph.at + ph.ms, ph.end ?? 0)
    } else {
      t1 = ph.end ?? now
      t0 = t1 - ph.ms
    }
    const until = ph?.end ?? now
    const padL = 2
    const padR = em * 0.9
    // the laugh lane keeps two lines of labels above the trace
    const top = k === 'laugh' ? em * 3.4 : em * 1.7
    const head = em * 1.1
    const bot = h - em * 0.5
    const xOf = (at: number) => padL + ((at - t0) / (t1 - t0)) * (w - padL - padR)
    const xs: Sample[] = stage.between(t0, until)
    const m = stage.run?.m
    const lw = Math.max(2.5, em * 0.19)
    const text = (str: string, x: number, y: number, alpha = 0.7, align: CanvasTextAlign = 'left') => {
      ctx.font = `500 ${em}px Inter, system-ui, sans-serif`
      ctx.textAlign = align
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = rgba(p.ink, alpha)
      ctx.fillText(str, x, y)
    }
    const hair = (x: number, a: number, dash = false) => {
      ctx.strokeStyle = rgba(p.ink, a)
      ctx.lineWidth = 1
      if (dash) ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, head - em * 0.9)
      ctx.lineTo(Math.round(x) + 0.5, bot)
      ctx.stroke()
      ctx.setLineDash([])
    }
    const level = (y: number, x0: number, x1: number, a: number) => {
      ctx.strokeStyle = rgba(p.ink, a)
      ctx.lineWidth = 1
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.moveTo(x0, Math.round(y) + 0.5)
      ctx.lineTo(x1, Math.round(y) + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
    }
    // floor
    ctx.fillStyle = rgba(p.ink, 0.14)
    ctx.fillRect(padL, Math.round(bot), w - padL - padR, 1)

    const sc = scale.current
    if (k === 'settle' || k === 'laugh') {
      let peak = 0.5
      for (const q of xs) peak = Math.max(peak, q.smile, q.ear ?? 0)
      const yOf = (v: number) => bot - (Math.min(v, peak) / peak) * (bot - top) * 0.94
      const base = m?.restSmile ?? null
      if (k === 'laugh' && ph && ph.known) {
        const on = xOf(ph.at + LAUGH_ONSET_MS)
        hair(on, 0.4)
        text('laughter starts', on + em * 0.4, head, 0.7)
        // The phone's finished latency is shown in the strip. The trace stays a live trace here.
      }
      if (base !== null && xs.length) {
        level(yOf(base), padL, w - padR, 0.3)
        if (k === 'settle') text('resting level', w - padR, yOf(base) - em * 0.4, 0.6, 'right')
      }
      const sm: number[] = []
      const ck: number[] = []
      const er: number[] = []
      for (const q of xs) {
        const x = xOf(q.at)
        sm.push(x, yOf(q.smile))
        ck.push(x, yOf(q.cheek))
        if (q.ear !== null) er.push(x, yOf(q.ear))
      }
      fillUnder(ctx, sm, bot, p.smile, 0.3)
      if (ck.length >= 4) {
        ctx.strokeStyle = rgba(p.smile, 0.45)
        ctx.lineWidth = lw * 0.5
        ctx.beginPath()
        ctx.moveTo(ck[0], ck[1])
        for (let i = 2; i < ck.length; i += 2) ctx.lineTo(ck[i], ck[i + 1])
        ctx.stroke()
      }
      glowLine(ctx, sm, p.smile, p.smile, lw)
      if (er.length >= 4) {
        ctx.strokeStyle = rgba('#ffffff', 0.92)
        ctx.lineWidth = lw * 0.62
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(er[0], er[1])
        for (let i = 2; i < er.length; i += 2) ctx.lineTo(er[i], er[i + 1])
        ctx.stroke()
      }
      if (sm.length && !ph?.end) endDot(ctx, sm[sm.length - 2], sm[sm.length - 1], p.smile, lw * 1.1)
    } else if (k === 'nod') {
      let far = 12
      for (const q of xs) far = Math.max(far, Math.abs(q.pitch) * 1.2)
      sc.pitch += (far - sc.pitch) * 0.08
      const mid = (top + bot) / 2
      const yOf = (v: number) => mid - (Math.max(-sc.pitch, Math.min(sc.pitch, v)) / sc.pitch) * ((bot - top) / 2) * 0.94
      level(mid, padL, w - padR, 0.3)
      text('chin up', w - padR, head, 0.6, 'right')
      text('chin down', w - padR, bot - em * 0.45, 0.6, 'right')
      const pts: number[] = []
      for (const q of xs) pts.push(xOf(q.at), yOf(q.pitch))
      glowLine(ctx, pts, MOVE_TINT, p.move, lw)
      // No answer marker is derived on the mirror. The phone sends the finished nod reading.
      if (pts.length && !ph?.end) endDot(ctx, pts[pts.length - 2], pts[pts.length - 1], p.move, lw * 1.1)
    } else if (k === 'speak') {
      let loud = 0.05
      for (const q of xs) loud = Math.max(loud, q.level)
      sc.level += (loud - sc.level) * 0.1
      const mid = top + (bot - top) * 0.56
      const amp = (q: Sample) => Math.min(1, q.level / sc.level) * (bot - top) * 0.42
      if (xs.length > 1) {
        ctx.fillStyle = rgba(p.voice, 0.42)
        ctx.beginPath()
        xs.forEach((q, i) => (i ? ctx.lineTo(xOf(q.at), mid - amp(q)) : ctx.moveTo(xOf(q.at), mid - amp(q))))
        for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xOf(xs[i].at), mid + amp(xs[i]))
        ctx.closePath()
        ctx.fill()
      }
      const lo = Math.log2(85)
      const hi = Math.log2(340)
      let runPts: number[] = []
      let lastX = 0
      let lastY = 0
      for (const q of xs) {
        if (q.f0 === null) {
          if (runPts.length) glowLine(ctx, runPts, PITCH_INK, VOICE_TINT, lw * 0.9)
          runPts = []
          continue
        }
        const u = (Math.log2(Math.min(340, Math.max(85, q.f0))) - lo) / (hi - lo)
        lastX = xOf(q.at)
        lastY = bot - (0.08 + 0.84 * u) * (bot - top)
        runPts.push(lastX, lastY)
      }
      if (runPts.length) {
        glowLine(ctx, runPts, PITCH_INK, VOICE_TINT, lw * 0.9)
        if (!ph?.end) endDot(ctx, lastX, lastY, p.voice, lw)
      }
      text('pitch', w - padR, head, 0.7, 'right')
      text('loudness', w - padR, bot - em * 0.45, 0.7, 'right')
    } else {
      // the heart: breathe (in and out bands, the swing) or the dose (a scrolling half minute)
      let lo = Infinity
      let hi = -Infinity
      for (const q of xs) {
        if (q.bpm === null) continue
        lo = Math.min(lo, q.bpm)
        hi = Math.max(hi, q.bpm)
      }
      if (Number.isFinite(lo)) {
        const c = (lo + hi) / 2
        const half = Math.max(5.5, (hi - lo) / 2 + 2)
        sc.lo += (c - half - sc.lo) * 0.08
        sc.hi += (c + half - sc.hi) * 0.08
      }
      const yOf = (v: number) => bot - ((v - sc.lo) / (sc.hi - sc.lo)) * (bot - top) * 0.9 - (bot - top) * 0.05
      if (k === 'breathe' && ph && ph.known) {
        for (let b = 0; ph.at + b * 5000 < t1; b++) {
          const xa = xOf(ph.at + b * 5000)
          const xb = Math.min(w - padR, xOf(ph.at + (b + 1) * 5000))
          const breathingIn = b % 2 === 0
          if (breathingIn) {
            ctx.fillStyle = rgba(p.ink, 0.055)
            ctx.fillRect(xa, 0, xb - xa, bot)
          }
          const doing = now >= ph.at + b * 5000 && now < ph.at + (b + 1) * 5000 && !ph.end
          text(breathingIn ? 'breathe in' : 'and out', xa + em * 0.4, head, doing ? 0.95 : 0.5)
        }
      }
      const pts: number[] = []
      const bt: number[] = []
      const bv: number[] = []
      for (const q of xs) {
        if (q.bpm === null) continue
        bt.push(q.at)
        bv.push(q.bpm)
      }
      const sm = eased(bt, bv, 450)
      for (let i = 0; i < bt.length; i++) pts.push(xOf(bt[i]), yOf(sm[i]))
      fillUnder(ctx, pts, bot, p.heart, 0.26)
      glowLine(ctx, pts, '#f08a98', p.heart, lw)
      if (pts.length && !ph?.end) endDot(ctx, pts[pts.length - 2], pts[pts.length - 1], p.heart, lw * 1.1)
    }
  })

  useEffect(() => {
    let lastT = 0
    let lastK: Kind = 'none'
    return onFrame((now) => {
      const { kind: k } = kindOf(stage, mode)
      if (now - lastT < 160 && k === lastK) return
      lastT = now
      lastK = k
      let v = 'reading'
      let ok = false
      const phone = k !== 'none' && k !== 'dose' ? stage.phoneReadings[k] : undefined
      if (phone) {
        v = stepReadingText(k as PhaseKey, phone)
        ok = phone.readable && phone.value != null
      } else if (k !== 'dose' && camera === false && stage.run?.phases.at(-1)?.end !== null) {
        v = 'not read'
        ok = false
      } else if (k === 'dose' && stage.last?.bpm) {
        v = `${Math.round(stage.last.bpm)} beats a minute`
        ok = true
      }
      if (valEl.current && valEl.current.textContent !== v) valEl.current.textContent = v
      const u = phone ? stepReadingWhy(phone) : camera === false && v === 'not read' ? 'camera is off' : ok ? COPY[k].unit : COPY[k].wait
      if (unitEl.current && unitEl.current.textContent !== u) unitEl.current.textContent = u
    })
  }, [stage, mode])

  const title = kind === 'nod' ? `Head pitch${headSource === 'airpods' ? ', from the AirPods' : headSource === 'camera' ? ', from the camera' : ''}` : COPY[kind].title
  return (
    <section className="sg-panel sg-lane" data-kind={kind} aria-label={title}>
      <header>
        <div>
          <b>{title}</b>
          {kind === 'laugh' && (
            <span className="sg-legend">
              <span>
                <i data-k="cam" />
                what the camera sees
              </span>
              {hasEar && (
                <span>
                  <i data-k="ear" />
                  what the AirPods feel
                </span>
              )}
            </span>
          )}
        </div>
        <p>
          <b ref={valEl}>reading</b>
          <span ref={unitEl} />
        </p>
      </header>
      <canvas ref={canvas} />
    </section>
  )
}
