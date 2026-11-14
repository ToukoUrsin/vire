import type { DoseBelief } from '@shared/types'
import { DOSE_LABEL, signed } from '../data'
import { lin, useWidth } from './util'

/** "What works for this person": posterior mean lift ± 1 sd per dose, best first, in plain words. */
export function DoseChart({ beliefs }: { beliefs: DoseBelief[] }) {
  const [ref, W] = useWidth<HTMLDivElement>(520)
  const rows = [...beliefs].sort((a, b) => (b.n > 0 ? 1 : 0) - (a.n > 0 ? 1 : 0) || b.mean - a.mean)
  const narrow = W < 460
  const labelW = narrow ? 104 : 168
  const wordsW = narrow ? 112 : 150
  const rowH = 44
  const top = 6
  const H = top + rows.length * rowH + 26
  const pl = labelW
  const pr = W - wordsW
  const lo = Math.min(-2, ...rows.map((b) => b.mean - b.sd))
  const hi = Math.max(8, ...rows.map((b) => b.mean + b.sd))
  const x = lin(lo, hi, pl, pr)
  const step = [1, 2, 5, 10, 20].find((k) => (hi - lo) / k <= (narrow ? 4 : 6)) ?? 20
  const xt: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) xt.push(v)

  if (!rows.length) return <p className="cl-empty">No doses tried yet. The first suggestions come from what helped the rest of the cohort.</p>

  return (
    <div ref={ref} className="cl-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rows.map((b) => `${DOSE_LABEL[b.dose]}: ${signed(b.mean, 0)} points after ${b.n} tries`).join('. ')}>
        {xt.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={top} y2={H - 24} className={v === 0 ? 'cl-grid cl-grid--zero' : 'cl-grid'} />
            <text x={x(v)} y={H - 8} textAnchor="middle" className="cl-ax">
              {v === 0 ? '0' : signed(v, 0)}
            </text>
          </g>
        ))}
        {rows.map((b, i) => {
          const cy = top + i * rowH + rowH / 2
          const tried = b.n > 0
          return (
            <g key={b.dose}>
              <text x={0} y={cy + 4} className={i === 0 && tried ? 'cl-dose-name cl-dose-name--best' : 'cl-dose-name'}>
                {narrow && b.dose === 'reach' ? 'Voice note' : DOSE_LABEL[b.dose]}
              </text>
              <line x1={x(b.mean - b.sd)} x2={x(b.mean + b.sd)} y1={cy} y2={cy} className={tried ? 'cl-whisk' : 'cl-whisk cl-whisk--prior'} />
              <circle cx={x(b.mean)} cy={cy} r={5.5} className={tried ? (i === 0 ? 'cl-bdot cl-bdot--best' : 'cl-bdot') : 'cl-bdot cl-bdot--prior'} />
              <text x={pr + 14} y={cy - 2} className="cl-dose-words">
                {tried ? `${signed(b.mean, 0)} after ${b.n} ${b.n === 1 ? 'try' : 'tries'}` : 'not tried yet'}
              </text>
              <text x={pr + 14} y={cy + 13} className="cl-ax">
                {tried ? `± ${b.sd.toFixed(1)}` : 'cohort guess'}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
