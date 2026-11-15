// How Vire works: the loop as a wheel, then each step with what runs today.
import type { CSSProperties } from 'react'
import { I, type IconName } from '../ui/icons'
import { Head, Research, Row, Screen, Section } from '../ui/kit'
import './today.css'

// ---------- the wheel ----------
const C = 160
const R = 106
const DISC = 21
const TURN_S = 14 // one round of the ember dot; `.loop-orbit` in today.css turns at the same pace

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
.lw-disc { fill: var(--bg-3); animation: lw-disc ${TURN_S}s linear var(--at) infinite backwards; }
.lw-icon { color: var(--ink-2); animation: lw-icon ${TURN_S}s linear var(--at) infinite backwards; }
.lw-word { fill: var(--ink-2); animation: lw-word ${TURN_S}s linear var(--at) infinite backwards; }
@keyframes lw-disc { 0%, 27%, 100% { fill: var(--bg-3); } 4%, 12% { fill: var(--ember); } }
@keyframes lw-icon { 0%, 27%, 100% { color: var(--ink-2); } 4%, 12% { color: var(--on-ember); } }
@keyframes lw-word { 0%, 27%, 100% { fill: var(--ink-2); } 4%, 14% { fill: var(--ink); } }
.lw-n { font: 600 15px/1 var(--font-ui); color: var(--ink); }
.lw-mid { position: absolute; inset: 27%; display: grid; place-content: center; text-align: center; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .loop-orbit, .lw-disc, .lw-icon, .lw-word { animation: none !important; }
}
`

function Wheel() {
  const [tx, ty] = on(-90 - 30)
  const [hx, hy] = on(-90)
  return (
    <div className="loop-wheel">
      <svg viewBox="0 0 320 320" role="img" aria-label="The loop: sense, notice, practice, measure, learn, and round again">
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line-2)" strokeWidth={1} />
        {STOPS.map((_, i) => {
          const deg = stopDeg(i) + 180 / STOPS.length
          const [x, y] = on(deg)
          return <path key={i} d="M-2.6 -3.6L2.2 0L-2.6 3.6" transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg + 90})`} fill="none" stroke="var(--ink-3)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        })}
        <g className="loop-orbit">
          <path d={`M${tx.toFixed(1)} ${ty.toFixed(1)}A${R} ${R} 0 0 1 ${hx} ${hy}`} fill="none" stroke="var(--ember)" strokeOpacity={0.4} strokeWidth={2} strokeLinecap="round" />
          <circle cx={hx} cy={hy} r={11} fill="var(--ember)" opacity={0.2} />
          <circle cx={hx} cy={hy} r={5.5} fill="var(--ember)" />
        </g>
        {STOPS.map((s, i) => {
          const [x, y] = on(stopDeg(i))
          const w = word(i, x, y)
          const Icon = I[s.icon]
          return (
            <g key={s.label} className="lw-stop" style={{ '--k': i } as CSSProperties}>
              <circle cx={x} cy={y} r={DISC + 5} fill="var(--bg)" />
              <circle className="lw-disc" cx={x} cy={y} r={DISC} />
              <g className="lw-icon">
                <Icon x={x - 11} y={y - 11} size={22} />
              </g>
              <text className="lw-word" x={w.x} y={w.y} textAnchor={w.anchor} fontSize="13" fontWeight={500} fontFamily="var(--font-ui)">
                {s.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="lw-mid">
        <div>
          <div className="title-m">Your own usual</div>
          <div className="small" style={{ marginTop: 6 }}>
            not an average person
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- the steps ----------
const STEPS: Array<{ title: string; text: string; tag: string }> = [
  { title: 'Sense', text: 'Your AirPods send head motion 50 times a second: how much your head moves, head down, nods, head shakes, steps. Heart rate too, in beats a minute, on AirPods Pro 3.', tag: 'Runs today, while Vire is open' },
  { title: 'Notice', text: 'Everything is set against your own usual, not an average person. When you drift from it, Vire offers a practice.', tag: 'Runs today' },
  { title: 'Practice', text: 'Slow breathing, a body scan or a walk, in your ears. The sound is made for the moment on a Modal GPU.', tag: 'Runs today' },
  { title: 'Measure', text: 'The same short check before and after: heart rate, and how still your head sits.', tag: 'Runs today' },
  { title: 'Learn', text: 'A model for each person: 13 small models on the phone, then 366 in a Modal Sandbox of your own with the network blocked. And which practice works for you.', tag: 'Runs today' },
]

const NEXT: Array<{ icon: IconName; tone: 'voice' | 'face' | 'heart'; title: string; sub: string; to: string }> = [
  { icon: 'call', tone: 'voice', title: 'Calls', sub: 'How much you talk and nod, with each person', to: '/signals/calls' },
  { icon: 'music', tone: 'face', title: 'Music', sub: 'What you play, and if your head moves with it', to: '/signals/music' },
  { icon: 'sleep', tone: 'heart', title: 'Sleep', sub: 'Heart rate through the night, and how much you stir', to: '/signals/sleep' },
]
const Next = () => (
  <span className="tag" style={{ marginTop: 0 }}>
    Next
  </span>
)

export function Loop(_: { id?: string; topic?: string }) {
  return (
    <Screen nav="How Vire works" backTo="/today">
      <style>{WHEEL_CSS}</style>
      <Head title="A loop that closes" sub="Vire senses your day, steps in when you drift, checks what that did and learns from it. Then round again." />

      <div className="pad rise" style={{ '--i': 1, marginTop: 26, marginBottom: -18 } as CSSProperties}>
        <Wheel />
      </div>

      <Section title="Five steps" i={2}>
        <div className="card">
          <div className="steplist">
            {STEPS.map((s, i) => (
              <div key={s.title} style={i === STEPS.length - 1 ? { paddingBottom: 0 } : undefined}>
                <span className="badge lw-n num">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                  <span className="tag is-real">{s.tag}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="The outer loop" i={3}>
        <div className="card">
          <div className="steplist">
            <div style={{ paddingBottom: 0 }}>
              <span className="badge">
                <I.clinic size={21} />
              </span>
              <div>
                <h3>Your clinic</h3>
                <p>Drift the practices do not fix goes to the top of your clinic’s list, with what was tried. The clinic can book a TMS booster then.</p>
                <span className="tag is-real">Runs today, with simulated patients</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Where it goes" i={4}>
        <div className="group">
          {NEXT.map((n) => (
            <Row key={n.to} icon={n.icon} tone={n.tone} title={n.title} sub={n.sub} right={<Next />} to={n.to} />
          ))}
        </div>
      </Section>

      <Section title="What Vire is not" i={5}>
        <div className="card">
          <p className="quote">A signal for the clinic, not a diagnosis.</p>
          <p className="body-2" style={{ marginTop: 10 }}>
            No patient and no clinic has used Vire. So far it has run on our own AirPods and on simulated patients.
          </p>
        </div>
      </Section>

      <Research topic="loop" i={6} />
      <Research topic="earables" i={7} title="And on what earbuds can read" />
    </Screen>
  )
}
