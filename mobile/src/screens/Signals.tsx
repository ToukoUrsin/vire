// Signals: what the AirPods could pick up through a day, drawn with the sample person. Calls, music and sleep are
// not built; movement is felt today on the main site. Each screen says so at the end.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { CALL_WEEK, DAY, HEAD_DOWN_WEEK, NIGHT, NIGHT_WEEK, PEOPLE, PRACTICES, RING, SONGS, STEPS_WEEK, type Song } from '../data/sample'
import { BandBars, BandLine, Spark, Strip } from '../ui/charts'
import { Chip, Head, Research, Row, SampleNote, Screen, Section, type Tone } from '../ui/kit'
import { PodsChip } from './Today'
import type { Topic } from '../data/refs'
import './signals.css'

const rise = (i?: number): CSSProperties => ({ '--i': i ?? 0 }) as CSSProperties
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n: number) => WORD[n] ?? String(n)
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

// The sample day is a Thursday (the nurse wrote on Wednesday and looks again on Friday, and Thursday's night is the
// sample night). So a week is drawn as the last seven days, and the last bar is today.
const TODAY = 3
const TUE = 1
const WED = 2
const week = <T,>(v: T[]): T[] => [...v.slice(TODAY + 1), ...v.slice(0, TODAY + 1)]
const DAYS = week(CALL_WEEK.days).map((d, i, a) => (i === a.length - 1 ? 'Today' : d))

/** the sentence that carries a screen */
function Say({ children, i }: { children: ReactNode; i: number }) {
  return (
    <p className="sg-say pad rise" style={rise(i)}>
      {children}
    </p>
  )
}

/** a slim bar, 0 to 1. `mid` draws a hairline at the half. */
function Bar({ share, tone, mid }: { share: number; tone: Tone; mid?: boolean }) {
  return (
    <span className={`sg-bar ${mid ? 'has-mid' : ''}`}>
      <i style={{ width: `${Math.max(1.5, Math.min(1, share) * 100)}%`, background: `var(--${tone})` }} />
    </span>
  )
}
/** a change either side of none, on a scale of plus and minus `max` */
function Swing({ v, max, tone }: { v: number; max: number; tone: Tone }) {
  const w = (Math.abs(v) / max) * 50
  return (
    <span className="sg-bar has-mid">
      <i className={v < 0 ? 'is-down' : ''} style={{ left: `${v < 0 ? 50 - w : 50}%`, width: `${w}%`, background: `var(--${tone})` }} />
    </span>
  )
}
function Read({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="sg-read">
      <span>{label}</span>
      {children}
      <span className="num">{value}</span>
    </div>
  )
}

/**
 * A week of nights as dots against the usual band. The kit's BandBars start at zero, where a resting heart rate
 * of 53 and one of 58 look the same; dots have no zero to start from, so the scale can sit round the band.
 */
function BandDots({ values, labels, heads, lo, hi, tone, fmt }: { values: number[]; labels: string[]; heads?: string[]; lo: number; hi: number; tone: Tone; fmt: (v: number) => string }) {
  const [sel, setSel] = useState(values.length - 1)
  const W = 320
  const H = 150
  const top = 22
  const base = H - 24
  const min = Math.min(lo, ...values) - 2
  const max = Math.max(hi, ...values) + 1.5
  const y = (v: number) => base - ((v - min) / (max - min)) * (base - top)
  const slot = (W - 8) / values.length
  const x = (i: number) => 4 + i * slot + slot / 2
  const color = `var(--${tone})`
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="title-m num">{fmt(values[sel])}</span>
        <span className="small">{(heads ?? labels)[sel]}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', touchAction: 'pan-y' }} role="img" aria-label="The week against your usual">
        <rect x={0} y={y(hi)} width={W} height={y(lo) - y(hi)} fill="var(--ink)" fillOpacity={0.08} rx={3} />
        <text x={W - 6} y={y(lo) + 14} textAnchor="end" fontSize="10.5" fill="var(--ink-3)" fontFamily="var(--font-ui)" className="num">
          your usual, {lo} to {hi}
        </text>
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--ink)" strokeOpacity={0.14} />
        <path d={values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />
        {values.map((v, i) => (
          <g key={i} onPointerDown={() => setSel(i)} style={{ cursor: 'pointer' }}>
            <rect x={x(i) - slot / 2} y={0} width={slot} height={H} fill="transparent" />
            <circle cx={x(i)} cy={y(v)} r={i === sel ? 7 : 5.5} fill="var(--bg-1)" />
            <circle cx={x(i)} cy={y(v)} r={i === sel ? 5 : 3.5} fill={color} />
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={i === sel ? 'var(--ink)' : 'var(--ink-3)'} fontFamily="var(--font-ui)">
              {labels[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

/** a second block of studies on one screen, under its own heading (the kit's block always says "What the research says") */
function AlsoResearch({ topic, title, i }: { topic: Topic; title: string; i: number }) {
  return (
    <div className="sg-also">
      <div className="section-head rise" style={rise(i)}>
        <h2 className="title-m">{title}</h2>
      </div>
      <Research topic={topic} i={i} />
    </div>
  )
}

// ---------- the tab root ----------

/** how every chart in the app is read: a pale band for your usual, a line for today, a dot for now */
function Legend() {
  const t = { fontSize: 10.5, fill: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }
  return (
    <svg className="sg-legend" viewBox="0 0 320 96" role="img" aria-label="A pale band for your usual. The line of today dips under it and comes back.">
      <rect x={0} y={26} width={320} height={32} rx={3} fill="var(--ink)" fillOpacity={0.09} />
      <text x={314} y={19} textAnchor="end" {...t}>
        your usual
      </text>
      <path className="sg-legend-line" pathLength={1} d="M6 44C26 34 44 36 66 41S104 33 128 43s34 34 60 33 44-26 66-31 30-3 40-4" fill="none" stroke="var(--ember)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <g className="sg-legend-dot">
        <circle cx={294} cy={41} r={7} fill="var(--bg-1)" />
        <circle cx={294} cy={41} r={5} fill="var(--ember)" />
      </g>
      <text x={188} y={93} textAnchor="middle" {...t}>
        under your usual
      </text>
      <text x={294} y={74} textAnchor="middle" {...t}>
        now
      </text>
    </svg>
  )
}
const KEY: Array<{ tone: Tone; label: string }> = [
  { tone: 'voice', label: 'Voice' },
  { tone: 'face', label: 'Face' },
  { tone: 'heart', label: 'Heart' },
  { tone: 'move', label: 'Movement' },
]

export function Signals(_: { id?: string; topic?: string }) {
  const calls = DAY.filter((m) => m.icon === 'call').length
  const smiley = [...PEOPLE].sort((a, b) => b.smiles - a.smiles)[0]
  const beat = /(\d+) of (\d+) songs/.exec(DAY.find((m) => m.icon === 'music')?.sub ?? '')
  const still = DAY.find((m) => m.icon === 'move')?.sub.split(' · ')[0]
  return (
    <Screen>
      <Head chip={<PodsChip />} title="Signals" sub="What your AirPods pick up, set against your own usual." />

      <Section i={1}>
        <div className="group">
          <Row icon="airpods" tone="ember" title="Nods, head shakes and smiles, live" sub="This part is real. It runs on this phone." to="/live" />
        </div>
      </Section>

      <section className="section rise" style={rise(2)}>
        <div className="section-head sg-head">
          <h2 className="title-m">Today</h2>
          <Chip>Sample day</Chip>
        </div>
        <div className="pad">
          <div className="group">
            <Row icon="call" tone="voice" title="Calls" sub={`${calls} calls today. You smile most with ${smiley.name}.`} right={<Spark values={RING.talk.today} tone="voice" w={56} />} to="/signals/calls" />
            <Row
              icon="music"
              tone="face"
              title="Music"
              sub={`Your head moved with the beat on ${beat ? `${beat[1]} of ${beat[2]}` : `${SONGS.filter((s) => s.beat > 0.5).length} of ${SONGS.length}`} songs.`}
              right={<Spark values={SONGS.map((s) => s.beat)} tone="face" w={56} />}
              to="/signals/music"
            />
            <Row icon="sleep" tone="heart" title="Sleep" sub={`Resting heart rate ${NIGHT.rest} last night, ${NIGHT.rest - NIGHT.usual} above your usual.`} right={<Spark values={NIGHT.bpm} tone="heart" w={56} />} to="/signals/sleep" />
            <Row icon="move" tone="move" title="Movement" sub={`Head down and still for ${still ?? 'two hours'} after lunch.`} right={<Spark values={RING.move.today} tone="move" w={56} />} to="/signals/movement" />
          </div>
        </div>
      </section>

      <Section title="How to read it" i={3}>
        <div className="card">
          <Legend />
          <p className="body-2" style={{ marginTop: 14 }}>
            The pale band is your own usual. The line is today and the dot is now. Vire sets you against your own earlier days, never against other people.
          </p>
          <div className="sg-key">
            {KEY.map((k) => (
              <span key={k.tone}>
                <i style={{ background: `var(--${k.tone})` }} />
                {k.label}
              </span>
            ))}
          </div>
        </div>
      </Section>

      <SampleNote>Calls, music, sleep and movement are a sample day, to show where Vire is going. The live screen is real: your own model, taught and run on this phone.</SampleNote>
    </Screen>
  )
}

// ---------- calls ----------

export function Calls(_: { id?: string; topic?: string }) {
  const people = [...PEOPLE].sort((a, b) => b.smiles - a.smiles)
  const top = people[0]
  const low = people[people.length - 1]
  const maxSmiles = Math.max(...PEOPLE.map((p) => p.smiles))
  const maxNods = Math.max(...PEOPLE.map((p) => p.nods))
  return (
    <Screen nav="Calls" backTo="/signals">
      <Head chip={<Chip>Sample</Chip>} title="Calls" sub="Who you talk with, and how you are with them." />
      <Say i={1}>
        You smile about <b>{word(Math.round(top.smiles / low.smiles))} times as often</b> with {top.name} as with {low.name}.
      </Say>

      <Section title="Time on calls" i={2}>
        <div className="card">
          <BandBars values={week(CALL_WEEK.minutes)} labels={DAYS} lo={CALL_WEEK.lo} hi={CALL_WEEK.hi} tone="voice" fmt={(v) => `${v} min`} />
          <p className="small sg-cap">Minutes on calls a day, over the last seven days. The pale band is your usual. Tap a day.</p>
        </div>
      </Section>

      <Section title="Who you talk with" i={3}>
        <p className="small sg-lead">Smiles and nods for every ten minutes of call. Talking is your share of the call.</p>
        {people.map((p) => (
          <div className="card" key={p.name}>
            <div className="sg-who">
              <span className="sg-avatar">{p.name[0]}</span>
              <div>
                <div className="row-title">{p.name}</div>
                <div className="row-sub" style={{ marginTop: 0 }}>
                  {p.who}
                </div>
              </div>
              <div className="sg-who-meta num">
                <b>{p.minutes} min</b>
                {p.calls} {p.calls === 1 ? 'call' : 'calls'}
              </div>
            </div>
            <div className="sg-reads">
              <Read label="Smiles" value={p.smiles.toFixed(1)}>
                <Bar share={p.smiles / maxSmiles} tone="face" />
              </Read>
              <Read label="Nods" value={p.nods.toFixed(0)}>
                <Bar share={p.nods / maxNods} tone="move" />
              </Read>
              <Read label="You talk" value={`${Math.round(p.talk * 100)}%`}>
                <Bar share={p.talk} tone="voice" mid />
              </Read>
            </div>
            <p className="sg-person-note">{p.note}</p>
          </div>
        ))}
      </Section>

      <Section title="How Vire knows" i={4}>
        <div className="group">
          <Row icon="nod" tone="move" title="Nods and head shakes" sub="From the motion of your AirPods. This part runs today." to="/live" />
          <Row icon="face" tone="face" title="Smiles" sub="The camera keeps these for now. From the AirPods alone they are still a guess." />
          <Row icon="voice" tone="voice" title="Talking" sub="From the microphone. When you talk, never what you say." />
          <Row icon="call" tone="voice" title="Who it is" sub="From the phone's own call. Today Vire is only told that a call is on." />
        </div>
      </Section>

      <Research topic="calls" i={5} />
      <AlsoResearch topic="face" title="And on smiles and head movement" i={6} />
      <SampleNote>Sample, and not built. The by-person view does not exist: today Vire only knows that a call is on. These people and numbers are made up.</SampleNote>
    </Screen>
  )
}

// ---------- music ----------

const MOOD: Record<Song['mood'], { word: string; d: string }> = {
  lifts: { word: 'Lifts', d: 'M12 19V5.5M6.5 11L12 5.5 17.5 11' },
  calms: { word: 'Calms', d: 'M4 12c2.7-3.2 5.3-3.2 8 0s5.3 3.2 8 0' },
  sinks: { word: 'Sinks', d: 'M12 5v13.5M6.5 13L12 18.5 17.5 13' },
  flat: { word: 'Flat', d: 'M5 12h14' },
}

export function Music(_: { id?: string; topic?: string }) {
  const songs = [...SONGS].sort((a, b) => b.bpm - a.bpm)
  const slow = songs[songs.length - 1]
  const maxHr = Math.max(...SONGS.map((s) => Math.abs(s.hr)))
  return (
    <Screen nav="Music" backTo="/signals">
      <Head chip={<Chip>Sample</Chip>} title="Music" sub="What you play, and what it does to you." />
      <Say i={1}>
        Faster songs get your head moving. A slow one at {slow.at} left you <b>still, with your heart rate up.</b>
      </Say>

      <Section title="What you played" i={2}>
        <div className="group">
          {songs.map((s) => (
            <div className="sg-song" key={s.title}>
              <div className="sg-song-top">
                <div>
                  <div className="row-title">{s.title}</div>
                  <div className="row-sub num">
                    {s.by} · {s.bpm} bpm · {s.at}
                  </div>
                </div>
                <Chip>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={MOOD[s.mood].d} />
                  </svg>
                  {MOOD[s.mood].word}
                </Chip>
              </div>
              <div className="sg-reads" style={{ '--label': '88px' } as CSSProperties}>
                <Read label="With the beat" value={`${Math.round(s.beat * 100)}%`}>
                  <Bar share={s.beat} tone="face" />
                </Read>
                <Read label="Heart rate" value={signed(s.hr)}>
                  <Swing v={s.hr} max={maxHr} tone="heart" />
                </Read>
              </div>
            </div>
          ))}
        </div>
        <p className="small sg-cap">Fastest first. With the beat is the share of the song your head moved in time with it. Heart rate is the change over the song, in beats a minute.</p>
      </Section>

      <Section title="What Vire would do with it" i={3}>
        <div className="group">
          <Row icon="play" tone="ember" title="Queue what lifts you" sub="When you drift from your usual, the songs that got you moving come up first." />
          <Row icon="lock" title="Keep your taste to yourself" sub="The clinic would see whether music still moves you. Never what you play." />
        </div>
      </Section>

      <Research topic="music" i={4} />
      <SampleNote>Sample, and not built. Vire does not read what is playing yet, and AirPods give heart rate only during a workout session. The songs and artists are made up.</SampleNote>
    </Screen>
  )
}

// ---------- sleep ----------

const [H0, M0] = NIGHT.from.split(':').map(Number)
/** hours since falling asleep, as a clock time */
const clock = (t: number): string => {
  const m = (Math.round(H0 * 60 + M0 + t * 60) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function Sleep(_: { id?: string; topic?: string }) {
  const rest = week(NIGHT_WEEK.rest)
  const nights = week(NIGHT_WEEK.days)
  let over = 0
  while (over < rest.length && rest[rest.length - 1 - over] > NIGHT_WEEK.hi) over++
  const stirred = NIGHT.stir.reduce((a, b) => a + b, 0)
  const peak = NIGHT.stir.indexOf(Math.max(...NIGHT.stir))
  const rose = NIGHT.bpm[peak] > NIGHT.bpm[Math.max(0, peak - 1)]
  const down = PRACTICES.find((p) => p.id === 'winddown')
  return (
    <Screen nav="Sleep" backTo="/signals">
      <Head chip={<Chip>Sample</Chip>} title="Sleep" sub="The night, through your AirPods." />
      <Say i={1}>
        Last night your resting heart rate was {NIGHT.rest} beats a minute,{' '}
        <b>
          {NIGHT.rest - NIGHT.usual} above your usual {NIGHT.usual}.
        </b>
      </Say>

      <Section title="Last night" i={2}>
        <div className="card">
          <BandLine x={NIGHT.t} y={NIGHT.bpm} lo={NIGHT.lo} hi={NIGHT.hi} tone="heart" fmtX={clock} fmtY={(v) => `${v} beats a minute`} />
          <p className="small sg-cap">
            Heart rate from {NIGHT.from} until you woke at {NIGHT.to}, one reading every 20 minutes. The pale band is your usual night. Drag to read it.
          </p>
          <div className="sg-split" />
          <div className="sg-strip-head">
            <span className="title-m num">{stirred} min</span>
            <span className="small">head moving</span>
          </div>
          <Strip values={NIGHT.stir} tone="move" />
          <div className="sg-axis num">
            <span>{clock(NIGHT.t[0])}</span>
            <span>{clock(NIGHT.t[NIGHT.t.length - 1])}</span>
          </div>
          <p className="small sg-cap">
            Minutes your head moved, on the same clock. Most around {clock(NIGHT.t[peak])}
            {rose ? ', when your heart rate rose too' : ''}. AirPods can feel you turn over, not sleep stages.
          </p>
        </div>
      </Section>

      <Section title="The last seven nights" i={3}>
        <div className="card">
          <BandDots values={rest} labels={nights} heads={nights.map((d, i) => (i === nights.length - 1 ? 'Last night' : `Night to ${d}`))} lo={NIGHT_WEEK.lo} hi={NIGHT_WEEK.hi} tone="heart" fmt={(v) => `${v} beats a minute`} />
          <p className="small sg-cap">
            Resting heart rate, night by night.{over > 0 ? ` ${over === 1 ? 'Last night sits' : `The last ${word(over)} nights sit`} above your usual.` : ''} Tap a night.
          </p>
        </div>
      </Section>

      {down && (
        <Section title="For tonight" i={4}>
          <div className="group">
            <Row icon={down.icon} tone="ember" title={down.name} sub={`${down.minutes} min. ${down.line}`} to="/practice/winddown" />
          </div>
        </Section>
      )}

      <Research topic="sleep" i={5} />
      <AlsoResearch topic="heart" title="And on heart rate" i={6} />
      <SampleNote>Sample, and not built. Today AirPods Pro 3 give heart rate only during a workout session, in beats a minute. They cannot tell sleep stages, and many people do not sleep in AirPods.</SampleNote>
    </Screen>
  )
}

// ---------- movement ----------

export function Movement(_: { id?: string; topic?: string }) {
  const steps = STEPS_WEEK.steps
  const down = HEAD_DOWN_WEEK.hours
  const part = (steps[TUE] + steps[WED]) / (STEPS_WEEK.lo + STEPS_WEEK.hi)
  const back = steps[TODAY] > Math.max(steps[TUE], steps[WED]) && down[TODAY] < Math.min(down[TUE], down[WED])
  const walk = PRACTICES.find((p) => p.id === 'walk')
  return (
    <Screen nav="Movement" backTo="/signals">
      <Head chip={<Chip>Sample week</Chip>} title="Movement" sub="Your steps, and how long your head is down." />
      <Say i={1}>
        On Tuesday and Wednesday you took <b>{part < 0.4 ? 'about a third of' : part < 0.62 ? 'about half' : 'fewer than'} your usual steps</b>, and your head was down over {word(Math.floor(Math.min(down[TUE], down[WED])))} hours a day.{back ? ' Today is closer to your usual.' : ''}
      </Say>

      <Section title="Steps" i={2}>
        <div className="card">
          <BandBars values={week(steps)} labels={DAYS} lo={STEPS_WEEK.lo} hi={STEPS_WEEK.hi} tone="move" fmt={(v) => `${v.toLocaleString('en-GB')} steps`} />
          <p className="small sg-cap">Steps a day, over the last seven days. The pale band is your usual. Tap a day.</p>
        </div>
      </Section>

      <Section title="Head down" i={3}>
        <div className="card">
          {/* the kit prints "your usual" at the right end of the band, where today's bar stands in this chart */}
          <BandBars values={week(down)} labels={DAYS} lo={HEAD_DOWN_WEEK.lo} hi={HEAD_DOWN_WEEK.hi} tone="move" fmt={(v) => `${v.toFixed(1)} hours`} usual="" />
          <p className="small sg-cap">Hours a day with your head tipped down, the way it sits over a phone or a desk. The pale band is your usual.</p>
        </div>
      </Section>

      <Section title="What runs today" i={4}>
        <div className="group">
          <Row icon="airpods" tone="ember" title="Your AirPods feel this already" sub="Head movement, head down, walks and steps, while Vire is open." />
        </div>
      </Section>

      {walk && (
        <Section title="For a still day" i={5}>
          <div className="group">
            <Row icon={walk.icon} tone="ember" title={walk.name} sub={`${walk.minutes} min. ${walk.line}`} to="/practice/walk" />
          </div>
        </Section>
      )}

      <Research topic="movement" i={6} />
      <SampleNote>
        This week's numbers are a sample. The sensing is real and runs on{' '}
        <a href="https://vire.fly.dev/#/day" target="_blank" rel="noreferrer">
          the main Vire site
        </a>
        .
      </SampleNote>
    </Screen>
  )
}
