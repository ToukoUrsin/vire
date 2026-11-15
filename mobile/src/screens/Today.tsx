import { useState, type CSSProperties } from 'react'
import { go } from '../router'
import { CALL_SIGNS, DAY, NOW_H, NURSE, CHAT, PRACTICES, PROGRAMME, RING, STEPS_WEEK, TODAY, type RingKey } from '../data/sample'
import { usePods, useModel } from '../live/pods'
import { DayRing } from '../ui/charts'
import { I, type IconName } from '../ui/icons'
import { Art, Badge, Chip, Row, SampleNote, Screen, Section, type Tone } from '../ui/kit'
import './today.css'

// the day drawn here is a sample, looked at from NOW_H, so the greeting is for that hour and not for the real clock
const hello = (h: number) => (h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')

const SAY: Record<RingKey, { head: string; sub: string }> = {
  move: { head: 'Back in your usual', sub: 'since the breathing at 15:40' },
  talk: { head: 'Talking again', sub: 'two quiet hours after lunch' },
  heart: { head: 'Settled again', sub: '79 before the breathing, 71 after' },
}
/** the three numbers under the ring. Steps are the day so far against your usual day and calls are your nods every ten minutes on them, the same number
 *  and the same verdict as on Signals; heart rate is now, against your usual for this hour. */
interface Sig {
  id: RingKey
  label: string
  icon: IconName
  tone: Tone
  unit?: string
  v: number
  lo: number
  hi: number
  /** the ends of the small scale */
  min: number
  max: number
  say: (n: number) => string
  usual: string
}
const HEART = RING.heart
const NOW = HEART.today.length - 1
const k1 = (n: number) => (n / 1000).toFixed(1)
const SIG: Sig[] = [
  { id: 'move', label: 'Steps', icon: 'walk', tone: 'move', v: STEPS_WEEK.steps[TODAY], lo: STEPS_WEEK.lo, hi: STEPS_WEEK.hi, min: Math.min(...STEPS_WEEK.steps), max: Math.max(...STEPS_WEEK.steps, STEPS_WEEK.hi), say: (n) => n.toLocaleString('en-GB'), usual: `usual ${k1(STEPS_WEEK.lo)}–${k1(STEPS_WEEK.hi)}k` },
  { id: 'talk', label: 'Calls', icon: 'call', tone: 'voice', unit: 'nods', v: CALL_SIGNS.nods[TODAY], lo: CALL_SIGNS.lo, hi: CALL_SIGNS.hi, min: Math.min(...CALL_SIGNS.nods), max: Math.max(...CALL_SIGNS.nods, CALL_SIGNS.hi), say: (n) => n.toFixed(0), usual: `usual ${CALL_SIGNS.lo}–${CALL_SIGNS.hi}` },
  { id: 'heart', label: 'Heart', icon: 'heart', tone: 'heart', unit: 'bpm', v: HEART.today[NOW], lo: HEART.lo[NOW], hi: HEART.hi[NOW], min: Math.min(...HEART.lo, ...HEART.today), max: Math.max(...HEART.hi, ...HEART.today), say: (n) => n.toFixed(0), usual: `usual ${HEART.lo[NOW].toFixed(0)}–${HEART.hi[NOW].toFixed(0)}` },
]
const rise = (i: number) => ({ '--i': i }) as CSSProperties

export function PodsChip() {
  const pods = usePods()
  return pods.on ? (
    <Chip tone="live" dot pulse>
      AirPods in
    </Chip>
  ) : (
    <Chip dot>AirPods out</Chip>
  )
}

/** one signal on a small scale where the pale stretch is your own usual */
function Signal({ label, icon, tone, unit, v, lo, hi, min, max, say, usual, on, pick }: Sig & { on: boolean; pick: () => void }) {
  const x = (n: number) => `${(((n - min) / (max - min)) * 100).toFixed(1)}%`
  const C = I[icon]
  return (
    <button className={`sig ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={pick} style={{ '--tone': `var(--${tone})` } as CSSProperties}>
      <span className="sig-top">
        <C size={16} />
        {label}
      </span>
      <span className="sig-v num">
        {say(v)}
        {unit && <small>{unit}</small>}
      </span>
      <span className="sig-bar" aria-hidden="true">
        <i style={{ left: x(lo), right: `calc(100% - ${x(hi)})` }} />
        <b style={{ left: x(v) }} />
      </span>
      <span className="sig-sub num">{usual}</span>
    </button>
  )
}

export function Today() {
  const [key, setKey] = useState<RingKey>('move')
  const model = useModel()
  const pods = usePods()
  const ok = model ? (['nod', 'shake', 'smile'] as const).filter((e) => model.events[e]?.score.ok) : []
  const fresh = CHAT.filter((m) => m.fresh)
  const next = PRACTICES[0]
  const lesson = PROGRAMME.lessons.find((l) => !l.done)
  return (
    <Screen glow="ember">
      <div className="pad rise" style={rise(0)}>
        <div className="today-top">
          <Chip>Sample day</Chip>
          <PodsChip />
        </div>
        <h1 className="title-xl voice">{hello(NOW_H)}</h1>
      </div>

      <div className="today-ring rise" style={rise(1)}>
        <DayRing s={RING[key]} nowH={NOW_H} mark={15.67}>
          <div>
            <div className="ring-head">{SAY[key].head}</div>
            <div className="ring-sub">{SAY[key].sub}</div>
          </div>
        </DayRing>
      </div>

      <div className="pad rise" style={rise(2)}>
        <div className="sigs">
          {SIG.map((s) => (
            <Signal key={s.id} {...s} on={key === s.id} pick={() => setKey(s.id)} />
          ))}
        </div>
      </div>

      <div className="pad rise" style={{ ...rise(3), marginTop: 12 }}>
        <button className="card insight" onClick={() => go('/loop')}>
          <p className="today-say">
            You went quiet and still after lunch. Three minutes of slow breathing, and <b>your afternoon came back.</b>
          </p>
          <span className="pills">
            <span className="pill num">
              <I.heart size={14} /> 79 to 71 bpm
            </span>
            <span className="pill num">
              <I.move size={14} /> 38% stiller
            </span>
          </span>
          <span className="insight-more">
            How Vire works <I.right size={16} />
          </span>
        </button>
      </div>

      <Section title="Your AirPods" i={4}>
        {model ? (
          <div className="group">
            <Row icon="airpods" tone="ember" title="Your own model is running" sub={ok.length ? `Reads your ${ok.map((e) => (e === 'shake' ? 'head shakes' : `${e}s`)).join(', ').replace(/, ([^,]*)$/, ' and $1')}` : 'Taught, still learning'} to="/live" />
            <Row icon="plus" title="Teach it another minute" sub="More minutes, better model" to="/train" />
          </div>
        ) : (
          <div className="group">
            <Row icon="airpods" tone="ember" title="Teach your AirPods" sub={pods.on || pods.app ? '65 seconds with the camera. They learn your nod and head shake.' : 'Needs the Vire iPhone app. Here the camera shows the same reading live.'} to="/train" />
          </div>
        )}
      </Section>

      <Section title="Next for you" more="All practices" to="/practices" i={5}>
        <Art kind="breath" h={188} tag={`${next.minutes} min`} title={next.name} sub="Six breaths a minute, in your ears" to={`/practice/${next.id}`}>
          <span className="art-play" aria-hidden="true">
            <I.play size={20} />
          </span>
        </Art>
      </Section>

      <Section title="Today so far" i={6}>
        <div className="rail">
          {DAY.map((m) => {
            const body = (
              <>
                <Badge icon={m.icon} tone={m.tone} />
                <span>
                  <span className="moment-title">{m.title}</span>
                  <span className="moment-sub num">{m.sub}</span>
                </span>
                <span className="moment-t num">{m.t}</span>
              </>
            )
            return m.to ? (
              <button key={m.t} className={`moment ${m.loop ? 'is-loop' : ''}`} onClick={() => go(m.to!)}>
                {body}
              </button>
            ) : (
              <div key={m.t} className={`moment ${m.loop ? 'is-loop' : ''}`}>
                {body}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title={`Week ${PROGRAMME.week} of ${PROGRAMME.of}`} more="Programme" to="/programme" i={7}>
        <button className="card" onClick={() => go('/programme')}>
          <div className="row-title">{PROGRAMME.theme}</div>
          <div className="row-sub">
            Next: {lesson?.title}, {lesson?.minutes} min
          </div>
          <div className="weekdots">
            {PROGRAMME.weeks.map((w, i) => (
              <i key={w} className={i + 1 < PROGRAMME.week ? 'is-done' : i + 1 === PROGRAMME.week ? 'is-now' : ''} />
            ))}
          </div>
        </button>
      </Section>

      <Section title="From your clinic" i={8}>
        <button className="card" onClick={() => go('/care')}>
          <div className="who">
            <span className="avatar">{NURSE.name[0]}</span>
            <div>
              <div className="row-title">{NURSE.name}</div>
              <div className="row-sub" style={{ marginTop: 0 }}>
                {NURSE.role}
              </div>
            </div>
            <span className="unread" aria-label={`${fresh.length} new`} />
          </div>
          <p className="quote">{fresh[0]?.text}</p>
        </button>
      </Section>

      <SampleNote>This day, the programme and the clinic are a sample of where Vire is going. Your AirPods model is real.</SampleNote>
    </Screen>
  )
}
