// The first screen: what Vire is, in the submission's words, then the ways in. The replay leads: a judge gets from the
// address to a run with sound in one tap. Nothing heavy here: no canvas, no images, one small fetch.
import { useEffect, useState } from 'react'
import { apiUrl } from '../shared/api'
import './home.css'

/** GET /api/ear/replay says whether the replay is a real run. Anything but `real: true` is the scripted one. */
function useRealReplay(): boolean | null {
  const [real, setReal] = useState<boolean | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    fetch(apiUrl('ear/replay'), { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: { real?: unknown } | null) => setReal(x?.real === true))
      .catch(() => setReal(false))
      .finally(() => clearTimeout(t))
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [])
  return real
}

const LOOP: { k: string; t: string }[] = [
  { k: 'Sense', t: 'While Vire is open, your AirPods feel head movement, head-down time, walks, nods and, on AirPods Pro 3, heart rate.' },
  { k: 'Practice', t: 'When that drifts from your usual, a short practice plays in your ears.' },
  { k: 'Learn', t: 'Vire measures what it did and learns which practice helps you.' },
  { k: 'Tell', t: 'Drift the practices don’t fix goes to the top of your clinic’s list.' },
]

export default function Home() {
  const real = useRealReplay()
  useEffect(() => {
    document.title = 'Vire'
  }, [])
  return (
    <main className="hm">
      <header className="hm-top">
        <span className="hm-mark">Vire</span>
      </header>

      <section className="hm-intro">
        <h1>Like Meru Health, but your AirPods sense every step.</h1>
        <p className="hm-lede">
          After TMS for depression, Vire spots drift from your usual, plays a practice in your ears, learns what helps you
          and tells your clinic.
        </p>
        <p className="hm-who">For people home after a TMS course, and the clinic that treated them.</p>

        <a className="hm-watch" href="#/watch" data-real={real === true ? '1' : '0'}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="hm-play">
            <path d="M8 5.5v13a.6.6 0 0 0 .9.5l10.4-6.5a.6.6 0 0 0 0-1L8.9 5a.6.6 0 0 0-.9.5Z" />
          </svg>
          <span>
            <b>{real === true ? 'Watch a real run' : 'Watch a run'}</b>
            <small>
              {real === true ? 'The founder’s own AirPods, 40 seconds' : real === false ? 'A scripted run for now, 40 seconds' : '40 seconds, sound on'}
            </small>
          </span>
        </a>
      </section>

      <nav className="hm-ways" aria-label="Ways in">
        <a href="#/today" className="hm-way">
          <b>Today</b>
          <span>AirPods in, five minutes</span>
          <Arrow />
        </a>
        <div className="hm-way hm-way-clinic">
          <a href="#/clinic" className="hm-way-main">
            <b>The clinic</b>
            <span>Who drifted, and what was tried</span>
            <Arrow />
          </a>
          <a href="#/clinic/live" className="hm-way-small">
            The big screen
          </a>
        </div>
        <a href="#/visit" className="hm-way">
          <b>No AirPods?</b>
          <span>One minute with the camera</span>
          <Arrow />
        </a>
      </nav>

      <section className="hm-loop" aria-label="How Vire works">
        <ol>
          {LOOP.map((x) => (
            <li key={x.k}>
              <b>{x.k}</b>
              <span>{x.t}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="hm-honest">
        <p>A signal for the clinic, not a diagnosis.</p>
        <p>No patient has used Vire yet. The clinic’s patients are simulated.</p>
      </footer>
    </main>
  )
}

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="hm-arrow">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
