import { useMemo, useRef, useState } from 'react'
import type { Channel, WallState } from '@shared/types'
import { CH, CHANNELS, HOUR, blockWidth, blocks, clock, day, fmt, focus, hourOf, tickLabel } from './lib'

interface Tip {
  x: number
  y: number
  text: string
}

/**
 * The hall's four channels over the weekend, one band each on a shared clock.
 * A dot is one ping at its raw value. The line is the hall's median per block of hours and the bar its middle half,
 * drawn only where the block holds three or more pings. A thin link joins one person's first and latest ping.
 */
export function Strips({
  wall,
  freshAfter,
  width,
  rowH,
  compact = false,
  labels = false,
  trail,
}: {
  wall: WallState
  freshAfter: number
  width: number
  rowH: number
  compact?: boolean
  /** name each band inside the drawing (for a phone, where there is no room for a label column) */
  labels?: boolean
  /** one visitor's own pings, oldest first: drawn on top, ringed and joined */
  trail?: { h: number; values: Record<Channel, number | null> }[]
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  const g = useMemo(() => {
    const since = Date.parse(wall.since)
    const total = (Date.parse(wall.until) - since) / HOUR
    const padL = compact ? 30 : 46
    const padR = compact ? 8 : 14
    const padY = compact ? 10 : 16
    const padTop = labels ? 30 : padY
    const plotW = width - padL - padR
    const x = (h: number) => padL + (Math.min(total, Math.max(0, h)) / total) * plotW
    const nowH = Math.min(total, Math.max(0, wall.hoursIn))

    // the clock: a tick every six hours, the night (00-08) shaded
    const ticks: { h: number; label: string; strong: boolean }[] = []
    const nights: [number, number][] = []
    for (let k = 0; k <= total; k++) {
      const t = since + k * HOUR
      const hr = hourOf(t)
      if (hr % 6 === 0) ticks.push({ h: k, label: k === 0 && !compact ? `${day(t)} ${String(hr).padStart(2, '0')}` : hr === 0 ? day(t) : String(hr).padStart(2, '0'), strong: hr === 0 || k === 0 })
      if (hr < 8 && k < total) {
        const last = nights[nights.length - 1]
        if (last && last[1] === k) last[1] = k + 1
        else nights.push([k, k + 1])
      }
    }

    const width_h = blockWidth(wall.pings)
    const who = wall.points.who
    const hs = wall.points.h
    const bands = CHANNELS.map((ch, i) => {
      const c = wall.channels.find((k) => k.channel === ch)!
      const top = i * rowH
      const y0 = top + rowH - padY
      const y1 = top + padTop
      const vals = wall.points.values[ch]
      const f = focus(vals, c.domain, (trail ?? []).map((t) => t.values[ch]))
      const y = (v: number) => y0 - ((Math.min(f.hi, Math.max(f.lo, v)) - f.lo) / (f.hi - f.lo)) * (y0 - y1)
      const dots: { i: number; x: number; y: number; h: number; v: number; fresh: boolean }[] = []
      const first = new Map<number, number>()
      const last = new Map<number, number>()
      vals.forEach((v, k) => {
        if (v == null) return
        dots.push({ i: k, x: x(hs[k]), y: y(v), h: hs[k], v, fresh: hs[k] > freshAfter })
        if (!first.has(who[k])) first.set(who[k], k)
        last.set(who[k], k)
      })
      // one person, hours apart: first ping to latest
      const links: { x1: number; y1: number; x2: number; y2: number }[] = []
      for (const [w, a] of first) {
        const b = last.get(w)!
        if (hs[b] - hs[a] >= wall.minGapH) links.push({ x1: x(hs[a]), y1: y(vals[a]!), x2: x(hs[b]), y2: y(vals[b]!) })
      }
      const read = blocks(hs, vals, width_h)
        .filter((b) => b.n >= 3)
        .map((b) => ({ ...b, cx: x((b.h0 + Math.max(b.h0, Math.min(b.h1, nowH))) / 2), my: y(b.median), y1: y(b.q3), y3: y(b.q1) }))
      // adjacent blocks join into a run: a line through the medians over a band for the middle half
      const runs: { line: string; band: string }[] = []
      const alone: typeof read = []
      let run: typeof read = []
      const close = () => {
        if (run.length === 1) alone.push(run[0])
        else if (run.length > 1) {
          const up = run.map((b, k) => `${k ? 'L' : 'M'}${b.cx.toFixed(1)} ${b.y1.toFixed(1)}`).join('')
          const down = [...run].reverse().map((b) => `L${b.cx.toFixed(1)} ${b.y3.toFixed(1)}`).join('')
          runs.push({ line: run.map((b, k) => `${k ? 'L' : 'M'}${b.cx.toFixed(1)} ${b.my.toFixed(1)}`).join(''), band: `${up}${down}Z` })
        }
        run = []
      }
      read.forEach((b, k) => {
        if (k > 0 && read[k - 1].h1 !== b.h0) close()
        run.push(b)
      })
      close()
      const marks = read.length <= 10 ? read : alone
      const mine = (trail ?? []).flatMap((t) => (t.values[ch] == null ? [] : [{ x: x(t.h), y: y(t.values[ch]!) }]))
      return { ch, top, y0, y1, f, dots, links, runs, alone, marks, mine }
    })
    return { total, padL, padR, plotW, x, nowH, ticks, nights, bands, width_h, since }
  }, [wall, freshAfter, width, rowH, compact, labels, trail])

  const axisH = compact ? 26 : 38
  const H = rowH * CHANNELS.length + axisH
  const many = wall.pings > 160
  const showNow = wall.hoursIn >= 0 && wall.hoursIn <= g.total
  const waitRight = g.nowH < g.total * 0.5
  const r = compact ? (wall.pings < 40 ? 4 : 3) : wall.pings < 40 ? 6.5 : many ? 3.6 : 4.8

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = ref.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    let best: Tip | null = null
    let dist = 22 * 22
    for (const b of g.bands) {
      if (p.y < b.top || p.y > b.top + rowH) continue
      for (const d of b.dots) {
        const q = (d.x - p.x) ** 2 + (d.y - p.y) ** 2
        if (q < dist) {
          dist = q
          const t = g.since + d.h * HOUR
          best = { x: d.x, y: d.y, text: `${fmt(d.v, b.ch)} ${CH[b.ch].unit} · ${day(t)} ${clock(t)}` }
        }
      }
    }
    setTip(best)
  }

  return (
    <div className="wl-strips">
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`The hall's smile, voice, heart and move over the weekend: ${wall.pings} pings from ${wall.visitors} people, each drawn as a dot at its raw value.`}
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
      >
        {g.nights.map(([a, b]) => (
          <rect key={a} className="wl-night" x={g.x(a)} y={0} width={g.x(b) - g.x(a)} height={rowH * CHANNELS.length} />
        ))}
        {showNow && <line className="wl-now" x1={g.x(g.nowH)} x2={g.x(g.nowH)} y1={0} y2={rowH * CHANNELS.length + 6} />}
        {g.bands.map((b) => (
          <g key={b.ch} style={{ ['--c' as string]: CH[b.ch].color }}>
            <line className="wl-base" x1={g.padL} x2={width - g.padR} y1={b.y0} y2={b.y0} />
            {b.f.ticks.map((t, k) => {
              const ty = b.y0 - ((t - b.f.lo) / (b.f.hi - b.f.lo)) * (b.y0 - b.y1)
              return (
                <g key={t}>
                  {k > 0 && <line className="wl-grid" x1={g.padL} x2={width - g.padR} y1={ty} y2={ty} />}
                  {(b.f.ticks.length <= 4 || k % 2 === 0) && (
                    <text className="wl-ytick" x={g.padL - 8} y={ty + 4} textAnchor="end">
                      {tickLabel(t)}
                    </text>
                  )}
                </g>
              )
            })}
            {b.links.map((l, k) => (
              <line key={k} className={`wl-link${b.links.length > 40 ? ' is-many' : ''}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
            ))}
            {b.dots.map((d) => (
              <circle key={d.i} className={`wl-dot${many ? ' is-many' : ''}`} cx={d.x} cy={d.y} r={r} />
            ))}
            {b.runs.map((r, k) => (
              <path key={k} className="wl-band" d={r.band} />
            ))}
            {b.alone.map((r) => (
              <rect key={r.h0} className="wl-mid" x={r.cx - (compact ? 3 : 4)} y={r.y1} width={compact ? 6 : 8} height={Math.max(2, r.y3 - r.y1)} rx={compact ? 3 : 4} />
            ))}
            {b.runs.map((r, k) => (
              <path key={k} className="wl-median" d={r.line} />
            ))}
            {b.marks.map((r) => (
              <circle key={r.h0} className="wl-med" cx={r.cx} cy={r.my} r={compact ? 4 : 5.5} />
            ))}
            {b.dots
              .filter((d) => d.fresh)
              .map((d) => (
                <g key={d.i} className="wl-fresh">
                  <circle cx={d.x} cy={d.y} r={r + 2} />
                  <circle className="wl-ring" cx={d.x} cy={d.y} r={r + 2} />
                </g>
              ))}
            {b.mine.length > 1 && <path className="wl-mine-line" d={b.mine.map((m, k) => `${k ? 'L' : 'M'}${m.x.toFixed(1)} ${m.y.toFixed(1)}`).join('')} />}
            {b.mine.map((m, k) => (
              <circle key={k} className={`wl-mine${k === b.mine.length - 1 ? ' is-latest' : ''}`} cx={m.x} cy={m.y} r={k === b.mine.length - 1 ? 7 : 5} />
            ))}
            {labels && (
              <g>
                <circle className="wl-band-dot" cx={g.padL + 6} cy={b.top + 13} r={5} />
                <text className="wl-band-name" x={g.padL + 18} y={b.top + 18}>
                  {CH[b.ch].name}
                </text>
              </g>
            )}
            {!b.dots.length && (
              <text className="wl-wait" x={waitRight ? g.x(g.nowH) + 18 : g.x(g.nowH) - 18} y={(b.y0 + b.y1) / 2 + 5} textAnchor={waitRight ? 'start' : 'end'}>
                {EMPTY[b.ch]}
              </text>
            )}
          </g>
        ))}
        {showNow && (
          <text className="wl-now-label" x={g.x(g.nowH)} y={rowH * CHANNELS.length + (compact ? 20 : 27)} textAnchor={g.nowH > g.total * 0.93 ? 'end' : 'middle'}>
            now
          </text>
        )}
        {g.ticks
          .filter((t) => !showNow || Math.abs(g.x(t.h) - g.x(g.nowH)) > (compact ? 30 : 44))
          .filter((t) => !compact || t.strong || hourOf(g.since + t.h * HOUR) === 12)
          .map((t) => (
            <g key={t.h}>
              <line className="wl-tick" x1={g.x(t.h)} x2={g.x(t.h)} y1={rowH * CHANNELS.length} y2={rowH * CHANNELS.length + 6} />
              <text className={`wl-xtick${t.strong ? ' is-strong' : ''}`} x={g.x(t.h)} y={rowH * CHANNELS.length + (compact ? 20 : 27)} textAnchor={t.h === 0 ? 'start' : t.h >= g.total - 1 ? 'end' : 'middle'}>
                {t.label}
              </text>
            </g>
          ))}
        {tip && <circle className="wl-hover" cx={tip.x} cy={tip.y} r={8} />}
      </svg>
      {tip && (
        <div className="wl-tip" style={{ left: `${(tip.x / width) * 100}%`, top: `${(tip.y / H) * 100}%` }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}

const EMPTY: Record<Channel, string> = {
  smile: 'waiting for the first smile',
  voice: 'waiting for the first voice',
  heart: 'waiting for the first heartbeat',
  move: 'waiting for the first nod',
}

/** What the marks mean, in the marks themselves. */
export function Legend({ wall }: { wall: WallState }) {
  const w = blockWidth(wall.pings)
  return (
    <p className="wl-legend">
      <span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" className="wl-lg-dot" />
        </svg>
        one ping
      </span>
      <span>
        <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
          <path d="M2 7H32" className="wl-lg-line" />
          <circle cx="17" cy="7" r="4.5" className="wl-lg-med" />
        </svg>
        hall median per {w === 1 ? 'hour' : `${w} hours`}, where 3 or more pinged
      </span>
      <span>
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
          <rect x="1" y="0" width="8" height="14" rx="4" className="wl-lg-mid" />
        </svg>
        middle half
      </span>
      <span>
        <svg width="30" height="14" viewBox="0 0 30 14" aria-hidden="true">
          <path d="M2 3 28 11" className="wl-lg-link" />
        </svg>
        the same person, hours apart
      </span>
      <span>
        <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
          <rect x="0.5" y="0.5" width="17" height="13" rx="2" className="wl-lg-night" />
        </svg>
        night, 00 to 08
      </span>
    </p>
  )
}
