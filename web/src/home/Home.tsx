// The first screen: what Vire is, in the submission's words, then the ways in. The replay leads: a judge gets from the
// address to a run with sound in one tap, and to a real recorded check in one more. Nothing heavy here: no canvas,
// no images, one small fetch.
import { useEffect, useState } from 'react'
import { apiUrl } from '../shared/api'
import './home.css'

/** GET /api/ear/replay says whether the replay is a real run, and which practice it holds. Anything but
 *  `real: true` is the scripted one. */
function useReplay(): { real: boolean | null; kind: string | null } {
  const [got, setGot] = useState<{ real: boolean | null; kind: string | null }>({ real: null, kind: null })
  useEffect(() => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    fetch(apiUrl('ear/replay'), { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: { real?: unknown; kind?: unknown } | null) => setGot({ real: x?.real === true, kind: typeof x?.kind === 'string' ? x.kind : null }))
      .catch(() => setGot({ real: false, kind: null }))
      .finally(() => clearTimeout(t))
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [])
  return got
}

/** the practice in the run, in the replay's own words */
const PRACTICE: Record<string, string> = { breathe: 'Slow breathing', scan: 'Body scan', walk: 'A short walk' }

const LOOP: { k: string; t: string }[] = [
  { k: 'Sense', t: 'While Vire is open, your AirPods feel head movement, head-down time, walks, nods and, on AirPods Pro 3, heart rate.' },
  { k: 'Practice', t: 'When that drifts from your usual, a short practice plays in your ears.' },
  { k: 'Learn', t: 'Vire measures what it did and learns which practice helps you.' },
  { k: 'Tell', t: 'Drift the practices don’t fix goes to the top of your clinic’s list.' },
]

export default function Home() {
  const { real, kind } = useReplay()
  // the four parts of the run, named as the replay names them
  const parts = ['Check before', (kind && PRACTICE[kind]) || 'A practice', 'Check after', 'The clinic’s screen']
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
        {/* what the 40 seconds hold, before the tap: the same four parts the replay counts off */}
        <ol className="run-parts hm-parts" aria-label="What the run shows">
          {parts.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
        {/* the one thing here that is not a script: a check from the founder's own AirPods, played back */}
        <a className="hm-real" href="#/heard" data-heard>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="hm-play">
            <path d="M8 5.5v13a.6.6 0 0 0 .9.5l10.4-6.5a.6.6 0 0 0 0-1L8.9 5a.6.6 0 0 0-.9.5Z" />
          </svg>
          <span>
            <b>Watch a real check</b>
            <small>The founder’s own AirPods, camera off, 22 seconds</small>
          </span>
        </a>

        <p className="hm-who hm-why" data-why>
          A year after a TMS course, it has stopped working for about half of the people it helped. Once you&rsquo;re home, the clinic doesn&rsquo;t see you.
        </p>
        <p className="hm-who">For people home after a TMS course, and the clinic that treated them.</p>
      </section>

      <nav className="hm-ways" aria-label="Ways in">
        {/* first, because it is the one way in that senses the person reading this: most have no AirPods with them.
            The earlier one-minute camera check (#/visit) still opens by its address; it is not a way in any more. */}
        <a href="#/try" className="hm-way" data-try>
          <b>No AirPods?</b>
          <span>Try the breathing on your phone, a minute</span>
          <Arrow />
        </a>
        {/* same tab: the iPhone app has no address bar and drops links that open a new window */}
        <a href="app/" className="hm-way" data-app-link>
          <b>Open the phone app</b>
          <span>Teach your AirPods. The rest of it is sample data</span>
          <Arrow />
        </a>
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
