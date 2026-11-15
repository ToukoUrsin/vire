// The practices tab: this week, the library, and what has worked for you. And the twelve weeks.
import type { CSSProperties } from 'react'
import { go } from '../router'
import { PRACTICES, PROGRAMME } from '../data/sample'
import { I } from '../ui/icons'
import { Chip, Head, Research, Row, SampleNote, Screen, Section } from '../ui/kit'
import './practices.css'

function Lessons() {
  const next = PROGRAMME.lessons.findIndex((l) => !l.done)
  return (
    <ul className="pt-lessons">
      {PROGRAMME.lessons.map((l, i) => (
        <li key={l.title} className={`pt-lesson ${l.done ? 'is-done' : ''} ${i === next ? 'is-next' : ''}`}>
          <span className="pt-lesson-check">
            <I.check size={14} strokeWidth={2.6} />
          </span>
          <span className="pt-lesson-title">
            {l.title}
            {l.done && <span className="vh"> (done)</span>}
          </span>
          <span className="pt-lesson-meta num">
            {l.kind} · {l.minutes} min
          </span>
        </li>
      ))}
    </ul>
  )
}

/** best first: how often you were calmer after, out of the times you did it */
const WORKS = PRACTICES.filter((p) => p.done > 0)
  .map((p) => ({ id: p.id, name: p.name, done: p.done, calmer: p.calmer, hits: Math.round(p.calmer * p.done) }))
  .sort((a, b) => b.calmer - a.calmer || b.done - a.done)

export function Practices(_: { id?: string; topic?: string }) {
  const done = PROGRAMME.lessons.filter((l) => l.done).length
  const best = WORKS[0]
  return (
    <Screen>
      <Head chip={<Chip>Sample week</Chip>} title="Practices" sub="A few minutes, in your ears. Vire checks what each one did." />

      <Section title={`Week ${PROGRAMME.week} of ${PROGRAMME.of}`} more="Programme" to="/programme" i={1}>
        <button className="card" onClick={() => go('/programme')}>
          <div className="pt-wk-head">
            <div>
              <div className="row-title">{PROGRAMME.theme}</div>
              <div className="row-sub">
                {done} of {PROGRAMME.lessons.length} done this week
              </div>
            </div>
            <I.right size={18} />
          </div>
          <div className="pt-wk-dots" aria-hidden="true">
            {PROGRAMME.weeks.map((w, i) => (
              <i key={w} className={i + 1 < PROGRAMME.week ? 'is-done' : i + 1 === PROGRAMME.week ? 'is-now' : ''} />
            ))}
          </div>
          <Lessons />
        </button>
      </Section>

      <Section title="Library" i={2}>
        <div className="group">
          {PRACTICES.map((p) => (
            <Row key={p.id} icon={p.icon} title={p.name} sub={p.line} right={<Chip>{p.minutes} min</Chip>} chevron={false} to={`/practice/${p.id}`} />
          ))}
        </div>
      </Section>

      <Section title="What works for you" i={3}>
        <div className="card">
          <p className="pt-works-say">For you, {best.name.toLowerCase()} helps most so far.</p>
          <div className="pt-works">
            {WORKS.map((w, k) => (
              <div key={w.id} className={`pt-works-row ${k === 0 ? 'is-best' : ''}`}>
                <div className="pt-works-top">
                  <span className="pt-works-name">{w.name}</span>
                  <span className="pt-works-count num">
                    {w.hits} of {w.done}
                  </span>
                </div>
                <div className="pt-works-bar" role="img" aria-label={`Calmer after ${w.hits} of ${w.done} times`}>
                  <i style={{ '--w': `${Math.round(w.calmer * 100)}%`, '--k': k } as CSSProperties} />
                </div>
              </div>
            ))}
          </div>
          <p className="small pt-works-foot">How often you were calmer after: your head sat stiller in the check after than in the one before.</p>
        </div>
        <p className="small" style={{ marginTop: 12 }}>
          The real Vire says this only after enough scored practices: at least 3 of the best one and 2 each of two kinds. Never on a hunch.
        </p>
      </Section>

      <Research topic="practices" i={4} />

      <SampleNote>The week and the history here are a sample. The breathing, the body scan and the walk run today on the main site.</SampleNote>
    </Screen>
  )
}

export function Programme(_: { id?: string; topic?: string }) {
  const done = PROGRAMME.lessons.filter((l) => l.done).length
  return (
    <Screen nav="Programme" backTo="/practices">
      <Head title="Programme" sub="Twelve weeks for the months after TMS. A few minutes a day." />

      <Section i={1}>
        <div className="pt-weeks">
          {PROGRAMME.weeks.map((name, i) => {
            const n = i + 1
            const state = n < PROGRAMME.week ? 'is-done' : n === PROGRAMME.week ? 'is-now' : 'is-later'
            return (
              <div key={name} className={`pt-week ${state}`} aria-current={state === 'is-now' ? 'step' : undefined}>
                <span className="badge num">{state === 'is-done' ? <I.check size={18} /> : n}</span>
                <div className="pt-week-body">
                  <div className="pt-week-line">
                    <span className="pt-week-name">{name}</span>
                    <span className="pt-week-side num">{state === 'is-done' ? `Week ${n}` : ''}</span>
                  </div>
                  {state === 'is-now' && (
                    <>
                      <div className="row-sub num">
                        Week {n}, this week. {done} of {PROGRAMME.lessons.length} done.
                      </div>
                      <div className="card pt-week-open">
                        <Lessons />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <p className="small" style={{ marginTop: 18 }}>
          The shape is borrowed from Meru Health’s 12-week programme.
        </p>
      </Section>

      <Research topic="meru" i={2} />

      <SampleNote>The programme is an outline. The lessons are not written yet.</SampleNote>
    </Screen>
  )
}
