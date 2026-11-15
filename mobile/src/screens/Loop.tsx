// How Vire works: the loop as a wheel, then each step with what runs today and what is still a sample.
// Only reading nods and head shakes from real AirPods runs today; the loop around it has run with stand-in AirPods.
import { Fragment, type CSSProperties } from 'react'
import { I, type IconName } from '../ui/icons'
import { Badge, Research, Row, Screen, Section, type Tone } from '../ui/kit'
import './loop.css'

const rise = (i: number) => ({ '--i': i }) as CSSProperties

// ---------- the wheel ----------
const C = 160
const R = 108
const DISC = 24
const TURN_S = 14 // one round of the ember dot; `.lp-orbit` in loop.css turns at the same pace

const STOPS: Array<{ label: string; icon: IconName }> = [
  { label: 'Sense', icon: 'airpods' },
  { label: 'Notice', icon: 'spark' },
  { label: 'Practice', icon: 'breath' },
  { label: 'Measure', icon: 'heart' },
  { label: 'Learn', icon: 'you' },
]
const rad = (deg: number) => (deg * Math.PI) / 180
const on = (deg: number, r = R): [number, number] => [C + Math.cos(rad(deg)) * r, C + Math.sin(rad(deg)) * r]
const stopDeg = (i: number) => -90 + i * (360 / STOPS.length)

/** where the word of a stop sits: above the top one, beside the two upper ones, under the two lower ones */
function word(i: number, x: number, y: number): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  if (i === 0) return { x, y: y - DISC - 11, anchor: 'middle' }
  if (i === 1) return { x: x + DISC + 9, y: y + 4.5, anchor: 'start' }
  if (i === 4) return { x: x - DISC - 9, y: y + 4.5, anchor: 'end' }
  return { x, y: y + DISC + 20, anchor: 'middle' }
}

// the dot goes under each stop as it arrives, and the stop lights up: the delay is when the dot gets there
const WHEEL_CSS = `
.lw-stop { --at: calc(var(--k) * ${TURN_S / STOPS.length}s - 0.5s); }
.lw-disc { fill: #2b2621; animation: lw-disc ${TURN_S}s linear var(--at) infinite backwards; }
.lw-icon { color: var(--ink); animation: lw-icon ${TURN_S}s linear var(--at) infinite backwards; }
.lw-word { fill: var(--ink-2); animation: lw-word ${TURN_S}s linear var(--at) infinite backwards; }
@keyframes lw-disc { 0%, 27%, 100% { fill: #2b2621; } 4%, 12% { fill: #e4572e; } }
@keyframes lw-icon { 0%, 27%, 100% { color: var(--ink); } 4%, 12% { color: #fff8f0; } }
@keyframes lw-word { 0%, 27%, 100% { fill: var(--ink-2); } 4%, 14% { fill: var(--ink); } }
@media (prefers-reduced-motion: reduce) {
  .lp-orbit, .lw-disc, .lw-icon, .lw-word { animation: none !important; }
}
`

function Wheel() {
  const [tx, ty] = on(-90 - 34)
  const [hx, hy] = on(-90)
  return (
    <div className="lp-wheel">
      <svg viewBox="0 0 320 320" role="img" aria-label="The loop: sense, notice, practice, measure, learn, and round again">
        <defs>
          <radialGradient id="lp-core" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#e4572e" stopOpacity="0.2" />
            <stop offset="1" stopColor="#e4572e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R - 6} fill="url(#lp-core)" />
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255, 240, 220, 0.16)" strokeWidth={1.5} />
        {STOPS.map((_, i) => {
          const deg = stopDeg(i) + 180 / STOPS.length
          const [x, y] = on(deg)
          return <path key={i} d="M-2.6 -3.6L2.2 0L-2.6 3.6" transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg + 90})`} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        })}
        <g className="lp-orbit">
          <path d={`M${tx.toFixed(1)} ${ty.toFixed(1)}A${R} ${R} 0 0 1 ${hx} ${hy}`} fill="none" stroke="#ff7d55" strokeOpacity={0.55} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={hx} cy={hy} r={13} fill="#e4572e" opacity={0.22} />
          <circle cx={hx} cy={hy} r={6} fill="#ff7d55" />
        </g>
        {STOPS.map((s, i) => {
          const [x, y] = on(stopDeg(i))
          const w = word(i, x, y)
          const Icon = I[s.icon]
          return (
            <g key={s.label} className="lw-stop" style={{ '--k': i } as CSSProperties}>
              <circle className="lw-disc" cx={x} cy={y} r={DISC} />
              <g className="lw-icon">
                <Icon x={x - 11} y={y - 11} size={22} />
              </g>
              <text className="lw-word" x={w.x} y={w.y} textAnchor={w.anchor} fontSize="13" fontWeight={600} fontFamily="var(--font-ui)">
                {s.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="lp-mid">
        <div>
          <div className="title-m">Your own usual</div>
          <div className="lp-mid-sub">not an average person</div>
        </div>
      </div>
    </div>
  )
}

// ---------- the steps ----------
type Stamp = { kind?: 'real' | 'sample'; say: string }
const STAND_IN: Stamp = { kind: 'sample', say: 'Sample: stand-in AirPods so far' }
const STEPS: Array<{ title: string; icon: IconName; tone: Tone; text: string; tags: Stamp[] }> = [
  { title: 'Sense', icon: 'airpods', tone: 'move', text: 'Your AirPods send head motion about 25 times a second. Heart rate too, on AirPods Pro 3, during a practice.', tags: [{ kind: 'real', say: 'Runs today: nods, head shakes, head movement' }, { say: 'Built: heart rate, not yet on a real run' }] },
  { title: 'Notice', icon: 'spark', tone: 'face', text: 'Everything is set against your own usual. When you drift from it, Vire offers a practice.', tags: [STAND_IN] },
  { title: 'Practice', icon: 'breath', tone: 'ember', text: 'Slow breathing, a body scan or a walk, in your ears. The sound is made on a Modal GPU.', tags: [STAND_IN] },
  { title: 'Measure', icon: 'heart', tone: 'heart', text: 'The same short check before and after: heart rate, and how still your head sits.', tags: [STAND_IN, { say: 'Built: heart rate, not yet on a real run' }] },
  { title: 'Learn', icon: 'you', tone: 'voice', text: 'A model for each person: 13 small models on the phone, then 366 in a Modal Sandbox of your own. And which practice works for you.', tags: [{ kind: 'real', say: 'Runs today: your own model' }, { kind: 'sample', say: 'Sample: what works for you' }] },
]

const NEXT: Array<{ icon: IconName; tone: 'voice' | 'face' | 'heart'; title: string; sub: string; to: string }> = [
  { icon: 'call', tone: 'voice', title: 'Calls', sub: 'How much you talk and nod, with each person', to: '/signals/calls' },
  { icon: 'music', tone: 'face', title: 'Music', sub: 'What you play, and if your head moves with it', to: '/signals/music' },
  { icon: 'sleep', tone: 'heart', title: 'Sleep', sub: 'Heart rate through the night, and how much you stir', to: '/signals/sleep' },
]
const Tag = ({ kind, children }: { kind?: 'real' | 'sample'; children: string }) => (
  <span className={`lp-tag ${kind ? `is-${kind}` : ''}`}>
    {kind && <span className="dot" />}
    {children}
  </span>
)

export function Loop(_: { id?: string; topic?: string }) {
  return (
    <Screen nav="How Vire works" backTo="/today" glow="ember">
      <style>{WHEEL_CSS}</style>
      <div className="pad rise" style={rise(0)}>
        <h1 className="title-xl">A loop that closes</h1>
        <p className="lede lp-lede">Sense, step in, check, learn. Then round again.</p>
      </div>

      <div className="pad rise" style={rise(1)}>
        <Wheel />
      </div>

      <Section title="Five steps" i={2}>
        <div className="lp-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card lp-step">
              <Badge icon={s.icon} tone={s.tone} size={44} />
              <div>
                <h3 className="title-m">{s.title}</h3>
                <p className="body-2">{s.text}</p>
                {s.tags.map((t) => (
                  <Fragment key={t.say}>
                    <Tag kind={t.kind}>{t.say}</Tag>{' '}
                  </Fragment>
                ))}
              </div>
              <span className="lp-step-n num" aria-hidden="true">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="The outer loop" i={3}>
        <div className="card lp-step">
          <Badge icon="clinic" size={44} />
          <div>
            <h3 className="title-m">Your clinic</h3>
            <p className="body-2">Drift the practices do not fix goes to the top of your clinic’s list, with what was tried. The clinic can book a TMS booster then.</p>
            <Tag kind="sample">Sample: simulated patients only</Tag>
          </div>
        </div>
      </Section>

      <Section title="Where it goes" i={4}>
        <div className="group">
          {NEXT.map((n) => (
            <Row key={n.to} icon={n.icon} tone={n.tone} title={n.title} sub={n.sub} right={<Tag>Next</Tag>} to={n.to} />
          ))}
        </div>
      </Section>

      <Section title="What Vire is not" i={5}>
        <div className="card lp-not">
          <p className="voice">A signal for the clinic, not a diagnosis.</p>
          <p className="body-2">No patient and no clinic has used Vire. Reading nods and head shakes from real AirPods runs today. The loop around it has run only with stand-in AirPods and simulated patients.</p>
        </div>
      </Section>

      <Research topic="loop" i={6} />
      <Research topic="earables" i={7} title="And on what earbuds can read" />
    </Screen>
  )
}
