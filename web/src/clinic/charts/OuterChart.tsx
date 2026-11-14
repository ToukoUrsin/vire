import type { PatientDetail, PracticeKind, PracticeRec } from '@shared/types'
import { DAY, fmtDay } from '../data'
import { clamp, lin, pathOf, useWidth } from './util'
import { dateTicks } from './EchoChart'

/** the usual band in SD, as the status logic reads it: below -0.75 is drift */
const DIP = -0.75
const SETTLED = 10

/** practice kind as a shape, so the chart reads without colour */
export function PracticeMark({ kind, state, x = 7, y = 7, r = 5 }: { kind: PracticeKind; state: 'settled' | 'done' | 'skipped'; x?: number; y?: number; r?: number }) {
  const cls = `cl-pmark cl-pmark--${state}`
  if (kind === 'breathe') return <circle className={cls} cx={x} cy={y} r={r} />
  if (kind === 'scan') return <rect className={cls} x={x - r * 0.88} y={y - r * 0.88} width={r * 1.76} height={r * 1.76} />
  return <path className={cls} d={`M${x},${y - r * 1.05}L${x + r * 1.05},${y + r * 0.85}L${x - r * 1.05},${y + r * 0.85}Z`} />
}
export const practiceState = (p: PracticeRec): 'settled' | 'done' | 'skipped' => (!p.done ? 'skipped' : p.settle != null && p.settle >= SETTLED ? 'settled' : 'done')

/**
 * The outer loop in one picture: the day's drift against the person's own usual band, the practices the phone
 * offered under it, the day the drift met the rule, the booster, and the line after it.
 */
export function OuterChart({ detail, now = Date.now() }: { detail: PatientDetail; now?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(1100)
  const o = detail.outer
  const practices = detail.practices ?? []
  const narrow = W < 560
  const H = 300
  const m = { l: narrow ? 40 : 76, r: narrow ? 16 : 140, t: 26, b: 74 }
  const pl = m.l
  const pr = W - m.r
  const pt = m.t
  const pb = H - m.b - 34 // the practice lane sits under the plot
  const laneY = pb + 26

  // the last eight weeks, stretched to show a booking that is still ahead
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const booking = o?.booster ?? null
  const bookAt = booking ? Date.parse(booking.at) : null
  const t1 = Math.max(end.getTime(), bookAt != null ? bookAt + 2 * DAY : 0)
  const t0 = Math.min(end.getTime() - 56 * DAY, bookAt != null ? bookAt - 30 * DAY : Infinity)
  const x = lin(t0, t1, pl, pr)
  const yLo = -3
  const yHi = 2
  const y = (sd: number) => lin(yLo, yHi, pb, pt)(clamp(sd, yLo, yHi))

  // one drift value a day: the last full home ping of the day
  const byDay = new Map<number, { t: number; drift: number }>()
  for (const p of detail.timeline) {
    if (p.kind !== 'full' || p.setting === 'clinic') continue
    const t = Date.parse(p.at)
    if (t < t0) continue
    byDay.set(Math.floor(t / DAY), { t, drift: p.drift })
  }
  const pts = [...byDay.values()].sort((a, b) => a.t - b.t)
  const split = bookAt != null && bookAt <= now ? bookAt : null
  const seg = (xs: typeof pts) => {
    const out: ([number, number] | null)[] = []
    xs.forEach((p, i) => {
      if (i && p.t - xs[i - 1]!.t > 3.5 * DAY) out.push(null)
      out.push([x(p.t), y(p.drift)])
    })
    return pathOf(out)
  }
  const before = split != null ? pts.filter((p) => p.t < split) : pts
  const after = split != null ? pts.filter((p) => p.t >= split) : []
  // join the line across the booster so the two halves meet
  const afterLine = after.length && before.length ? [before[before.length - 1]!, ...after] : after
  const shown = practices.filter((p) => Date.parse(p.at) >= t0)
  // marks that would sit on each other step down a row, so a busy week is a stack and not a blob
  const markR = narrow ? 3.6 : 5
  const rowEnd: number[] = []
  const marks = shown.map((p) => {
    const mx = x(Date.parse(p.at))
    let row = rowEnd.findIndex((e) => mx - e >= markR * 2 + 1.5)
    if (row < 0) row = rowEnd.length < 3 ? rowEnd.length : 2
    rowEnd[row] = mx
    return { p, mx, my: laneY + row * (markR * 2 + 2) }
  })
  const xt = dateTicks(t0, t1, pr - pl)
  const escAt = o?.escalatedAt ? Date.parse(o.escalatedAt) : null
  const last = pts.at(-1)
  const simulatedAfter = !!o?.after?.simulated || (detail.synthetic && split != null)

  return (
    <div ref={ref} className="cl-outer-chart">
      <svg width={W} height={H} role="img" aria-label={`Drift against the usual band over eight weeks, with ${shown.length} practices offered${booking ? ' and a booster' : ''}`}>
        {/* the usual band */}
        <rect x={pl} y={y(-DIP)} width={pr - pl} height={y(DIP) - y(-DIP)} className="cl-oc-band" />
        <line x1={pl} x2={pr} y1={y(0)} y2={y(0)} className="cl-oc-zero" />
        <line x1={pl} x2={pr} y1={y(DIP)} y2={y(DIP)} className="cl-oc-dip" />
        {!narrow && (
          <>
            <text x={pr + 52} y={y(0) + 4} className="cl-oc-label">their usual</text>
            <text x={pr + 52} y={y(DIP) + 14} className="cl-oc-label">below usual</text>
          </>
        )}
        {[-3, -2, -1, 0, 1, 2].map((v) => (
          <text key={v} x={pl - 8} y={y(v) + 4} textAnchor="end" className="cl-oc-tick">
            {v > 0 ? `+${v}` : v === 0 ? '0' : `−${-v}`}
          </text>
        ))}
        <text x={pl - 8} y={pt - 12} textAnchor="end" className="cl-oc-tick">SD</text>

        {/* the booster and what came after */}
        {split != null && (
          <rect x={x(split)} y={pt} width={Math.max(0, x(Math.min(t1, now)) - x(split))} height={pb - pt} className="cl-oc-after" />
        )}
        {escAt != null && escAt >= t0 && (
          <g>
            <line x1={x(escAt)} x2={x(escAt)} y1={pt} y2={pb} className="cl-oc-esc" />
            <text x={x(escAt) - 6} y={pt + 12} textAnchor="end" className="cl-oc-mark">Practices did not answer it</text>
          </g>
        )}
        {bookAt != null && (
          <g>
            <line x1={x(bookAt)} x2={x(bookAt)} y1={pt - 6} y2={laneY + 10} className="cl-oc-booster" />
            <text x={x(bookAt) + 6} y={pt + 12} className="cl-oc-mark cl-oc-mark--strong">
              {bookAt > now ? `Booster booked, ${fmtDay(bookAt)}` : `Booster, ${fmtDay(bookAt)}`}
            </text>
            {split != null && simulatedAfter && (
              <text x={x(bookAt) + 6} y={pt + 28} className="cl-oc-mark">Simulated response</text>
            )}
          </g>
        )}

        <path d={seg(before)} className="cl-oc-line" />
        {afterLine.length > 1 && <path d={seg(afterLine)} className={`cl-oc-line cl-oc-line--after${simulatedAfter ? ' is-sim' : ''}`} />}
        {pts.map((p) => (
          <circle key={p.t} cx={x(p.t)} cy={y(p.drift)} r={2.4} className={p.drift <= DIP ? 'cl-oc-dot is-low' : 'cl-oc-dot'} />
        ))}
        {last && !narrow && (
          <text x={x(last.t) + 8} y={y(last.drift) + 4} className="cl-oc-end">
            {last.drift > 0 ? '+' : last.drift < 0 ? '−' : ''}
            {Math.abs(last.drift).toFixed(1)}
          </text>
        )}

        {/* the practices the phone offered */}
        <text x={pl - 8} y={laneY + 4} textAnchor="end" className="cl-oc-tick">
          {narrow ? '' : 'Practices'}
        </text>
        <line x1={pl} x2={pr} y1={laneY} y2={laneY} className="cl-oc-lane" />
        {marks.map(({ p, mx, my }) => (
          <g key={p.at}>
            <title>{`${fmtDay(p.at)}: ${p.kind}, ${p.done ? (p.settle == null ? 'done' : `${Math.round(p.settle)}% stiller after`) : 'offered, not done'}`}</title>
            <PracticeMark kind={p.kind} state={practiceState(p)} x={mx} y={my} r={markR} />
          </g>
        ))}

        {xt.map((t) => (
          <text key={t} x={x(t)} y={H - 18} textAnchor="middle" className="cl-oc-tick">
            {fmtDay(t)}
          </text>
        ))}
        {now < t1 && <line x1={x(now)} x2={x(now)} y1={pb} y2={pb + 6} className="cl-oc-zero" />}
      </svg>
    </div>
  )
}

export function OuterLegend() {
  const kinds: [PracticeKind, string][] = [
    ['breathe', 'Breathing'],
    ['scan', 'Body scan'],
    ['walk', 'Walk'],
  ]
  const states: ['settled' | 'done' | 'skipped', string][] = [
    ['settled', 'settled'],
    ['done', 'did not settle'],
    ['skipped', 'offered, not done'],
  ]
  return (
    <div className="cl-oc-legend" aria-label="Legend">
      <ul>
        <li className="cl-oc-legend-k">Shape</li>
        {kinds.map(([k, label]) => (
          <li key={k}>
            <svg width="14" height="14" aria-hidden="true">
              <PracticeMark kind={k} state="done" />
            </svg>
            {label}
          </li>
        ))}
      </ul>
      <ul>
        <li className="cl-oc-legend-k">Fill</li>
        {states.map(([st, label]) => (
          <li key={st}>
            <svg width="14" height="14" aria-hidden="true">
              <PracticeMark kind="breathe" state={st} />
            </svg>
            {label}
          </li>
        ))}
      </ul>
    </div>
  )
}
