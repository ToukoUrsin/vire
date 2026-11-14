import type { Channel, PatientDetail } from '@shared/types'
import { CHANNELS } from '@shared/types'
import { CH_LABEL, CH_VAR, CH_WHAT } from '../data'
import { fmtDay } from '../data'
import { clamp, lin, pathOf, ticks, useWidth } from './util'

interface Props {
  detail: PatientDetail
  domain: [number, number]
  hover: number | null
  onHover: (i: number | null) => void
}

const fmt = (v: number, span: number) => (span >= 40 ? v.toFixed(0) : span >= 4 ? v.toFixed(1) : v.toFixed(2))

/** Four small multiples on the main chart's time axis: raw values against that person's signature band. */
export function ChannelMultiples(props: Props) {
  return (
    <div className="cl-multiples">
      {CHANNELS.map((c) => (
        <One key={c} channel={c} {...props} />
      ))}
    </div>
  )
}

function One({ channel, detail, domain, hover, onHover }: Props & { channel: Channel }) {
  const [ref, W] = useWidth<HTMLDivElement>(300)
  const H = 150
  const ci = CHANNELS.indexOf(channel)
  const sig = detail.signature.find((s) => s.channel === channel)
  const color = CH_VAR[channel]
  const m = { l: 34, r: 12, t: 8, b: 22 }
  const pl = m.l
  const pr = W - m.r
  const pt = m.t
  const pb = H - m.b
  const [t0, t1] = domain
  const x = lin(t0, t1, pl, pr)

  const pts = detail.timeline
    .map((p, i) => ({ i, p, v: p.components.find((k) => k.channel === channel)?.value ?? p.components[ci]?.value ?? null }))
    .filter((d) => d.p.kind === 'full')
  const vals = pts.map((d) => d.v).filter((v): v is number => v !== null)
  const center = sig?.center ?? (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0)
  const spread = sig?.spread ?? 1
  let lo = Math.min(center - 2 * spread, ...vals)
  let hi = Math.max(center + 2 * spread, ...vals)
  const pad = (hi - lo) * 0.08 || 1
  lo = Math.max(0, lo - pad)
  hi += pad
  const y = lin(lo, hi, pb, pt)
  const line = pathOf(pts.map((d): [number, number] | null => (d.v === null ? null : [x(Date.parse(d.p.at)), y(d.v)])))
  const yt = ticks(lo, hi, 3)
  const span = hi - lo
  const latest = [...pts].reverse().find((d) => d.v !== null) ?? null
  const hv = hover !== null ? pts.find((d) => d.i === hover) ?? null : null
  const shown = hv ?? latest
  const z = shown && shown.v !== null && sig ? (shown.v - sig.center) / (sig.spread || 1) : null
  const courseEnd = detail.course ? Date.parse(detail.course.end) : null

  const move = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left
    let best: number | null = null
    let bd = Infinity
    for (const d of pts) {
      const dist = Math.abs(x(Date.parse(d.p.at)) - mx)
      if (dist < bd) {
        bd = dist
        best = d.i
      }
    }
    onHover(best)
  }

  return (
    <figure className="cl-multi">
      <figcaption>
        <div className="cl-multi-name">
          <i style={{ background: color }} />
          <b>{CH_LABEL[channel]}</b>
          <span>{CH_WHAT[channel]}</span>
        </div>
        <div className="cl-multi-val">
          {shown && shown.v !== null ? (
            <>
              <b>{fmt(shown.v, span)}</b> {sig?.unit}
              {z !== null && <span className={z < -0.75 ? 'is-under' : ''}>{Math.abs(z) < 0.75 ? (detail.status === 'calibrating' ? 'in the typical range' : 'in their usual') : `${Math.abs(z).toFixed(1)} SD ${z < 0 ? 'under' : 'over'}`}</span>}
            </>
          ) : (
            <span>not measured</span>
          )}
        </div>
      </figcaption>
      <div ref={ref} className="cl-chart" onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => onHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${CH_LABEL[channel]}: ${CH_WHAT[channel]}, raw values against the signature band${sig ? ` ${sig.center} plus or minus ${sig.spread} ${sig.unit}` : ''}`}>
          {courseEnd !== null && courseEnd > t0 && courseEnd < t1 && <rect x={pl} y={pt} width={Math.max(0, clamp(x(courseEnd), pl, pr) - pl)} height={pb - pt} className="cl-course" />}
          {sig && (
            <>
              <rect x={pl} y={y(sig.center + sig.spread)} width={Math.max(0, pr - pl)} height={Math.max(1, y(sig.center - sig.spread) - y(sig.center + sig.spread))} fill={color} opacity={0.14} />
              <line x1={pl} x2={pr} y1={y(sig.center)} y2={y(sig.center)} stroke={color} strokeWidth={1} opacity={0.55} />
            </>
          )}
          {yt.map((v) => (
            <text key={v} x={pl - 6} y={y(v) + 4} textAnchor="end" className="cl-ax">
              {fmt(v, span).replace(/\.0+$/, '')}
            </text>
          ))}
          <line x1={pl} x2={pr} y1={pb} y2={pb} className="cl-grid cl-grid--base" />
          <text x={pl} y={pb + 15} className="cl-ax">
            {fmtDay(t0)}
          </text>
          <text x={pr} y={pb + 15} textAnchor="end" className="cl-ax">
            today
          </text>
          <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((d) => (d.v === null || d.p.setting !== 'clinic' ? null : <circle key={d.i} cx={x(Date.parse(d.p.at))} cy={y(d.v)} r={2.4} fill="var(--card)" stroke={color} strokeWidth={1.4} />))}
          {shown && shown.v !== null && (
            <>
              {hv && <line x1={x(Date.parse(shown.p.at))} x2={x(Date.parse(shown.p.at))} y1={pt} y2={pb} className="cl-cross" />}
              <circle cx={x(Date.parse(shown.p.at))} cy={y(shown.v)} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
            </>
          )}
        </svg>
      </div>
      <div className="cl-multi-sig">{sig ? `${detail.status === 'calibrating' ? 'typical' : 'usual'} ${fmt(sig.center, span)} ± ${fmt(sig.spread, span)} ${sig.unit}` : 'no signature yet'}</div>
    </figure>
  )
}
