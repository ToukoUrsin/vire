// Charts. One idea runs through all of them: a pale band is your own usual, the line or bar is now.
// Round 3 px lines with a soft light under them, round bars, text in ink (never in the series colour).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
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
        <defs>
          <radialGradient id="ring-band" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R1 + 4}>
            <stop offset={R0 / (R1 + 4) - 0.06} stopColor="#f6efe4" stopOpacity="0.05" />
            <stop offset="1" stopColor="#f6efe4" stopOpacity="0.2" />
          </radialGradient>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <linearGradient id="ring-ink" gradientUnits="userSpaceOnUse" x1={C - R1} y1={C + R1} x2={C + R1} y2={C - R1}>
            <stop offset="0" stopColor="#ff9a5c" />
            <stop offset="1" stopColor="#e4572e" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={R0 - 14} fill="none" stroke="var(--ink)" strokeOpacity={0.07} strokeWidth={1} />
        {/* the night closes the circle: nothing is read while the AirPods are out */}
        <path d={`M${pt(g.hN + 0.7, (R0 + R1) / 2).map((v) => v.toFixed(1)).join(' ')}A${(R0 + R1) / 2} ${(R0 + R1) / 2} 0 0 1 ${pt(g.h0 - 0.7, (R0 + R1) / 2).map((v) => v.toFixed(1)).join(' ')}`} fill="none" stroke="var(--ink)" strokeOpacity={0.07} strokeWidth={12} strokeLinecap="round" />
        <path d={g.usual} fill="url(#ring-band)" />
        {g.wedges.map((w) => (
          <path key={w} d={w} fill="var(--ember)" fillOpacity={0.34} className="ring-wedge" />
        ))}
        <path d={g.today} fill="none" stroke="var(--ember)" strokeOpacity={0.75} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="ring-line" filter="url(#ring-glow)" />
        <path d={g.today} fill="none" stroke="url(#ring-ink)" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="ring-line" />
        {mark != null && mark <= g.end && (
          <g className="ring-pop" style={{ animationDelay: '1100ms' }}>
            <circle cx={g.where(mark)[0]} cy={g.where(mark)[1]} r={6.5} fill="var(--bg)" />
            <circle cx={g.where(mark)[0]} cy={g.where(mark)[1]} r={4.5} fill="var(--ink)" />
          </g>
        )}
        <g className="ring-pop" style={{ animationDelay: '1500ms' }}>
          <circle cx={nx} cy={ny} r={14} fill="var(--ember)" opacity={0.3} className="ring-halo" style={{ transformOrigin: `${nx}px ${ny}px` }} />
          <circle cx={nx} cy={ny} r={8} fill="var(--bg)" />
          <circle cx={nx} cy={ny} r={6} fill="#ff8a5c" />
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

// ---------- shared by the flat charts ----------
const uid = (s: string) => `c${s.replace(/[^a-zA-Z0-9]/g, '')}`
/** a soft curve through every point */
function smooth(p: Array<[number, number]>): string {
  if (!p.length) return ''
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)]
    const b = p[i]
    const c = p[i + 1]
    const e = p[Math.min(p.length - 1, i + 2)]
    d += `C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`
  }
  return d
}

// ---------- a week of bars against the usual band ----------
/**
 * Round bars, the picked one lit. `lo` and `hi` draw the pale band of your own usual; leave them out for plain bars.
 * `bare` drops the reading above the chart, for a screen that says the number itself (give it `sel` and `onSel`).
 */
export function BandBars({ values, labels, lo, hi, tone, fmt, usual = 'your usual', height = 172, bare, sel: selProp, onSel }: { values: number[]; labels: string[]; lo?: number; hi?: number; tone: Tone; fmt: (v: number) => string; usual?: string; height?: number; bare?: boolean; sel?: number; onSel?: (i: number) => void }) {
  const id = uid(useId())
  const [own, setOwn] = useState(values.length - 1)
  const sel = selProp ?? own
  const W = 320
  const top = 20
  const base = height - 28
  const max = Math.max(hi ?? 0, ...values, 1e-9) * 1.08
  const y = (v: number) => base - (v / max) * (base - top)
  const n = values.length
  const slot = W / n
  const bw = Math.min(26, slot * 0.58)
  const band = lo != null && hi != null
  // the words sit over the band, at whichever end no bar reaches up into
  const free = (a: number, b: number) => hi != null && values[a] < hi && values[b] < hi
  const side = !band || !usual ? null : free(n - 1, n - 2) ? 'right' : free(0, 1) ? 'left' : null
  const pick = (i: number) => {
    setOwn(i)
    onSel?.(i)
  }
  return (
    <div>
      {!bare && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span className="title-m num">{fmt(values[sel])}</span>
          <span className="small">{labels[sel]}</span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block', touchAction: 'pan-y', overflow: 'visible' }} role="img" aria-label={band ? 'The week against your usual' : 'Bars, one for each'}>
        <defs>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={TONE[tone]} />
            <stop offset="1" stopColor={TONE[tone]} stopOpacity="0.55" />
          </linearGradient>
          <filter id={`${id}g`} x="-120%" y="-30%" width="340%" height="160%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>
        {band && <rect x={0} y={y(hi)} width={W} height={y(lo) - y(hi)} fill="var(--ink)" fillOpacity={0.09} rx={9} />}
        {band && side && (
          <text x={side === 'right' ? W - 4 : 4} y={y(hi) - 7} textAnchor={side === 'right' ? 'end' : 'start'} fontSize="11" fontWeight={500} fill="var(--ink-3)" fontFamily="var(--font-ui)">
            {usual}
          </text>
        )}
        {values.map((v, i) => {
          const x = i * slot + slot / 2
          const h = Math.max(bw, base - y(v))
          const on = i === sel
          return (
            <g key={i} onPointerDown={() => pick(i)} style={{ cursor: 'pointer' }}>
              <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
              {on && <rect x={x - bw / 2} y={base - h} width={bw} height={h} rx={bw / 2} fill={TONE[tone]} opacity={0.5} filter={`url(#${id}g)`} />}
              <rect x={x - bw / 2} y={base - h} width={bw} height={h} rx={bw / 2} fill={`url(#${id}f)`} opacity={on ? 1 : 0.46} style={{ transition: 'opacity 220ms' }} />
              <text x={x} y={height - 6} textAnchor="middle" fontSize="11.5" fontWeight={on ? 650 : 500} fill={on ? 'var(--ink)' : 'var(--ink-3)'} fontFamily="var(--font-ui)" className="num">
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
/** `bare` drops the reading above the chart; the screen then says it itself, from `onPick` (null once the finger is gone). */
export function BandLine({ x, y, lo, hi, tone, fmtX, fmtY, height = 170, usual = 'your usual', bare, onPick, rest }: { x: number[]; y: number[]; lo?: number[]; hi?: number[]; tone: Tone; fmtX: (x: number) => string; fmtY: (y: number) => string; height?: number; usual?: string; bare?: boolean; onPick?: (i: number | null) => void; /** what the headline says while no point is picked, when that is not the last point */ rest?: { y: string; x: string } }) {
  const id = uid(useId())
  const [sel, setSel] = useState<number | null>(null)
  const clear = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (clear.current && clearTimeout(clear.current)), [])
  const W = 320
  const L = 30
  const top = 14
  const base = height - 24
  const all = [...y, ...(lo ?? []), ...(hi ?? [])]
  const min = Math.floor(Math.min(...all) - 1)
  const max = Math.ceil(Math.max(...all) + 1)
  const px = (v: number) => L + ((v - x[0]) / (x[x.length - 1] - x[0])) * (W - L - 8)
  const py = (v: number) => base - ((v - min) / (max - min)) * (base - top)
  const pts = (v: number[]) => v.map((q, i): [number, number] => [px(x[i]), py(q)])
  const P = pts(y)
  const line = smooth(P)
  const area = P.length ? `${line}L${P[P.length - 1][0].toFixed(1)} ${base}L${P[0][0].toFixed(1)} ${base}Z` : ''
  const bandPath = lo && hi ? `${smooth(pts(hi))}L${smooth(pts(lo).reverse()).slice(1)}Z` : null
  // the words sit under the band where it runs lowest
  const low = lo ? lo.indexOf(Math.min(...lo)) + Math.floor(lo.filter((v) => v === Math.min(...lo)).length / 2) : 0
  const ticks = [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15].map((v) => Math.round(v))
  const pickAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - box.left) / box.width) * W
    let best = 0
    for (let i = 1; i < x.length; i++) if (Math.abs(px(x[i]) - vx) < Math.abs(px(x[best]) - vx)) best = i
    setSel(best)
    onPick?.(best)
    if (bare) {
      if (clear.current) clearTimeout(clear.current)
      clear.current = setTimeout(() => {
        setSel(null)
        onPick?.(null)
      }, 2800)
    }
  }
  const i = sel ?? y.length - 1
  const dot = sel != null || !bare
  return (
    <div>
      {!bare && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span className="title-m num">{sel == null && rest ? rest.y : fmtY(y[i])}</span>
          <span className="small num">{sel == null && rest ? rest.x : fmtX(x[i])}</span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block', touchAction: 'pan-y', overflow: 'visible' }} onPointerDown={pickAt} onPointerMove={(e) => (e.buttons || e.pointerType !== 'mouse') && pickAt(e)} role="img" aria-label="Line against your usual">
        <defs>
          <linearGradient id={`${id}a`} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2={base}>
            <stop offset="0" stopColor={TONE[tone]} stopOpacity="0.3" />
            <stop offset="1" stopColor={TONE[tone]} stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}g`} x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={py(t)} y2={py(t)} stroke="var(--ink)" strokeOpacity={0.07} />
            <text x={L - 9} y={py(t) + 3.5} textAnchor="end" fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
              {t}
            </text>
          </g>
        ))}
        {bandPath && <path d={bandPath} fill="var(--ink)" fillOpacity={0.1} />}
        {bandPath && lo && usual && (
          <text x={clamp(px(x[low]), L + 34, W - 40)} y={py(lo[low]) + 18} textAnchor="middle" fontSize="11" fontWeight={500} fill="var(--ink-3)" fontFamily="var(--font-ui)">
            {usual}
          </text>
        )}
        {!bandPath && <path d={area} fill={`url(#${id}a)`} />}
        <path d={line} fill="none" stroke={TONE[tone]} strokeOpacity={0.7} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${id}g)`} />
        <path d={line} fill="none" stroke={TONE[tone]} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        {dot && (
          <g>
            <line x1={px(x[i])} x2={px(x[i])} y1={top - 6} y2={bandPath ? py(y[i]) : base} stroke="var(--ink)" strokeOpacity={sel == null ? 0 : 0.45} />
            <circle cx={px(x[i])} cy={py(y[i])} r={8} fill="var(--bg)" />
            <circle cx={px(x[i])} cy={py(y[i])} r={5.5} fill="var(--ink)" />
          </g>
        )}
        <text x={L} y={height - 5} fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
          {fmtX(x[0])}
        </text>
        <text x={W - 8} y={height - 5} textAnchor="end" fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
          {fmtX(x[x.length - 1])}
        </text>
      </svg>
    </div>
  )
}

// ---------- a week of readings as dots on a line, against the usual band ----------
/** bars start at zero, where a resting heart rate of 53 and one of 58 look the same; dots can sit round the band */
export function BandDots({ values, labels, heads, lo, hi, tone, fmt, height = 176 }: { values: number[]; labels: string[]; heads?: string[]; lo: number; hi: number; tone: Tone; fmt: (v: number) => string; height?: number }) {
  const id = uid(useId())
  const [sel, setSel] = useState(values.length - 1)
  const W = 320
  const top = 20
  const base = height - 30
  const min = Math.min(lo, ...values) - 2
  const max = Math.max(hi, ...values) + 1
  const y = (v: number) => base - ((v - min) / (max - min)) * (base - top)
  const slot = W / values.length
  const x = (i: number) => i * slot + slot / 2
  const line = smooth(values.map((v, i): [number, number] => [x(i), y(v)]))
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span className="title-m num">{fmt(values[sel])}</span>
        <span className="small">{(heads ?? labels)[sel]}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block', touchAction: 'pan-y', overflow: 'visible' }} role="img" aria-label="The week against your usual">
        <defs>
          <filter id={`${id}g`} x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <rect x={0} y={y(hi)} width={W} height={y(lo) - y(hi)} fill="var(--ink)" fillOpacity={0.09} rx={9} />
        <text x={W - 6} y={y(lo) + 15} textAnchor="end" fontSize="11" fontWeight={500} fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
          your usual, {lo} to {hi}
        </text>
        <path d={line} fill="none" stroke={TONE[tone]} strokeOpacity={0.6} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${id}g)`} />
        <path d={line} fill="none" stroke={TONE[tone]} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        {values.map((v, i) => {
          const on = i === sel
          return (
            <g key={i} onPointerDown={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={x(i) - slot / 2} y={0} width={slot} height={height} fill="transparent" />
              <circle cx={x(i)} cy={y(v)} r={on ? 9 : 6.5} fill="var(--bg-1)" />
              <circle cx={x(i)} cy={y(v)} r={on ? 6 : 4} fill={on ? 'var(--ink)' : TONE[tone]} />
              <text x={x(i)} y={height - 6} textAnchor="middle" fontSize="11.5" fontWeight={on ? 650 : 500} fill={on ? 'var(--ink)' : 'var(--ink-3)'} fontFamily="var(--font-ui)">
                {labels[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** a strip of small round bars: how much the head moved in each slot of the night. `flush` starts it at the left edge. */
export function Strip({ values, tone, height = 44, flush }: { values: number[]; tone: Tone; height?: number; flush?: boolean }) {
  const W = 320
  const L = flush ? 0 : 30
  const R = flush ? 0 : 8
  const max = Math.max(1, ...values)
  const slot = (W - L - R) / values.length
  const bw = Math.min(9, slot - 3.5)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Head movement through the night">
      {values.map((v, i) => {
        const cx = L + i * slot + slot / 2
        const h = Math.max(bw, (v / max) * (height - 2))
        return v > 0 ? <rect key={i} x={cx - bw / 2} y={height - h} width={bw} height={h} rx={bw / 2} fill={TONE[tone]} /> : <circle key={i} cx={cx} cy={height - 2.5} r={2} fill="var(--ink)" fillOpacity={0.2} />
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
      <path d={d} fill="none" stroke={TONE[tone]} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
