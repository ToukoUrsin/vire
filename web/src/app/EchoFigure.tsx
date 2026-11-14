// The echo as one figure: four petals in the four fixed colours, drawn against a dashed ring that is "your usual".
// A petal that reaches past the ring answered more than usual; one that stops short answered less.
import type { Channel, Echo } from '@shared/types'

interface Props {
  echo: Echo
  tone: 'stage' | 'paper'
  /** grow the petals in (the result reveal) */
  animate?: boolean
  /** hide the channel words (small figures) */
  bare?: boolean
}

const ANGLE: Record<Channel, number> = { smile: -90, voice: 0, heart: 90, move: 180 }
const ORDER: Channel[] = ['smile', 'voice', 'heart', 'move']
const USUAL = 72 // radius of the "usual" ring, in SVG units

/** tip radius for a strength: 0 -> short stub, 50 -> exactly the ring, 100 -> well past it */
const reach = (strength: number) => USUAL * (0.4 + 0.012 * Math.max(0, Math.min(100, strength)))

/** a leaf from the centre to radius r along +x */
function petal(r: number): string {
  const wide = 24 + r * 0.2
  return `M0 0 C ${r * 0.28} ${-wide}, ${r * 0.8} ${-wide * 0.86}, ${r} 0 C ${r * 0.8} ${wide * 0.86}, ${r * 0.28} ${wide}, 0 0 Z`
}

export function describe(echo: Echo): string {
  if (echo.status === 'calibrating' || !['steady', 'dipping', 'low'].includes(String(echo.status))) {
    return `Measured readings while your usual is being learned: ${echo.components.map((c) => c.value == null ? `${c.channel} not read` : `${c.channel} ${c.value} ${c.unit}`).join(', ')}.`
  }
  const parts = echo.components.map((c) => {
    if (c.value == null) return `${c.channel} not read`
    const d = c.strength - 50
    return `${c.channel} ${Math.abs(d) < 6 ? 'at your usual' : d > 0 ? 'above your usual' : 'below your usual'}`
  })
  return `Your echo: ${parts.join(', ')}.`
}

export default function EchoFigure({ echo, tone, animate, bare }: Props) {
  const by = new Map(echo.components.map((c) => [c.channel, c]))
  const calibrating = echo.status === 'calibrating'
  return (
    <svg
      className="va-figure"
      data-tone={tone}
      data-animate={animate ? 'true' : 'false'}
      viewBox={bare ? '-122 -122 244 244' : '-184 -148 368 296'}
      role="img"
      aria-label={describe(echo)}
    >
      <g>
        {/* the usual: a ring, and the outline each petal would have on an ordinary day */}
        <circle className="va-figure-usual" r={USUAL} />
        {ORDER.map((ch) => (
          <path key={`g-${ch}`} className="va-figure-ghost" d={petal(USUAL)} transform={`rotate(${ANGLE[ch]})`} />
        ))}
        {ORDER.map((ch, i) => {
          const c = by.get(ch)
          const missing = !c || c.value == null
          const r = reach(calibrating ? 50 : c ? c.strength : 50)
          return (
            <g key={ch} transform={`rotate(${ANGLE[ch]})`}>
              <path
                className="va-figure-petal"
                data-ch={ch}
                data-missing={missing}
                d={missing ? 'M0 0' : petal(r)}
                style={{ animationDelay: `${180 + i * 130}ms` }}
              />
            </g>
          )
        })}
        <circle className="va-figure-core" r="5" />
        {!bare &&
          ORDER.map((ch) => {
            const c = by.get(ch)
            const r = Math.max(reach(c && c.value != null ? c.strength : 50), USUAL) + 16
            const a = (ANGLE[ch] * Math.PI) / 180
            const x = Math.cos(a) * r
            const y = Math.sin(a) * r
            const anchor = ch === 'voice' ? 'start' : ch === 'move' ? 'end' : 'middle'
            const dy = ch === 'smile' ? -2 : ch === 'heart' ? 12 : 4
            return (
              <text key={`t-${ch}`} className="va-figure-label" x={x} y={y + dy} textAnchor={anchor}>
                {ch}
              </text>
            )
          })}
        {!bare && (
          <text className="va-figure-usual-label" x={USUAL * 0.74 + 6} y={-USUAL * 0.74 - 6}>
            {calibrating ? 'a typical echo' : 'your usual'}
          </text>
        )}
      </g>
    </svg>
  )
}
