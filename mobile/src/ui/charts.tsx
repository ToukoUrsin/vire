// Charts. One idea runs through all of them: a pale band is your own usual, the line or bar is now.
// 2 px lines, markers with a ring of the surface, hairline guides, text in ink (never in the series colour).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RingSeries } from '../data/sample'
import type { Tone } from './kit'

const TONE: Record<Tone, string> = { face: 'var(--face)', voice: 'var(--voice)', move: 'var(--move)', heart: 'var(--heart)', ember: 'var(--ember)', plain: 'var(--ink-2)' }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
/** value at a fractional index, eased between the points so a ring of hourly values reads as one curve */
function at(v: number[], x: number): number {
  const i = clamp(Math.floor(x), 0, v.length - 1)
  const j = Math.min(v.length - 1, i + 1)
  const f = clamp(x - i, 0, 1)
  const e = (1 - Math.cos(f * Math.PI)) / 2
  return v[i] + (v[j] - v[i]) * e
}

// ---------- the day ring ----------
const S = 320
const C = S / 2
const R0 = 76
const R1 = 140
const ang = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2
const pt = (h: number, r: number): [number, number] => [C + Math.cos(ang(h)) * r, C + Math.sin(ang(h)) * r]

export function DayRing({ s, nowH, mark, children, onPick }: { s: RingSeries; nowH: number; mark?: number; children?: ReactNode; onPick?: (h: number | null) => void }) {
  const [pick, setPick] = useState<number | null>(null)
  const clear = useRef<ReturnType<typeof setTimeout> | null>(null)
  const g = useMemo(() => {
    const all = [...s.lo, ...s.hi, ...s.today]
    const min = Math.min(...all)
    const max = Math.max(...all)
    const pad = (max - min) * 0.08
    const rad = (v: number) => R0 + ((v - (min - pad)) / (max - min + 2 * pad)) * (R1 - R0)
    const h0 = s.h[0]
    const hN = s.h[s.h.length - 1]
    const idx = (h: number) => h - h0
    const path = (v: number[], from: number, to: number, rev = false) => {
      const pts: string[] = []
      const n = Math.max(2, Math.round((to - from) * 6))
      for (let k = 0; k <= n; k++) {
        const h = from + ((to - from) * (rev ? n - k : k)) / n
        const [x, y] = pt(h, rad(at(v, idx(h))))
        pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`)
      }
      return pts
    }
    const usual = `M${path(s.hi, h0, hN).join('L')}L${path(s.lo, h0, hN, true).join('L')}Z`
    const end = Math.min(nowH, h0 + s.today.length - 1)
    const today = `M${path(s.today, h0, end).join('L')}`
    const val = (h: number) => at(s.today, idx(h))
    const where = (h: number) => pt(h, rad(val(h)))
    // where today leaves the usual band, the gap between the two is filled: that is the part worth a look
    const wedges: string[] = []
    let run: Array<[number, number, number]> = []
    const flush = () => {
      if (run.length > 1) {
        const out = run.map(([h, a]) => pt(h, a).map((v) => v.toFixed(1)).join(' '))
        const inn = run
          .slice()
          .reverse()
          .map(([h, , b]) => pt(h, b).map((v) => v.toFixed(1)).join(' '))
        wedges.push(`M${out.join('L')}L${inn.join('L')}Z`)
      }
      run = []
    }
    const n = Math.round((end - h0) * 8)
    for (let k = 0; k <= n; k++) {
      const h = h0 + ((end - h0) * k) / n
      const v = val(h)
      const lo = at(s.lo, idx(h))
      const hi = at(s.hi, idx(h))
      if (v < lo) run.push([h, rad(v), rad(lo)])
      else if (v > hi) run.push([h, rad(v), rad(hi)])
      else flush()
    }
    flush()
    return { usual, today, end, h0, hN, where, val, rad, idx, wedges }
  }, [s, nowH])

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * S - C
    const y = ((e.clientY - box.top) / box.height) * S - C
    const d = Math.hypot(x, y)
    if (d < R0 - 28 || d > R1 + 30) return
    let h = ((Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2)) * 24
    if (h < 0) h += 24
    h = clamp(Math.round(h * 2) / 2, g.h0, g.end)
    setPick(h)
    onPick?.(h)
    if (clear.current) clearTimeout(clear.current)
    clear.current = setTimeout(() => {
      setPick(null)
      onPick?.(null)
    }, 2600)
  }
  useEffect(() => () => void (clear.current && clearTimeout(clear.current)), [])

  const [nx, ny] = g.where(g.end)
  const picked = pick == null ? null : g.where(pick)
  const usualAt = pick == null ? null : [at(s.lo, g.idx(pick)), at(s.hi, g.idx(pick))]
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 340, margin: '0 auto', aspectRatio: '1' }}>
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" height="100%" onPointerDown={move} onPointerMove={(e) => (e.buttons || e.pointerType !== 'mouse') && move(e)} style={{ touchAction: 'pan-y', display: 'block', overflow: 'visible' }} role="img" aria-label={`${s.name} today against your usual, by hour`}>
        {Array.from({ length: 24 }, (_, h) => {
          const [x1, y1] = pt(h, R1 + 9)
          const [x2, y2] = pt(h, R1 + (h % 6 === 0 ? 15 : 12))
          return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeOpacity={h % 6 === 0 ? 0.45 : 0.16} strokeWidth={1} />
        })}
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = pt(h, R1 + 28)
          return (
            <text key={h} x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
              {String(h).padStart(2, '0')}
            </text>
          )
        })}
        <path d={g.usual} fill="var(--ink)" fillOpacity={0.1} />
        {g.wedges.map((w) => (
          <path key={w} d={w} fill="var(--ember)" fillOpacity={0.24} className="ring-wedge" />
        ))}
        <path d={g.today} fill="none" stroke="var(--ember)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="ring-line" />
        {mark != null && mark <= g.end && (
          <g className="ring-pop" style={{ animationDelay: '1100ms' }}>
            <circle cx={g.where(mark)[0]} cy={g.where(mark)[1]} r={6.5} fill="var(--bg)" />
            <circle cx={g.where(mark)[0]} cy={g.where(mark)[1]} r={4.5} fill="var(--ink)" />
          </g>
        )}
        <g className="ring-pop" style={{ animationDelay: '1500ms' }}>
          <circle cx={nx} cy={ny} r={12} fill="var(--ember)" opacity={0.25} className="ring-halo" style={{ transformOrigin: `${nx}px ${ny}px` }} />
          <circle cx={nx} cy={ny} r={7.5} fill="var(--bg)" />
          <circle cx={nx} cy={ny} r={5.5} fill="var(--ember)" />
        </g>
        {picked && pick != null && (
          <g>
            <line x1={pt(pick, R0 - 6)[0]} y1={pt(pick, R0 - 6)[1]} x2={pt(pick, R1 + 6)[0]} y2={pt(pick, R1 + 6)[1]} stroke="var(--ink)" strokeOpacity={0.5} strokeWidth={1} />
            <circle cx={picked[0]} cy={picked[1]} r={7} fill="var(--bg)" />
            <circle cx={picked[0]} cy={picked[1]} r={5} fill="var(--ink)" />
          </g>
        )}
      </svg>
      <div style={{ position: 'absolute', inset: '27%', display: 'grid', placeContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        {pick != null && usualAt ? (
          <div>
            <div className="small num">
              {String(Math.floor(pick)).padStart(2, '0')}:{pick % 1 ? '30' : '00'}
            </div>
            <div className="title-m num" style={{ marginTop: 4 }}>
              {s.fmt(g.val(pick))}
            </div>
            <div className="small num" style={{ marginTop: 4 }}>
              usual {usualAt[0].toFixed(0)} to {usualAt[1].toFixed(0)}
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

// ---------- a week of bars against the usual band ----------
export function BandBars({ values, labels, lo, hi, tone, fmt, usual = 'your usual' }: { values: number[]; labels: string[]; lo: number; hi: number; tone: Tone; fmt: (v: number) => string; usual?: string }) {
  const [sel, setSel] = useState(values.length - 1)
  const W = 320
  const Hh = 150
  const top = 14
  const base = Hh - 24
  const max = Math.max(hi, ...values) * 1.12
  const y = (v: number) => base - (v / max) * (base - top)
  const slot = (W - 8) / values.length
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="title-m num">{fmt(values[sel])}</span>
        <span className="small">{labels[sel]}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" style={{ display: 'block', touchAction: 'pan-y' }} role="img" aria-label="The week against your usual">
        <rect x={0} y={y(hi)} width={W} height={y(lo) - y(hi)} fill="var(--ink)" fillOpacity={0.08} rx={3} />
        <text x={W - 6} y={y(hi) - 5} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" fontFamily="var(--font-ui)">
          {usual}
        </text>
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--ink)" strokeOpacity={0.14} />
        {values.map((v, i) => {
          const x = 4 + i * slot + slot / 2
          const h = Math.max(2, base - y(v))
          return (
            <g key={i} onPointerDown={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={x - slot / 2} y={0} width={slot} height={Hh} fill="transparent" />
              <path d={`M${x - 8} ${base}V${base - h + 4}a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4V${base}Z`} fill={TONE[tone]} opacity={i === sel ? 1 : 0.42} style={{ transition: 'opacity 200ms' }} />
              <text x={x} y={Hh - 6} textAnchor="middle" fontSize="11" fill={i === sel ? 'var(--ink)' : 'var(--ink-3)'} fontFamily="var(--font-ui)">
                {labels[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------- a line against a band, with a finger to read it ----------
export function BandLine({ x, y, lo, hi, tone, fmtX, fmtY, height = 170, usual = 'your usual' }: { x: number[]; y: number[]; lo?: number[]; hi?: number[]; tone: Tone; fmtX: (x: number) => string; fmtY: (y: number) => string; height?: number; usual?: string }) {
  const [sel, setSel] = useState<number | null>(null)
  const W = 320
  const L = 30
  const top = 12
  const base = height - 22
  const all = [...y, ...(lo ?? []), ...(hi ?? [])]
  const min = Math.floor(Math.min(...all) - 1)
  const max = Math.ceil(Math.max(...all) + 1)
  const px = (v: number) => L + ((v - x[0]) / (x[x.length - 1] - x[0])) * (W - L - 6)
  const py = (v: number) => base - ((v - min) / (max - min)) * (base - top)
  const line = y.map((v, i) => `${i ? 'L' : 'M'}${px(x[i]).toFixed(1)} ${py(v).toFixed(1)}`).join('')
  const bandPath = lo && hi ? `M${hi.map((v, i) => `${px(x[i]).toFixed(1)} ${py(v).toFixed(1)}`).join('L')}L${lo.map((v, i) => `${px(x[i]).toFixed(1)} ${py(v).toFixed(1)}`).reverse().join('L')}Z` : null
  const ticks = [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15].map((v) => Math.round(v))
  const pickAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - box.left) / box.width) * W
    let best = 0
    for (let i = 1; i < x.length; i++) if (Math.abs(px(x[i]) - vx) < Math.abs(px(x[best]) - vx)) best = i
    setSel(best)
  }
  const i = sel ?? y.length - 1
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="title-m num">{fmtY(y[i])}</span>
        <span className="small num">{fmtX(x[i])}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block', touchAction: 'pan-y' }} onPointerDown={pickAt} onPointerMove={(e) => (e.buttons || e.pointerType !== 'mouse') && pickAt(e)} role="img" aria-label="Line against your usual">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={py(t)} y2={py(t)} stroke="var(--ink)" strokeOpacity={0.09} />
            <text x={L - 8} y={py(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
              {t}
            </text>
          </g>
        ))}
        {bandPath && <path d={bandPath} fill="var(--ink)" fillOpacity={0.1} />}
        {bandPath && hi && (
          <text x={W - 8} y={py(hi[hi.length - 1]) - 6} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" fontFamily="var(--font-ui)">
            {usual}
          </text>
        )}
        <path d={line} fill="none" stroke={TONE[tone]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <line x1={px(x[i])} x2={px(x[i])} y1={top - 4} y2={base} stroke="var(--ink)" strokeOpacity={sel == null ? 0 : 0.4} />
        <circle cx={px(x[i])} cy={py(y[i])} r={6.5} fill="var(--bg-1)" />
        <circle cx={px(x[i])} cy={py(y[i])} r={4.5} fill={TONE[tone]} />
        <text x={L} y={height - 5} fontSize="10.5" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
          {fmtX(x[0])}
        </text>
        <text x={W - 6} y={height - 5} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
          {fmtX(x[x.length - 1])}
        </text>
      </svg>
    </div>
  )
}

/** a strip of small bars: how much the head moved in each slot of the night */
export function Strip({ values, tone, height = 44 }: { values: number[]; tone: Tone; height?: number }) {
  const W = 320
  const L = 30
  const max = Math.max(1, ...values)
  const slot = (W - L - 6) / values.length
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Head movement through the night">
      <line x1={L} x2={W} y1={height - 1} y2={height - 1} stroke="var(--ink)" strokeOpacity={0.14} />
      {values.map((v, i) => {
        const h = (v / max) * (height - 6)
        return v > 0 ? <rect key={i} x={L + i * slot + 2} y={height - 1 - h} width={slot - 4} height={h} rx={2} fill={TONE[tone]} /> : null
      })}
    </svg>
  )
}

/** before and after, one row a session: an open dot where it started, a filled one where it ended */
export function Dumbbells({ rows, tone, unit }: { rows: Array<{ label: string; a: number; b: number }>; tone: Tone; unit: string }) {
  const W = 320
  const L = 58
  const rowH = 30
  const all = rows.flatMap((r) => [r.a, r.b])
  const min = Math.min(...all) - 3
  const max = Math.max(...all) + 3
  const px = (v: number) => L + ((v - min) / (max - min)) * (W - L - 34)
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * rowH + 22}`} width="100%" style={{ display: 'block' }} role="img" aria-label={`Before and after, ${unit}`}>
      {rows.map((r, i) => {
        const y = i * rowH + 16
        return (
          <g key={i}>
            <text x={0} y={y + 4} fontSize="11.5" fill="var(--ink-3)" fontFamily="var(--font-ui)">
              {r.label}
            </text>
            <line x1={L} x2={W - 34} y1={y} y2={y} stroke="var(--ink)" strokeOpacity={0.08} />
            <line x1={px(r.a)} x2={px(r.b)} y1={y} y2={y} stroke={TONE[tone]} strokeWidth={2} strokeLinecap="round" />
            <circle cx={px(r.a)} cy={y} r={4.5} fill="var(--bg-1)" stroke={TONE[tone]} strokeWidth={2} />
            <circle cx={px(r.b)} cy={y} r={6.5} fill="var(--bg-1)" />
            <circle cx={px(r.b)} cy={y} r={4.5} fill={TONE[tone]} />
            <text x={W} y={y + 4} textAnchor="end" fontSize="11.5" fill="var(--ink-2)" fontFamily="var(--font-ui)" className="num">
              {r.b - r.a > 0 ? '+' : ''}
              {(r.b - r.a).toFixed(0)}
            </text>
          </g>
        )
      })}
      <text x={L} y={rows.length * rowH + 16} fontSize="10.5" fill="var(--ink-3)" fontFamily="var(--font-ui)">
        open dot before, filled dot after · {unit}
      </text>
    </svg>
  )
}

/** how sure the model is, 0 to 1, with the line it has to cross */
export function Meter({ p, tone, on }: { p: number; tone: Tone; on?: boolean }) {
  return (
    <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--bg-3)' }}>
      <div style={{ position: 'absolute', inset: 0, width: `${clamp(p, 0, 1) * 100}%`, borderRadius: 3, background: TONE[tone], opacity: on ? 1 : 0.6, transition: 'width 140ms linear' }} />
      <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'var(--ink)', opacity: 0.35 }} />
    </div>
  )
}

export function Spark({ values, tone, w = 64, h = 22 }: { values: number[]; tone: Tone; w?: number; h?: number }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)} ${(h - 3 - ((v - min) / (max - min || 1)) * (h - 6)).toFixed(1)}`).join('')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={TONE[tone]} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
