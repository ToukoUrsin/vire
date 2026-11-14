import { useId } from 'react'
import type { ViewStatus } from '../data'
import { BAND_HI, BAND_LO, lin, pathOf } from './util'

/**
 * 28-day echo sparkline. Same scale on every row (strength 5..95), the personal "usual" band behind it,
 * the part under the band in the alert colour, and an open mark for every day without a ping:
 * silence shows as a line that stops and a run of empty days.
 */
export function Spark({ values, status, width = 208, height = 46 }: { values: (number | null)[]; status: ViewStatus; width?: number; height?: number }) {
  const id = useId()
  const n = values.length
  const padX = 4
  const top = 3
  const bottom = height - 9
  const x = lin(0, Math.max(1, n - 1), padX, width - padX)
  const y = lin(5, 85, bottom, top)
  const pts = values.map((v, i): [number, number] | null => (v === null ? null : [x(i), y(Math.min(85, Math.max(5, v)))]))
  const d = pathOf(pts)
  let lastIdx = -1
  for (let i = n - 1; i >= 0; i--) {
    if (values[i] !== null) {
      lastIdx = i
      break
    }
  }
  const firstIdx = values.findIndex((v) => v !== null)
  const last = lastIdx >= 0 ? pts[lastIdx] : null
  const lone = pts.filter((p, i) => p && !pts[i - 1] && !pts[i + 1]) as [number, number][]
  const calm = status === 'steady' || status === 'calibrating'
  const tail = n - 1 - lastIdx
  const stroke = calm ? 'var(--ink-3)' : 'var(--ink-2)'
  const alert = status === 'low' ? 'var(--bad)' : 'var(--warn)'
  const endFill = status === 'low' ? 'var(--bad)' : status === 'dipping' ? 'var(--warn)' : calm ? 'var(--ink-3)' : 'var(--ink-2)'
  const latest = lastIdx >= 0 ? values[lastIdx] : null
  const label =
    latest === null
      ? 'No pings in the last 28 days'
      : `Echo over 28 days. Latest ${Math.round(latest)}, where 50 is their usual.${tail >= 1 ? ` No ping for the last ${tail} days.` : ''}`
  return (
    <svg className="cl-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <defs>
        <clipPath id={`${id}a`}>
          <rect x="0" y="0" width={width} height={y(BAND_LO)} />
        </clipPath>
        <clipPath id={`${id}b`}>
          <rect x="0" y={y(BAND_LO)} width={width} height={height} />
        </clipPath>
      </defs>
      <rect x={padX} y={y(BAND_HI)} width={width - padX * 2} height={y(BAND_LO) - y(BAND_HI)} className="cl-spark-band" />
      <line x1={padX} x2={width - padX} y1={y(50)} y2={y(50)} className="cl-spark-usual" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}a)`} />
      <path d={d} fill="none" stroke={calm ? stroke : alert} strokeWidth={calm ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}b)`} />
      {lone.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.4" fill={stroke} />
      ))}
      {values.map((v, i) => (v === null && firstIdx >= 0 && i > firstIdx ? <circle key={i} cx={x(i)} cy={height - 3} r="1.5" className={i > lastIdx && tail >= 3 ? 'cl-spark-miss cl-spark-miss--tail' : 'cl-spark-miss'} /> : null))}
      {last && (tail >= 3 ? <circle cx={last[0]} cy={last[1]} r="3.2" className="cl-spark-stop" /> : <circle cx={last[0]} cy={last[1]} r="3.2" fill={endFill} className="cl-spark-end" />)}
    </svg>
  )
}
