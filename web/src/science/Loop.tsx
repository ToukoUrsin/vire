// The Vire loop as one drawing: a fast loop at home each day, a slow one through the clinic.
// Colours and fonts come from science.css (classes), so the drawing follows the theme tokens.

const NODE_W = 124
const NODE_H = 56

function Node({ cx, cy, name, sub }: { cx: number; cy: number; name: string; sub: string }) {
  return (
    <g>
      <rect className="sci-loop-node" x={cx - NODE_W / 2} y={cy - NODE_H / 2} width={NODE_W} height={NODE_H} rx={16} />
      <text className="sci-loop-name" x={cx} y={cy - 3} textAnchor="middle">
        {name}
      </text>
      <text className="sci-loop-sub" x={cx} y={cy + 15} textAnchor="middle">
        {sub}
      </text>
    </g>
  )
}

export default function Loop() {
  return (
    <svg
      className="sci-loop"
      viewBox="0 0 460 452"
      role="img"
      aria-label="The Vire loop. At home each day: a 60 second ping, then the echo compared with your own usual, then a dose of one to three minutes, then the app notes what followed the dose, and back to the ping. The echo's drift goes to the clinic as numbers only. The clinic sets the well signature, keeps a short list and can ask the person in for a booster session."
    >
      <defs>
        <marker id="sci-arrow-ember" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1.5 L8.5 5 L1 8.5" className="sci-loop-head sci-loop-head-ember" />
        </marker>
        <marker id="sci-arrow-ink" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1.5 L8.5 5 L1 8.5" className="sci-loop-head sci-loop-head-ink" />
        </marker>
      </defs>

      {/* home */}
      <rect className="sci-loop-zone" x={8} y={8} width={444} height={326} rx={26} />
      <text className="sci-loop-zone-label" x={30} y={38}>
        AT HOME
      </text>

      {/* the daily loop, clockwise */}
      <path className="sci-loop-arc" d="M 296 64 C 338 66, 362 100, 362 138" markerEnd="url(#sci-arrow-ember)" />
      <path className="sci-loop-arc" d="M 362 206 C 362 244, 338 278, 298 280" markerEnd="url(#sci-arrow-ember)" />
      <path className="sci-loop-arc" d="M 164 280 C 122 278, 98 244, 98 206" markerEnd="url(#sci-arrow-ember)" />
      <path className="sci-loop-arc" d="M 98 138 C 98 100, 122 66, 162 64" markerEnd="url(#sci-arrow-ember)" />

      <text className="sci-loop-centre" x={230} y={168} textAnchor="middle">
        one minute
      </text>
      <text className="sci-loop-centre" x={230} y={190} textAnchor="middle">
        a day
      </text>

      <Node cx={230} cy={64} name="Ping" sub="a 60 second probe" />
      <Node cx={362} cy={172} name="Echo" sub="against your usual" />
      <Node cx={230} cy={280} name="Dose" sub="1 to 3 minutes" />
      <Node cx={98} cy={172} name="Learn" sub="what followed it" />

      {/* home <-> clinic */}
      <path className="sci-loop-link" d="M 330 336 L 330 376" markerEnd="url(#sci-arrow-ink)" />
      <text className="sci-loop-link-label" x={340} y={360}>
        drift, numbers only
      </text>
      <path className="sci-loop-link" d="M 130 380 L 130 340" markerEnd="url(#sci-arrow-ink)" />
      <text className="sci-loop-link-label" x={120} y={360} textAnchor="end">
        booster session
      </text>

      {/* clinic */}
      <rect className="sci-loop-clinic" x={8} y={382} width={444} height={62} rx={20} />
      <text className="sci-loop-name" x={230} y={408} textAnchor="middle">
        Clinic
      </text>
      <text className="sci-loop-sub" x={230} y={427} textAnchor="middle">
        sets your well signature, keeps a short list
      </text>
    </svg>
  )
}
