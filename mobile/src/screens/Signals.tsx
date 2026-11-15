// Signals: what the AirPods could pick up through a day, drawn with the sample person. Calls, music and sleep are
// not built; movement is felt today on the main site. Each screen says so at the top and again at the end.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { go } from '../router'
import { CALL_WEEK, DAY, DAYS, HEAD_DOWN_WEEK, NIGHT, NIGHT_WEEK, PEOPLE, PRACTICES, SONGS, STEPS_WEEK, TODAY, week, type Song } from '../data/sample'
import { BandBars, BandDots, BandLine, Strip } from '../ui/charts'
import { I, type IconName } from '../ui/icons'
import { Art, Btn, Chip, Delta, Head, Research, Row, SampleNote, Screen, Section, Stat, type ArtKind } from '../ui/kit'
import { usePods } from '../live/pods'
import './signals.css'

const rise = (i?: number): CSSProperties => ({ '--i': i ?? 0 }) as CSSProperties
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n: number) => WORD[n] ?? String(n)
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)
const thousands = (n: number) => n.toLocaleString('en-GB')

// The sample day is a Thursday (see data/sample): a week is the last seven days, and the last bar is today.
const TUE = 1
const WED = 2
const FULL: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }
const LAST = DAYS.length - 1
const when = (i: number) => (i === LAST ? 'today' : `on ${FULL[DAYS[i]]}`)

type Versus = { tone?: 'off' | 'ok'; text: string }
/** where a reading sits against your own usual */
const versus = (v: number, lo: number, hi: number): Versus => (v < lo ? { tone: 'off', text: 'Under your usual' } : v > hi ? { tone: 'off', text: 'Over your usual' } : { tone: 'ok', text: 'In your usual' })

/** the top of a detail screen: one number said large, how it sits against your usual, and the chart it comes from */
function Hero({ value, unit, versus: v, cap, children, i }: { value: ReactNode; unit: ReactNode; versus?: Versus; cap: ReactNode; children: ReactNode; i: number }) {
  return (
    <div className="sg-hero pad rise" style={rise(i)}>
      <div className="sg-hero-top">
        <span className="big-num">
          {value}
          <small>{unit}</small>
        </span>
        {v && <Delta tone={v.tone}>{v.text}</Delta>}
      </div>
      <p className="sg-hero-cap num">{cap}</p>
      <div className="sg-hero-chart">{children}</div>
    </div>
  )
}

/** the one sentence Vire says on a screen */
function Say({ children, i }: { children: ReactNode; i: number }) {
  return (
    <div className="pad rise" style={{ ...rise(i), marginTop: 22 }}>
      <div className="card">
        <p className="sg-say">{children}</p>
      </div>
    </div>
  )
}

/** a practice to do about it, on its own cover */
function Offer({ id, kind, title, i }: { id: string; kind: ArtKind; title: string; i: number }) {
  const p = PRACTICES.find((x) => x.id === id)
  if (!p) return null
  return (
    <Section title={title} i={i}>
      <Art kind={kind} h={176} tag={`${p.minutes} min`} title={p.name} sub={p.line} to={`/practice/${p.id}`}>
        <span className="art-play" aria-hidden="true">
          <I.play size={20} />
        </span>
      </Art>
    </Section>
  )
}

/** the way to a second set of studies, without printing them all here */
function More({ topic, children }: { topic: string; children: ReactNode }) {
  return (
    <div className="pad sg-more">
      <Btn kind="ghost" small to={`/research/${topic}`}>
        {children} <I.right size={16} />
      </Btn>
    </div>
  )
}

// ---------- the tab root ----------

/** how every chart in the app is read: a pale band for your usual, a line for today, a dot for now */
function Legend() {
  const t = { fontSize: 11, fontWeight: 500, fill: 'var(--ink-3)', fontFamily: 'var(--font-ui)' }
  const d = 'M6 44C26 34 44 36 66 41S104 33 128 43s34 34 60 33 44-26 66-31 30-3 40-4'
  return (
    <svg className="sg-legend" viewBox="0 0 320 98" role="img" aria-label="A pale band for your usual. The line of today dips under it and comes back.">
      <defs>
        <filter id="sg-legend-glow" x="-10%" y="-60%" width="120%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <rect x={0} y={24} width={320} height={34} rx={9} fill="var(--ink)" fillOpacity={0.08} />
      <text x={314} y={16} textAnchor="end" {...t}>
        your usual
      </text>
      <path className="sg-legend-line" pathLength={1} d={d} fill="none" stroke="var(--ember)" strokeOpacity={0} strokeWidth={8} strokeLinecap="round" filter="url(#sg-legend-glow)" />
      <path className="sg-legend-line" pathLength={1} d={d} fill="none" stroke="#0f5c4e" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <g className="sg-legend-dot">
        <circle cx={294} cy={41} r={8.5} fill="var(--bg-1)" />
        <circle cx={294} cy={41} r={6} fill="#e4572e" />
      </g>
      <text x={188} y={95} textAnchor="middle" {...t}>
        under your usual
      </text>
      <text x={294} y={76} textAnchor="middle" {...t}>
        now
      </text>
    </svg>
  )
}

/** one signal on the tab root: its cover, its number for today, and the way in */
function Cover({ kind, icon, label, to, value, unit, sub, i }: { kind: ArtKind; icon: IconName; label: string; to: string; value: ReactNode; unit: string; sub: string; i: number }) {
  const C = I[icon]
  return (
    <div className="rise" style={rise(i)}>
      <Art
        kind={kind}
        h={164}
        to={to}
        className="sg-cover"
        sub={sub}
        tag={
          <>
            <C size={14} /> {label}
          </>
        }
      >
        <span className="sg-cover-num num">
          {value}
          <small>{unit}</small>
        </span>
        <span className="sg-go" aria-hidden="true">
          <I.right size={18} />
        </span>
      </Art>
    </div>
  )
}

export function Signals(_: { id?: string; topic?: string }) {
  const calls = DAY.filter((m) => m.icon === 'call').length
  const mins = CALL_WEEK.minutes[TODAY]
  const beat = /(\d+) of (\d+) songs/.exec(DAY.find((m) => m.icon === 'music')?.sub ?? '')
  const steps = STEPS_WEEK.steps[TODAY]
  const pods = usePods()
  return (
    <Screen glow="move">
      <div className="pad rise" style={rise(0)}>
        <h1 className="title-xl">Signals</h1>
      </div>

      <div className="pad rise" style={{ ...rise(1), marginTop: 20 }}>
        <button className="sg-live" onClick={() => go('/live')}>
          <span className="sg-live-top">
            <Chip tone="live" dot pulse>
              {pods.on ? 'Real, from your AirPods' : 'Real, with this camera'}
            </Chip>
            <span className="sg-go" aria-hidden="true">
              <I.right size={18} />
            </span>
          </span>
          <span className="sg-live-title">Nods, head shakes and smiles, live</span>
          <span className="pills">
            <span className="pill">
              <I.nod size={15} /> Nod
            </span>
            <span className="pill">
              <I.shake size={15} /> Shake
            </span>
            <span className="pill">
              <I.smile size={15} /> Smile
            </span>
          </span>
        </button>
      </div>

      <section className="section">
        <div className="section-head rise" style={rise(2)}>
          <h2 className="title-m">Today</h2>
          <Chip>Sample day</Chip>
        </div>
        <div className="pad sg-covers">
          <Cover kind="call" icon="call" label="Calls" to="/signals/calls" value={mins} unit="min" sub={`${calls} calls. ${versus(mins, CALL_WEEK.lo, CALL_WEEK.hi).text}.`} i={2} />
          <Cover kind="music" icon="music" label="Music" to="/signals/music" value={beat ? beat[1] : SONGS.filter((s) => s.beat > 0.5).length} unit={`of ${beat ? beat[2] : SONGS.length} songs`} sub="Your head moved with the beat." i={3} />
          <Cover kind="sleep" icon="sleep" label="Sleep" to="/signals/sleep" value={NIGHT.rest} unit="bpm" sub={`Resting heart rate. ${NIGHT.rest - NIGHT.usual} above your usual.`} i={4} />
          <Cover kind="walk" icon="move" label="Movement" to="/signals/movement" value={thousands(steps)} unit="steps" sub={`${versus(steps, STEPS_WEEK.lo, STEPS_WEEK.hi).text}.`} i={5} />
        </div>
      </section>

      <Section title="How to read it" i={6}>
        <div className="card">
          <Legend />
          <p className="body-2" style={{ marginTop: 12 }}>
            You against your own earlier days. Never against other people.
          </p>
        </div>
      </Section>

      <SampleNote>Calls, music, sleep and movement show a sample day. The live screen is real.</SampleNote>
    </Screen>
  )
}

// ---------- calls ----------

const FACE = ['linear-gradient(140deg, #d5efe9, #b5e0d7)', 'linear-gradient(140deg, #fbe9c4, #f4d391)', 'linear-gradient(140deg, #e3e6fb, #c5caf3)', 'linear-gradient(140deg, #fbdfe5, #f3bfca)']

export function Calls(_: { id?: string; topic?: string }) {
  const mins = week(CALL_WEEK.minutes)
  const [sel, setSel] = useState(LAST)
  // nods, because that is what the AirPods read on their own; smiles still need the camera
  const people = [...PEOPLE].sort((a, b) => b.nods - a.nods)
  const top = people[0]
  const low = people[people.length - 1]
  const quiet = [...PEOPLE].sort((a, b) => a.talk - b.talk)[0]
  return (
    <Screen nav="Calls" backTo="/signals" glow="voice">
      <Head chip={<Chip>Sample week</Chip>} title="Calls" />
      <Hero i={1} value={mins[sel]} unit="min" versus={versus(mins[sel], CALL_WEEK.lo, CALL_WEEK.hi)} cap={`On calls ${when(sel)}`}>
        <BandBars bare sel={sel} onSel={setSel} values={mins} labels={DAYS} lo={CALL_WEEK.lo} hi={CALL_WEEK.hi} tone="voice" fmt={(v) => `${v} min`} height={190} />
      </Hero>

      <Say i={2}>
        You nod about <b>{word(Math.round(top.nods / low.nods))} times as often</b> with {top.name} as with {low.name}.
      </Say>

      <div className="pad rise" style={{ ...rise(3), marginTop: 12 }}>
        <div className="stat-grid">
          <Stat icon="call" tone="voice" label="This week" value={sum(CALL_WEEK.minutes)} unit="min" sub={`${sum(PEOPLE.map((p) => p.calls))} calls`} />
          <Stat icon="clock" label="Your usual" value={`${CALL_WEEK.lo}–${CALL_WEEK.hi}`} unit="min" sub="a day" />
          <Stat icon="nod" tone="face" label="Most nods" value={top.name} sub={`${top.nods} every ten minutes`} />
          <Stat icon="voice" tone="voice" label="Quietest with" value={quiet.name} sub={`You talk ${Math.round(quiet.talk * 100)}% of the call`} />
        </div>
      </div>

      <Section title="Who you talk with" i={4}>
        <div className="group sg-people">
          {people.map((p, k) => (
            <div className="sg-person" key={p.name}>
              <div className="sg-person-top">
                <span className="sg-avatar" style={{ background: FACE[k % FACE.length] }}>
                  {p.name[0]}
                </span>
                <div>
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">{p.note}</div>
                </div>
                <div className="sg-person-min num">
                  {p.minutes}
                  <small>min</small>
                </div>
              </div>
              <div className="pills">
                <span className="pill num">
                  <I.nod size={15} /> {p.nods.toFixed(0)}
                </span>
                <span className="pill num">
                  <I.voice size={15} /> {Math.round(p.talk * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="small sg-cap">Nods every ten minutes, and your share of the talking.</p>
      </Section>

      <Section i={5}>
        <div className="group">
          <Row icon="nod" tone="ember" title="Nods run today" sub="Smiles still need the camera." to="/live" />
          <Row icon="lock" title="Never what you say" sub="Vire hears when you talk, not the words." />
        </div>
      </Section>

      <Research topic="calls" i={6} />
      <More topic="face">Studies on smiles and head movement</More>
      <SampleNote>Sample, and not built. Today Vire only knows that a call is on. These people and numbers are made up.</SampleNote>
    </Screen>
  )
}

// ---------- music ----------

const MOOD: Record<Song['mood'], { word: string; d: string; tone?: 'off' | 'ok'; art: string }> = {
  lifts: { word: 'Lifts', d: 'M12 19V5.5M6.5 11L12 5.5 17.5 11', tone: 'ok', art: 'linear-gradient(140deg, #fbe9c4, #f2cc82)' },
  calms: { word: 'Calms', d: 'M4 12c2.7-3.2 5.3-3.2 8 0s5.3 3.2 8 0', art: 'linear-gradient(140deg, #d5efe9, #a6d9ce)' },
  sinks: { word: 'Still', d: 'M5 12h14', art: 'linear-gradient(140deg, #e3e6fb, #bcc2f1)' },
  flat: { word: 'Flat', d: 'M5 12h14', art: 'linear-gradient(140deg, #f0ebe0, #dcd4c4)' },
}
function Mood({ mood }: { mood: Song['mood'] }) {
  return (
    <Delta tone={MOOD[mood].tone}>
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={MOOD[mood].d} />
      </svg>
      {MOOD[mood].word}
    </Delta>
  )
}

export function Music(_: { id?: string; topic?: string }) {
  const songs = [...SONGS].sort((a, b) => a.at.localeCompare(b.at))
  const [sel, setSel] = useState(() => songs.indexOf([...songs].sort((a, b) => b.beat - a.beat)[0]))
  const s = songs[sel]
  const slow = [...SONGS].sort((a, b) => a.bpm - b.bpm)[0]
  const up = [...SONGS].sort((a, b) => b.hr - a.hr)[0]
  const down = [...SONGS].sort((a, b) => a.hr - b.hr)[0]
  const day = DAY.find((m) => m.icon === 'music')?.sub ?? ''
  const beat = /(\d+) of (\d+) songs/.exec(day)
  const long = /^(.*) min$/.exec(day.split(' · ')[0])
  return (
    <Screen nav="Music" backTo="/signals" glow="face">
      <Head chip={<Chip>Sample day</Chip>} title="Music" />
      <Hero
        i={1}
        value={Math.round(s.beat * 100)}
        unit="% of this song"
        versus={{ tone: MOOD[s.mood].tone, text: MOOD[s.mood].word }}
        cap={
          <>
            How much of <b>{s.title}</b> by {s.by}, {s.bpm} bpm, your head moved with the beat.
          </>
        }
      >
        <BandBars bare sel={sel} onSel={setSel} values={songs.map((x) => Math.round(x.beat * 100))} labels={songs.map((x) => x.at)} tone="face" fmt={(v) => `${v}%`} height={190} />
      </Hero>

      <Say i={2}>
        Faster songs get your head moving. A slow one at {slow.at} left you <b>still, with your heart rate up.</b>
      </Say>

      <div className="pad rise" style={{ ...rise(3), marginTop: 12 }}>
        <div className="stat-grid">
          <Stat icon="music" tone="face" label="Songs that moved you" value={beat ? beat[1] : '0'} unit={`of ${beat ? beat[2] : SONGS.length}`} sub="With the beat for over half the song" />
          <Stat icon="clock" label="Listening" value={long ? long[1] : day.split(' · ')[0]} unit={long ? 'min' : undefined} />
          <Stat icon="heart" tone="heart" label="Heart up most" value={signed(up.hr)} unit="bpm" sub={up.title} />
          <Stat icon="heart" tone="heart" label="Heart down most" value={signed(down.hr)} unit="bpm" sub={down.title} />
        </div>
      </div>

      <Section title="A few from today" i={4}>
        <div className="group">
          {songs.map((x, k) => (
            <button className={`sg-song ${k === sel ? 'is-on' : ''}`} key={x.title} onClick={() => setSel(k)} aria-pressed={k === sel}>
              <span className="sg-thumb" style={{ background: MOOD[x.mood].art }}>
                <I.music size={20} />
              </span>
              <span>
                <span className="row-title" style={{ display: 'block' }}>
                  {x.title}
                </span>
                <span className="row-sub num" style={{ display: 'block' }}>
                  {x.by} · {x.bpm} bpm
                </span>
              </span>
              <Mood mood={x.mood} />
            </button>
          ))}
        </div>
      </Section>

      <Section i={5}>
        <div className="group">
          <Row icon="lock" title="Your taste stays yours" sub="The clinic would see whether music still moves you. Never what you play." />
        </div>
      </Section>

      <Research topic="music" i={6} />
      <SampleNote>Sample, and not built. Vire cannot read what is playing yet. The songs and artists are made up.</SampleNote>
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
  const [pick, setPick] = useState<number | null>(null)
  const rest = week(NIGHT_WEEK.rest)
  const nights = week(NIGHT_WEEK.days)
  let over = 0
  while (over < rest.length && rest[rest.length - 1 - over] > NIGHT_WEEK.hi) over++
  const peak = NIGHT.stir.indexOf(Math.max(...NIGHT.stir))
  const rose = NIGHT.bpm[peak] > NIGHT.bpm[Math.max(0, peak - 1)]
  const lowest = Math.min(...NIGHT.bpm)
  const [h1, m1] = NIGHT.to.split(':').map(Number)
  const span = (h1 * 60 + m1 - (H0 * 60 + M0) + 1440) % 1440
  return (
    <Screen nav="Sleep" backTo="/signals" glow="heart">
      <Head chip={<Chip>Sample night</Chip>} title="Sleep" />
      <Hero
        i={1}
        value={pick == null ? NIGHT.rest : NIGHT.bpm[pick]}
        unit="bpm"
        versus={pick == null ? { tone: 'off', text: `${NIGHT.rest - NIGHT.usual} above your usual` } : versus(NIGHT.bpm[pick], NIGHT.lo[pick], NIGHT.hi[pick])}
        cap={pick == null ? 'Resting heart rate, last night' : `Heart rate at ${clock(NIGHT.t[pick])}`}
      >
        <BandLine bare onPick={setPick} x={NIGHT.t} y={NIGHT.bpm} lo={NIGHT.lo} hi={NIGHT.hi} tone="heart" fmtX={clock} fmtY={(v) => `${v} bpm`} height={216} usual="your usual night" />
      </Hero>

      <div className="pad rise" style={{ ...rise(2), marginTop: 22 }}>
        <div className="stat-grid">
          <Stat icon="sleep" tone="move" label="Night" value={span % 60 ? `${Math.floor(span / 60)} h ${span % 60}` : Math.floor(span / 60)} unit={span % 60 ? 'min' : 'hours'} sub={`${NIGHT.from} to ${NIGHT.to}`} />
          <Stat icon="heart" tone="heart" label="Lowest" value={lowest} unit="bpm" sub={`at ${clock(NIGHT.t[NIGHT.bpm.indexOf(lowest)])}`} />
          <Stat wide icon="move" tone="move" label="Head moving" value={sum(NIGHT.stir)} unit="min" sub={`Most around ${clock(NIGHT.t[peak])}${rose ? ', when your heart rate rose too' : ''}`}>
            <Strip values={NIGHT.stir} tone="move" height={48} flush />
            <span className="sg-axis num">
              <span>{clock(NIGHT.t[0])}</span>
              <span>{clock(NIGHT.t[NIGHT.t.length - 1])}</span>
            </span>
          </Stat>
        </div>
      </div>

      <Section title="Seven nights" i={3}>
        <div className="card">
          <BandDots values={rest} labels={DAYS} heads={nights.map((d, i) => (i === nights.length - 1 ? 'Last night' : `Night to ${FULL[d]}`))} lo={NIGHT_WEEK.lo} hi={NIGHT_WEEK.hi} tone="heart" fmt={(v) => `${v} bpm resting`} />
        </div>
      </Section>

      {over > 0 && (
        <Say i={4}>
          Your resting heart rate has sat <b>above your usual for {over === 1 ? 'one night' : `${word(over)} nights`}.</b>
        </Say>
      )}

      <Offer id="winddown" kind="sleep" title="For tonight" i={5} />

      <Research topic="sleep" i={6} />
      <More topic="heart">Studies on heart rate</More>
      <SampleNote>Sample, and not built. Today AirPods give heart rate only during a workout, and never sleep stages.</SampleNote>
    </Screen>
  )
}

// ---------- movement ----------

export function Movement(_: { id?: string; topic?: string }) {
  const steps = STEPS_WEEK.steps
  const down = HEAD_DOWN_WEEK.hours
  const days = week(steps)
  const [sel, setSel] = useState(LAST)
  const part = (steps[TUE] + steps[WED]) / (STEPS_WEEK.lo + STEPS_WEEK.hi)
  const back = steps[TODAY] > Math.max(steps[TUE], steps[WED]) && down[TODAY] < Math.min(down[TUE], down[WED])
  const inUsual = steps[TODAY] >= STEPS_WEEK.lo && steps[TODAY] <= STEPS_WEEK.hi
  const walk = (DAY.find((m) => m.icon === 'walk')?.sub ?? '').split(' · ')
  const still = /^(.*) min$/.exec((DAY.find((m) => m.icon === 'move')?.sub ?? '').split(' · ')[0])
  return (
    <Screen nav="Movement" backTo="/signals" glow="move">
      <Head chip={<Chip>Sample week</Chip>} title="Movement" />
      <Hero i={1} value={thousands(days[sel])} unit="steps" versus={versus(days[sel], STEPS_WEEK.lo, STEPS_WEEK.hi)} cap={`Steps ${when(sel)}`}>
        <BandBars bare sel={sel} onSel={setSel} values={days} labels={DAYS} lo={STEPS_WEEK.lo} hi={STEPS_WEEK.hi} tone="move" fmt={(v) => `${thousands(v)} steps`} height={190} />
      </Hero>

      <Say i={2}>
        On Tuesday and Wednesday you took <b>{part < 0.4 ? 'about a third of' : part < 0.62 ? 'about half' : 'fewer than'} your usual steps.</b>
        {inUsual ? ' Today you are back in your usual.' : back ? ' Today is closer.' : ''}
      </Say>

      <div className="pad rise" style={{ ...rise(3), marginTop: 12 }}>
        <div className="stat-grid">
          <Stat icon="walk" tone="move" label="Walk today" value={walk[0]?.replace(/ min$/, '')} unit="min" sub={walk[1]} />
          <Stat icon="move" tone="move" label="Still after lunch" value={still ? still[1] : '0'} unit="min" sub="Head down, no talking" />
        </div>
      </div>

      <Section title="Head down" i={4}>
        <div className="card">
          <BandBars values={week(down)} labels={DAYS} lo={HEAD_DOWN_WEEK.lo} hi={HEAD_DOWN_WEEK.hi} tone="move" fmt={(v) => `${v.toFixed(1)} hours`} height={160} />
        </div>
        <p className="small sg-cap">Hours a day with your head tipped down, as over a phone or a desk.</p>
      </Section>

      <Section i={5}>
        <div className="group">
          <Row icon="airpods" tone="ember" title="Your AirPods feel this already" sub="Head movement, walks and steps, all the time they are in." />
        </div>
      </Section>

      <Offer id="walk" kind="walk" title="For a still day" i={6} />

      <Research topic="movement" i={7} />
      <SampleNote>
        This week is a sample. The sensing is real and runs on{' '}
        <a href="https://vire.fly.dev/#/day" target="_blank" rel="noreferrer">
          the main Vire site
        </a>
        .
      </SampleNote>
    </Screen>
  )
}
