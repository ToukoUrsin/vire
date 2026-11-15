// The practices tab: this week's practice as a cover, the library as covers, the week, and what has worked.
// And the twelve weeks as a path.
import type { CSSProperties } from 'react'
import { go } from '../router'
import { PRACTICES, PROGRAMME } from '../data/sample'
import { TOPICS } from '../data/refs'
import { I } from '../ui/icons'
import { Art, Btn, Chip, Row, SampleNote, Screen, Section, type ArtKind } from '../ui/kit'
import './practices.css'

const rise = (i: number) => ({ '--i': i }) as CSSProperties
const COVER: Record<string, ArtKind> = { breathing: 'breath', bodyscan: 'body', sit: 'sit', yoga: 'stretch', walk: 'walk', winddown: 'sleep' }
const two = (n: number) => String(n).padStart(2, '0')

/** best first: how often you were calmer after, out of the times you did it */
const WORKS = PRACTICES.filter((p) => p.done > 0)
  .map((p) => ({ id: p.id, name: p.name, done: p.done, calmer: p.calmer, hits: Math.round(p.calmer * p.done) }))
  .sort((a, b) => b.calmer - a.calmer || b.done - a.done)

/** how far through this week, as a ring with the week number in it */
function WeekRing({ size = 64 }: { size?: number }) {
  const done = PROGRAMME.lessons.filter((l) => l.done).length
  const p = done / PROGRAMME.lessons.length
  return (
    <span className="pr-ring" style={{ width: size, height: size }} role="img" aria-label={`Week ${PROGRAMME.week}, ${done} of ${PROGRAMME.lessons.length} done`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,240,220,0.12)" strokeWidth="5" />
        <circle className="pr-ring-fill" cx="32" cy="32" r="28" fill="none" stroke="var(--ember-hi)" strokeWidth="5" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} transform="rotate(-90 32 32)" />
      </svg>
      <b className="num">{PROGRAMME.week}</b>
    </span>
  )
}

function Lessons() {
  const next = PROGRAMME.lessons.findIndex((l) => !l.done)
  return (
    <ul className="pr-lessons">
      {PROGRAMME.lessons.map((l, i) => (
        <li key={l.title} className={`pr-lesson ${l.done ? 'is-done' : ''} ${i === next ? 'is-next' : ''}`}>
          <span className="pr-lesson-check">{l.done && <I.check size={14} strokeWidth={2.8} />}</span>
          <span className="pr-lesson-title">
            {l.title}
            {l.done && <span className="vh"> (done)</span>}
          </span>
          <span className="pr-lesson-meta num">
            {l.kind} · {l.minutes} min
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Practices(_: { id?: string; topic?: string }) {
  const done = PROGRAMME.lessons.filter((l) => l.done).length
  const lesson = PROGRAMME.lessons.find((l) => !l.done)
  const best = WORKS[0]
  const [first, ...rest] = PRACTICES
  return (
    <Screen glow="voice">
      <div className="pad rise" style={rise(0)}>
        <div className="pr-top">
          <Chip>Sample week</Chip>
          <Chip>
            Week {PROGRAMME.week} of {PROGRAMME.of}
          </Chip>
        </div>
        <h1 className="title-xl">Practices</h1>
      </div>

      <div className="pad rise" style={{ ...rise(1), marginTop: 18 }}>
        <Art kind={COVER[first.id]} h={248} tag={`This week · ${first.minutes} min`} title={first.name} sub="Six breaths a minute, in your ears" to={`/practice/${first.id}`} className="pr-feature">
          <span className="art-play" aria-hidden="true">
            <I.play size={20} />
          </span>
        </Art>
      </div>

      <Section title="All practices" i={2}>
        <div className="pr-grid">
          {rest.map((p, k) => (
            <Art key={p.id} kind={COVER[p.id]} h={k === rest.length - 1 && rest.length % 2 ? 132 : 156} tag={`${p.minutes} min`} title={p.name} to={`/practice/${p.id}`} className={`pr-tile ${k === rest.length - 1 && rest.length % 2 ? 'is-wide' : ''}`} />
          ))}
        </div>
      </Section>

      <Section title="Your week" more="Programme" to="/programme" i={3}>
        <button className="card pr-week" onClick={() => go('/programme')}>
          <WeekRing />
          <span className="pr-week-body">
            <span className="row-title">{PROGRAMME.theme}</span>
            <span className="row-sub num">
              {done} of {PROGRAMME.lessons.length} done · next {lesson?.minutes} min
            </span>
            <span className="pr-dots" aria-hidden="true">
              {PROGRAMME.weeks.map((w, i) => (
                <i key={w} className={i + 1 < PROGRAMME.week ? 'is-done' : i + 1 === PROGRAMME.week ? 'is-now' : ''} />
              ))}
            </span>
          </span>
          <I.right size={18} />
        </button>
      </Section>

      <Section title="What works for you" i={4}>
        <div className="card">
          <p className="pr-say voice">{best.name} helps you most so far.</p>
          <div className="pr-works">
            {WORKS.slice(0, 4).map((w, k) => (
              <div key={w.id} className={`pr-works-row ${k === 0 ? 'is-best' : ''}`}>
                <span className="pr-works-name">{w.name}</span>
                <span className="pr-works-bar" role="img" aria-label={`Calmer after ${w.hits} of ${w.done} times`}>
                  <i style={{ '--w': `${Math.round(w.calmer * 100)}%`, '--k': k } as CSSProperties} />
                </span>
                <span className="pr-works-count num">
                  {w.hits} of {w.done}
                </span>
              </div>
            ))}
          </div>
          <p className="small pr-works-foot">Times you were calmer after, out of the times you did it.</p>
        </div>
      </Section>

      <Section i={5}>
        <div className="group">
          <Row icon="paper" title="What the research says" sub={`${TOPICS.practices.count} studies on these practices`} to="/research/practices" />
        </div>
      </Section>

      <SampleNote>The week and the history are a sample. Breathing, the body scan and the walk run today on the main site.</SampleNote>
    </Screen>
  )
}

export function Programme(_: { id?: string; topic?: string }) {
  const done = PROGRAMME.lessons.filter((l) => l.done).length
  return (
    <Screen nav="Programme" backTo="/practices" glow="ember">
      <div className="pad rise" style={rise(0)}>
        <Chip>Sample programme</Chip>
        <h1 className="big-num pr-prog-head">
          {PROGRAMME.week}
          <small>of {PROGRAMME.of} weeks</small>
        </h1>
        <p className="lede" style={{ marginTop: 10 }}>
          A few minutes a day, for the months after TMS.
        </p>
        <div className="pr-dots is-tall" aria-hidden="true">
          {PROGRAMME.weeks.map((w, i) => (
            <i key={w} className={i + 1 < PROGRAMME.week ? 'is-done' : i + 1 === PROGRAMME.week ? 'is-now' : ''} />
          ))}
        </div>
      </div>

      <div className="pad pr-path">
        {PROGRAMME.weeks.map((name, i) => {
          const n = i + 1
          const state = n < PROGRAMME.week ? 'is-done' : n === PROGRAMME.week ? 'is-now' : 'is-later'
          if (state === 'is-now')
            return (
              <div key={name} className="pr-wk is-now rise" style={rise(Math.min(i + 1, 8))} aria-current="step">
                <div className="pr-wk-line">
                  <span className="pr-wk-n num">{two(n)}</span>
                  <span className="pr-wk-name">
                    {name}
                    <span className="pr-wk-sub num">
                      This week · {done} of {PROGRAMME.lessons.length} done
                    </span>
                  </span>
                  <WeekRing size={44} />
                </div>
                <Lessons />
                <div style={{ marginTop: 14 }}>
                  <Btn kind="ember" wide icon="play" to="/practice/breathing">
                    Practise now
                  </Btn>
                </div>
              </div>
            )
          return (
            <div key={name} className={`pr-wk ${state} rise`} style={rise(Math.min(i + 1, 8))}>
              <div className="pr-wk-line">
                <span className="pr-wk-n num">{two(n)}</span>
                <span className="pr-wk-name">{name}</span>
                {state === 'is-done' ? (
                  <span className="pr-wk-ok">
                    <I.check size={15} strokeWidth={2.8} />
                    <span className="vh">Done</span>
                  </span>
                ) : (
                  n === PROGRAMME.week + 1 && <span className="pr-wk-next">Next</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Section i={8}>
        <div className="group">
          <Row icon="paper" title="Where the shape comes from" sub={`A 12-week programme with a therapist · ${TOPICS.programme.count} studies`} to="/research/programme" />
        </div>
      </Section>

      <SampleNote>The programme is an outline. The lessons are not written yet.</SampleNote>
    </Screen>
  )
}
