// After a dose and a second measure: the same two questions, before and after, as the mirror itself read them.
// The traces are the ones this screen drew; the echo proper still comes from the server.
import { useMemo } from 'react'
import type { Channel } from '@shared/types'
import { stepReadingText } from '../../app/echoText'
import { eased, palette, rgba, useCanvas } from './loop'
import { LAUGH_ONSET_MS } from './store'
import type { Stage, Trace } from './store'

function Pair({ before: rawBefore, after: rawAfter, ch, spanMs, onsetMs, floor }: { before: Trace | null; after: Trace | null; ch: Channel; spanMs: number; onsetMs: number | null; floor: boolean }) {
  // a heart rate is drawn as the lane drew it: without the small steps a camera pulse arrives in
  const [before, after] = useMemo(() => {
    const ease = (tr: Trace | null): Trace | null => (tr && !floor ? { t: tr.t, v: eased(tr.t, tr.v, 450) } : tr)
    return [ease(rawBefore), ease(rawAfter)]
  }, [rawBefore, rawAfter, floor])
  const canvas = useCanvas((s) => {
    const { ctx, w, h, em } = s
    const p = palette()
    ctx.clearRect(0, 0, w, h)
    const top = em * 2
    const bot = h - em * 0.6
    const padR = em * 4.6
    let lo = Infinity
    let hi = -Infinity
    for (const tr of [before, after]) {
      if (!tr) continue
      for (let i = 0; i < tr.v.length; i++) {
        if (tr.t[i] > spanMs) break
        lo = Math.min(lo, tr.v[i])
        hi = Math.max(hi, tr.v[i])
      }
    }
    if (!Number.isFinite(lo)) return
    if (floor) {
      lo = 0
      hi = Math.max(hi, 0.4)
    } else {
      const mid = (lo + hi) / 2
      const half = Math.max(5, (hi - lo) / 2 + 1.5)
      lo = mid - half
      hi = mid + half
    }
    const xOf = (t: number) => 2 + (t / spanMs) * (w - 2 - padR)
    const yOf = (v: number) => bot - ((v - lo) / (hi - lo)) * (bot - top)
    ctx.fillStyle = rgba(p.ink, 0.14)
    ctx.fillRect(2, Math.round(bot), w - 2 - padR, 1)
    ctx.font = `500 ${em}px Inter, system-ui, sans-serif`
    ctx.textBaseline = 'alphabetic'
    if (onsetMs !== null) {
      const x = Math.round(xOf(onsetMs)) + 0.5
      ctx.strokeStyle = rgba(p.ink, 0.4)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, em * 0.3)
      ctx.lineTo(x, bot)
      ctx.stroke()
      ctx.fillStyle = rgba(p.ink, 0.7)
      ctx.textAlign = 'left'
      ctx.fillText('laughter starts', x + em * 0.4, em * 1.1)
    }
    const hue = p[ch]
    const line = (tr: Trace | null, color: string, width: number, label: string, labelColor: string, dash: boolean) => {
      if (!tr || tr.t.length < 2) return
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (dash) ctx.setLineDash([width * 2.2, width * 2.6])
      ctx.beginPath()
      let ex = 0
      let ey = 0
      for (let i = 0; i < tr.t.length && tr.t[i] <= spanMs; i++) {
        ex = xOf(tr.t[i])
        ey = yOf(tr.v[i])
        if (i) ctx.lineTo(ex, ey)
        else ctx.moveTo(ex, ey)
      }
      ctx.stroke()
      ctx.setLineDash([])
      return { x: ex, y: ey, label, color: labelColor }
    }
    const lw = Math.max(2.5, em * 0.2)
    const was = line(before, rgba(p.ink, 0.5), lw * 0.7, 'before', rgba(p.ink, 0.65), true)
    if (after && after.t.length > 1) {
      // the after trace carries the colour, with the same soft halo as the live lanes
      ctx.strokeStyle = rgba(hue, 0.2)
      ctx.lineWidth = lw * 3
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (let i = 0; i < after.t.length && after.t[i] <= spanMs; i++) {
        if (i) ctx.lineTo(xOf(after.t[i]), yOf(after.v[i]))
        else ctx.moveTo(xOf(after.t[i]), yOf(after.v[i]))
      }
      ctx.stroke()
    }
    const now = line(after, hue, lw, 'after', '#ffffff', false)
    // the two end labels, kept a line apart when the traces end close together
    if (was && now && Math.abs(was.y - now.y) < em * 1.3) {
      // never below the floor line: two flat traces both end there
      const mid = Math.min((was.y + now.y) / 2, bot - em * 1.2)
      const up = now.y <= was.y ? now : was
      const down = up === now ? was : now
      up.y = mid - em * 0.65
      down.y = mid + em * 0.65
    }
    for (const e of [was, now]) {
      if (!e) continue
      ctx.fillStyle = e.color
      ctx.textAlign = 'left'
      ctx.fillText(e.label, e.x + em * 0.5, Math.max(top, e.y + em * 0.35))
    }
  })
  return <canvas ref={canvas} />
}

export function AgainPanel({ stage, whose: _whose }: { stage: Stage; whose: string }) {
  const a = stage.firstRun
  const b = stage.run
  if (!b) return null
  const rows: { ch: Channel; what: string; was: string | null; now: string | null; before: Trace | null; after: Trace | null; span: number; onset: number | null; floor: boolean }[] = [
    { ch: 'smile', what: 'From the laughter to the smile', was: a ? stepReadingText('laugh', a.readings.laugh) : null, now: stepReadingText('laugh', b.readings.laugh), before: a?.tr.laugh ?? null, after: b.tr.laugh ?? null, span: 8000, onset: LAUGH_ONSET_MS, floor: true },
    { ch: 'heart', what: 'Heart swing on one slow breath', was: a ? stepReadingText('breathe', a.readings.breathe) : null, now: stepReadingText('breathe', b.readings.breathe), before: a?.tr.breathe ?? null, after: b.tr.breathe ?? null, span: 10000, onset: null, floor: false },
  ]
  return (
    <section className="sg-again" aria-live="polite">
      <header className="sg-say">
        <h1>Before and after</h1>
        <p>The same laughter and one slow breath, asked again after the dose.</p>
      </header>
      <div className="sg-pairs">
        {rows.map((r) => (
          <article key={r.ch} className="sg-panel" style={{ ['--c' as string]: `var(--ch-${r.ch})` }}>
            <header>
              <b>{r.what}</b>
              <p>
                {r.was && (
                  <>
                    <b className="is-was">{r.was}</b>
                    <i className="sg-arrow" aria-hidden="true" />
                  </>
                )}
                <b>{r.now ?? 'reading'}</b>
              </p>
            </header>
            <Pair before={r.before} after={r.after} ch={r.ch} spanMs={r.span} onsetMs={r.onset} floor={r.floor} />
          </article>
        ))}
      </div>
      <p className="sg-foot">
        The phone sends the finished readings. The traces show what moved while Vire measured. A measured loop, not a diagnosis.
      </p>
    </section>
  )
}
