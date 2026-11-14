import { useState } from 'react'
import type { PhaseKey, PingTraces } from '@shared/types'
import { clamp, lin, pathOf, useWidth, voiceDb, voiceLin } from './util'

const TARGET: Record<string, PhaseKey> = { smile: 'laugh', head: 'nod', pulse: 'breathe', level: 'speak', pitch: 'speak' }

/**
 * One ping, second by second: five phases across, one lane per signal.
 * The cell where a stimulus meets the signal it is meant to move is tinted in that channel's colour.
 */
export function TraceStrip({ traces }: { traces: PingTraces }) {
  const [ref, W] = useWidth<HTMLDivElement>(700)
  const [hi, setHi] = useState<number | null>(null)
  const narrow = W < 520
  const n = traces.t.length
  const T = (traces.t[n - 1] ?? 0) + 100
  // on a phone the short phases are narrower than their names, so the names alternate between two rows
  const m = { l: narrow ? 62 : 86, r: narrow ? 74 : 112, t: narrow ? 34 : 22, b: 22 }
  const pl = m.l
  const pr = W - m.r
  const x = lin(0, T, pl, pr)
  const lanes = [
    { key: 'smile', label: 'Smile', sub: 'and cheek', h: 46, color: 'var(--ch-smile)' },
    { key: 'head', label: 'Head', sub: 'pitch', h: 46, color: 'var(--ch-move)' },
    { key: 'pulse', label: 'Pulse', sub: 'bpm', h: 46, color: 'var(--ch-heart)' },
    { key: 'level', label: 'Voice', sub: 'level', h: 32, color: 'var(--ch-voice)' },
    { key: 'pitch', label: '', sub: 'pitch', h: 32, color: 'var(--ch-voice)' },
  ]
  const gap = 8
  let acc = m.t
  const pos = lanes.map((l) => {
    const y0 = acc
    acc += l.h + gap
    return { ...l, y0, y1: y0 + l.h }
  })
  const H = acc - gap + m.b
  const phases = traces.phases.map((p, i) => ({ ...p, end: traces.phases[i + 1]?.at ?? T }))
  const inPhase = (key: PhaseKey) => {
    const p = phases.find((q) => q.key === key)
    const idx: number[] = []
    if (p) traces.t.forEach((t, i) => t >= p.at && t < p.end && idx.push(i))
    return idx
  }

  // what the ping measured, read off the traces
  const settle = inPhase('settle').map((i) => traces.smile[i])
  const base = settle.length ? settle.reduce((a, b) => a + b, 0) / settle.length : 0
  const laugh = inPhase('laugh').map((i) => traces.smile[i])
  const peak = laugh.length ? Math.max(...laugh) - base : null
  const nod = inPhase('nod').map((i) => traces.headPitch[i])
  const nodAmp = nod.length ? (Math.max(...nod) - Math.min(...nod)) / 2 : null
  const br = inPhase('breathe').map((i) => traces.bpm[i]).filter((v): v is number => v !== null)
  const swing = br.length ? Math.max(...br) - Math.min(...br) : null
  const sp = inPhase('speak').map((i) => traces.f0[i]).filter((v): v is number => v !== null && v > 0)
  let pitchSd: number | null = null
  if (sp.length > 4) {
    const st = sp.map((f) => 12 * Math.log2(f))
    const mean = st.reduce((a, b) => a + b, 0) / st.length
    pitchSd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length)
  }
  const spoke = inPhase('speak')
  const spokeFrac = spoke.length ? spoke.filter((i) => traces.f0[i] !== null).length / spoke.length : null
  const summary: Record<string, string> = {
    smile: peak === null ? '' : `peak ${signedN(peak, 2)}`,
    head: nodAmp === null ? '' : `nod ${nodAmp.toFixed(0)}°`,
    pulse: swing === null ? 'no pulse' : `swing ${swing.toFixed(0)} bpm`,
    level: spokeFrac === null ? '' : `voiced ${(spokeFrac * 100).toFixed(0)}%`,
    pitch: pitchSd === null ? 'no pitch' : `± ${pitchSd.toFixed(1)} st`,
  }

  const range = (xs: (number | null)[], padFrac = 0.12, minSpan = 1): [number, number] => {
    const v = xs.filter((q): q is number => q !== null)
    if (!v.length) return [0, 1]
    let lo = Math.min(...v)
    let hi2 = Math.max(...v)
    if (hi2 - lo < minSpan) {
      const c = (hi2 + lo) / 2
      lo = c - minSpan / 2
      hi2 = c + minSpan / 2
    }
    const p = (hi2 - lo) * padFrac
    return [lo - p, hi2 + p]
  }
  const L = (k: string) => pos.find((p) => p.key === k)!
  const ySmile = lin(0, Math.max(0.6, ...traces.smile, ...traces.cheek) * 1.05, L('smile').y1, L('smile').y0)
  const [hLo, hHi] = range(traces.headPitch, 0.1, 8)
  const yHead = lin(hLo, hHi, L('head').y1, L('head').y0)
  const [bLo, bHi] = range(traces.bpm, 0.15, 8)
  const yBpm = lin(bLo, bHi, L('pulse').y1, L('pulse').y0)
  const level = traces.rms.map(voiceLin)
  const yRms = lin(0, Math.max(0.05, ...level) * 1.05, L('level').y1, L('level').y0)
  const [fLo, fHi] = range(traces.f0, 0.15, 30)
  const yF0 = lin(fLo, fHi, L('pitch').y1, L('pitch').y0)

  const P = (ys: (number | null)[], sc: (v: number) => number) => pathOf(ys.map((v, i): [number, number] | null => (v === null ? null : [x(traces.t[i]), sc(v)])))
  const area = (ys: number[], sc: (v: number) => number, y1: number) => (n ? `${P(ys, sc)}L${x(traces.t[n - 1]).toFixed(1)},${y1}L${x(traces.t[0]).toFixed(1)},${y1}Z` : '')

  const at = hi === null ? null : traces.t[hi]
  const live: Record<string, string> =
    hi === null
      ? summary
      : {
          smile: traces.smile[hi].toFixed(2),
          head: `${traces.headPitch[hi].toFixed(0)}°`,
          pulse: traces.bpm[hi] === null ? '' : `${traces.bpm[hi]!.toFixed(0)} bpm`,
          level: `${voiceDb(traces.rms[hi]).toFixed(0)} dB`,
          pitch: traces.f0[hi] === null ? 'silent' : `${traces.f0[hi]!.toFixed(0)} Hz`,
        }

  return (
    <div
      ref={ref}
      className="cl-chart cl-strip"
      onPointerMove={(e) => {
        const mx = e.clientX - e.currentTarget.getBoundingClientRect().left
        setHi(mx < pl || mx > pr ? null : clamp(Math.round(((mx - pl) / (pr - pl)) * (n - 1)), 0, n - 1))
      }}
      onPointerLeave={() => setHi(null)}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Traces of the latest ping over ${(T / 1000).toFixed(0)} seconds in five phases. ${Object.values(summary).filter(Boolean).join(', ')}.`}>
        {/* phases */}
        {phases.map((p, i) => (
          <g key={p.key}>
            {i > 0 && <line x1={x(p.at)} x2={x(p.at)} y1={m.t - 6} y2={H - m.b} className="cl-grid" />}
            <text x={(x(p.at) + x(p.end)) / 2} y={narrow && i % 2 ? 23 : 11} textAnchor="middle" className="cl-ax cl-ax--strong">
              {p.key}
            </text>
          </g>
        ))}
        {pos.map((l) => {
          const ph = phases.find((p) => p.key === TARGET[l.key])
          return (
            <g key={l.key}>
              {ph && <rect x={x(ph.at)} y={l.y0 - 3} width={Math.max(0, x(ph.end) - x(ph.at))} height={l.h + 6} fill={l.color} opacity={0.1} rx={3} />}
              <line x1={pl} x2={pr} y1={l.y1} y2={l.y1} className="cl-grid" />
              {l.label && (
                <text x={0} y={l.y0 + 14} className="cl-lane">
                  {l.label}
                </text>
              )}
              <text x={0} y={l.y0 + (l.label ? 28 : 14)} className="cl-ax">
                {l.sub}
              </text>
              <text x={pr + 10} y={l.y0 + l.h / 2 + 4} className={hi === null ? 'cl-lane-val' : 'cl-lane-val cl-lane-val--live'}>
                {live[l.key]}
              </text>
            </g>
          )
        })}

        <path d={area(traces.smile, ySmile, L('smile').y1)} fill="var(--ch-smile)" opacity={0.12} />
        <path d={P(traces.cheek, ySmile)} fill="none" stroke="var(--ch-smile)" strokeWidth={1.2} opacity={0.55} strokeDasharray="1 3" strokeLinecap="round" />
        <path d={P(traces.smile, ySmile)} fill="none" stroke="var(--ch-smile)" strokeWidth={2} strokeLinejoin="round" />
        <path d={P(traces.headPitch, yHead)} fill="none" stroke="var(--ch-move)" strokeWidth={1.75} strokeLinejoin="round" />
        <path d={P(traces.bpm, yBpm)} fill="none" stroke="var(--ch-heart)" strokeWidth={1.75} strokeLinejoin="round" />
        <path d={area(level, yRms, L('level').y1)} fill="var(--ch-voice)" opacity={0.3} />
        <path d={P(traces.f0, yF0)} fill="none" stroke="var(--ch-voice)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

        {[0, 10, 20, 30, 40, 50].filter((s) => s * 1000 <= T).map((s) => (
          <text key={s} x={x(s * 1000)} y={H - 6} textAnchor={s === 0 ? 'start' : 'middle'} className="cl-ax">
            {s === 0 ? '0 s' : s}
          </text>
        ))}

        {at !== null && (
          <g pointerEvents="none">
            <line x1={x(at)} x2={x(at)} y1={m.t - 4} y2={H - m.b} className="cl-cross" />
            <text x={clamp(x(at), pl + 16, pr - 16)} y={H - 6} textAnchor="middle" className="cl-ax cl-ax--strong cl-ax--halo">
              {(at / 1000).toFixed(1)} s
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

const signedN = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`
