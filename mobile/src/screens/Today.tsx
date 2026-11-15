import { useState } from 'react'
import { go } from '../router'
import { DAY, NOW_H, NURSE, CHAT, PROGRAMME, RING, type RingKey } from '../data/sample'
import { usePods, useModel } from '../live/pods'
import { DayRing } from '../ui/charts'
import { I } from '../ui/icons'
import { Badge, Btn, Chip, Row, SampleNote, Screen, Section, Seg } from '../ui/kit'
import './today.css'

const hello = () => {
  // the greeting follows the real clock; the day drawn under it is a sample and says so right above it
  const h = new Date().getHours()
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const SAY: Record<RingKey, { head: string; sub: string }> = {
  move: { head: 'Back in your usual', sub: 'since the breathing at 15:40' },
  talk: { head: 'Talking again', sub: 'two quiet hours after lunch' },
  heart: { head: 'Settled again', sub: '79 before the breathing, 71 after' },
}
const LOOP: Array<{ icon: 'airpods' | 'spark' | 'breath' | 'heart' | 'you'; label: string }> = [
  { icon: 'airpods', label: 'Sense' },
  { icon: 'spark', label: 'Notice' },
  { icon: 'breath', label: 'Practice' },
  { icon: 'heart', label: 'Measure' },
  { icon: 'you', label: 'Learn' },
]

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

export function Today() {
  const [key, setKey] = useState<RingKey>('move')
  const model = useModel()
  const ok = model ? (['nod', 'shake', 'smile'] as const).filter((e) => model.events[e]?.score.ok) : []
  const fresh = CHAT.filter((m) => m.fresh)
  return (
    <Screen>
      <div className="pad rise" style={{ '--i': 0 } as React.CSSProperties}>
        <div className="today-top">
          <Chip>Sample day</Chip>
          <PodsChip />
        </div>
        <h1 className="title-xl">{hello()}</h1>
      </div>

      <div className="today-ring rise" style={{ '--i': 1 } as React.CSSProperties}>
        <DayRing s={RING[key]} nowH={NOW_H} mark={15.67}>
          <div>
            <div className="title-m">{SAY[key].head}</div>
            <div className="small" style={{ marginTop: 6 }}>
              {SAY[key].sub}
            </div>
          </div>
        </DayRing>
      </div>
      <div className="pad rise" style={{ '--i': 2, marginTop: 20 } as React.CSSProperties}>
        <Seg
          value={key}
          onChange={setKey}
          options={[
            { id: 'move', label: 'Movement' },
            { id: 'talk', label: 'Talking' },
            { id: 'heart', label: 'Heart' },
          ]}
        />
        <p className="today-say">
          You went quiet and still after lunch. Vire offered three minutes of breathing, and <b>your afternoon came back.</b>
        </p>
        <p className="small" style={{ marginTop: 10 }}>
          The pale band is your own usual for each hour. The line is today. Drag round the ring to read it.
        </p>
      </div>

      <Section title="Your AirPods" i={3}>
        {model ? (
          <div className="group">
            <Row icon="airpods" tone="ember" title="Your own model is running" sub={ok.length ? `Reads your ${ok.map((e) => (e === 'shake' ? 'head shakes' : `${e}s`)).join(', ').replace(/, ([^,]*)$/, ' and $1')} from the AirPods alone` : 'Taught, still learning'} to="/live" />
            <Row icon="plus" title="Teach it another minute" sub="More minutes, better model" to="/train" />
          </div>
        ) : (
          <button className="card" onClick={() => go('/train')}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Badge icon="airpods" tone="ember" size={46} />
              <div style={{ flex: 1 }}>
                <div className="row-title">Teach your AirPods</div>
                <div className="row-sub">65 seconds. They learn your nod, your head shake and your smile.</div>
              </div>
              <I.right size={18} style={{ color: 'var(--ink-3)' }} />
            </div>
          </button>
        )}
      </Section>

      <Section title="How it works" more="The whole loop" to="/loop" i={4}>
        <button className="card" onClick={() => go('/loop')}>
          <p className="body-2">Vire senses your day, notices when you drift from your own usual, plays a practice in your ears, measures what it did and learns what works for you.</p>
          <div className="loop-steps">
            {LOOP.map((s, i) => (
              <div key={s.label} className={`loop-step ${i === 2 ? 'is-now' : ''}`}>
                <Badge icon={s.icon} />
                {s.label}
              </div>
            ))}
          </div>
        </button>
      </Section>

      <Section title="Today so far" i={5}>
        <div className="rail">
          {DAY.map((m) => {
            const body = (
              <>
                <span className="moment-t num">{m.t}</span>
                <Badge icon={m.icon} tone={m.tone} />
                <span>
                  <span className="moment-title" style={{ display: 'block' }}>
                    {m.title}
                  </span>
                  <span className="moment-sub num" style={{ display: 'block' }}>
                    {m.sub}
                  </span>
                </span>
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

      <Section title={`Week ${PROGRAMME.week} of ${PROGRAMME.of}`} more="Programme" to="/programme" i={6}>
        <button className="card" onClick={() => go('/programme')}>
          <div className="row-title">{PROGRAMME.theme}</div>
          <div className="row-sub">
            {PROGRAMME.lessons.filter((l) => l.done).length} of {PROGRAMME.lessons.length} done this week. Next: {PROGRAMME.lessons.find((l) => !l.done)?.title}, {PROGRAMME.lessons.find((l) => !l.done)?.minutes} min.
          </div>
          <div className="weekdots">
            {PROGRAMME.weeks.map((w, i) => (
              <i key={w} className={i + 1 < PROGRAMME.week ? 'is-done' : i + 1 === PROGRAMME.week ? 'is-now' : ''} />
            ))}
          </div>
        </button>
      </Section>

      <Section title="From your clinic" i={7}>
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
        <div style={{ marginTop: 12 }}>
          <Btn kind="quiet" wide to="/care/checkin">
            Weekly check-in, 2 min
          </Btn>
        </div>
      </Section>

      <SampleNote>The day, the programme and the clinic on this screen are a sample, to show where Vire is going. Your AirPods model is real: it is taught and run on this phone.</SampleNote>
    </Screen>
  )
}
