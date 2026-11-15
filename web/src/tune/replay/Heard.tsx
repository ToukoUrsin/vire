// /#/heard: a real check, played back. One person's own check-in with the camera off: the screen asked for nods and
// head shakes, their AirPods felt the head move, and the model their setup found said what it heard. Because the
// screen knows what it asked, the check scores itself. Every number is from that recording (GET /api/ear/check).
import { useEffect, useMemo, useRef, useState } from 'react'
import { CHECK_ASK, heardBy } from '@shared/earcheck'
import type { CheckBundle, CheckEvent } from '@shared/earcheck'
import { api } from '../../shared/api'
import '../ears-lab.css'
import '../session/today.css'
import './watch.css'
import './heard.css'

/** the check is played three times faster than it ran; tests may play it faster still */
const SPEED = 3
const speed = () => {
  try {
    return Math.max(1, Number(localStorage.getItem('vire.watch.speed')) || 1) * SPEED
  } catch {
    return SPEED
  }
}
const helsinki = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'Europe/Helsinki' }).format(new Date(iso))
const NAME: Record<CheckEvent, string> = { nod: 'Nods', shake: 'Head shakes' }
const ONE: Record<CheckEvent, string> = { nod: 'a nod', shake: 'a head shake' }
const hoursBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 3_600_000)

const W = 1000
const H = 64

/** one row of the chart: one angle of the head, the stretches where the screen asked for this event, and where the model heard it */
function Row({ b, e, pos }: { b: CheckBundle; e: CheckEvent; pos: number }) {
  const col = e === 'nod' ? 1 : 2
  const on = e === 'nod' ? 3 : 4
  const x = (t: number) => (t / b.ms) * W
  const top = useMemo(() => Math.max(5, ...b.head.map((r) => Math.abs(r[col]))), [b, col])
  const y = (v: number) => H / 2 - (v / top) * (H / 2 - 3)
  const drawn = useMemo(() => b.head.map((r) => `${x(r[0]).toFixed(1)},${y(r[col]).toFixed(1)}`), [b, col, top]) // eslint-disable-line react-hooks/exhaustive-deps
  const upto = b.head.findIndex((r) => r[0] > pos)
  const line = (upto < 0 ? drawn : drawn.slice(0, upto)).join(' ')
  const asked = b.steps.filter((s) => s.ask === e)
  // the stretches where the model had this event switched on
  const spans = useMemo(() => {
    const out: [number, number][] = []
    let open: [number, number] | null = null
    for (const r of b.read) {
      if (r[on]) {
        if (!open) out.push((open = [r[0], r[0]]))
        open[1] = r[0]
      } else open = null
    }
    return out
  }, [b, on])
  const got = heardBy(b, e, pos)
  return (
    <figure className="hd-row" data-event={e}>
      <figcaption>
        <b>{e === 'nod' ? 'Head up and down' : 'Head left and right'}</b>
        <span data-count={e}>
          {got.asked ? `${NAME[e]} heard: ${got.heard} of ${got.asked} asked` : `${NAME[e]}: none asked yet`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" role="img" aria-label={`${e === 'nod' ? 'Head up and down' : 'Head left and right'} through the check, with the stretches where the screen asked for ${ONE[e]} and where the model heard one`}>
        {asked.map((s) => (
          <rect key={s.t0} className="hd-asked" x={x(s.t0)} y={0} width={x(s.t1) - x(s.t0)} height={H} rx={3} />
        ))}
        <line className="hd-zero" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        <polyline className="hd-line" points={line} />
        {spans
          .filter((s) => s[0] <= pos)
          .map((s) => (
            <rect key={s[0]} className="hd-heard" x={x(s[0])} y={H + 6} width={Math.max(4, x(Math.min(s[1], pos)) - x(s[0]))} height={6} rx={3} />
          ))}
        <line className="hd-now" x1={x(Math.min(pos, b.ms))} x2={x(Math.min(pos, b.ms))} y1={0} y2={H + 14} />
      </svg>
    </figure>
  )
}

export default function Heard() {
  const [b, setB] = useState<CheckBundle | null>(null)
  const [err, setErr] = useState(false)
  const [pos, setPos] = useState(0)
  const [paused, setPaused] = useState(false)
  const clock = useRef({ pos: 0, last: 0, paused: false })

  useEffect(() => {
    document.title = 'Vire: a real check'
    let alive = true
    api<CheckBundle>('/ear/check')
      .then((x) => alive && setB(x))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!b) return
    const c = clock.current
    const sp = speed()
    let raf = 0
    c.last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(250, now - c.last)
      c.last = now
      if (!c.paused && c.pos < b.ms) {
        c.pos = Math.min(b.ms, c.pos + dt * sp)
        setPos(c.pos)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [b])

  const pause = () => {
    clock.current.paused = !clock.current.paused
    setPaused(clock.current.paused)
  }
  const replay = () => {
    Object.assign(clock.current, { pos: 0, paused: false })
    setPaused(false)
    setPos(0)
  }

  const ended = !!b && pos >= b.ms
  const step = b?.steps.find((s) => pos >= s.t0 && pos < s.t1) ?? null
  const reading = b ? [...b.read].reverse().find((r) => r[0] <= pos) : undefined
  const hears = reading ? (reading[3] ? 'a nod' : reading[4] ? 'a head shake' : null) : null
  const hours = b ? hoursBetween(b.taughtAt, b.recordedAt) : 0
  const s = b?.score
  return (
    <main className="el td wt hd" data-ended={ended ? '1' : '0'} data-paused={paused ? '1' : '0'}>
      <header className="el-top">
        <a className="el-mark wt-home" href="#/">
          Vire
        </a>
        <span className="el-where">Watch a real check</span>
      </header>
      {b && (
        <p className="wt-tag" data-label>
          A real check: the founder&apos;s own AirPods, camera off. Recorded {helsinki(b.recordedAt, { day: 'numeric', month: 'long', year: 'numeric' })} at{' '}
          {helsinki(b.recordedAt, { hour: '2-digit', minute: '2-digit' })} Helsinki time.
        </p>
      )}
      {!b && !err && (
        <section className="td-main wt-wait" role="status">
          <p className="td-day">Loading the check…</p>
        </section>
      )}
      {err && (
        <section className="td-main wt-none" role="alert">
          <h1>There is no real check to play yet.</h1>
          <p className="el-lede">The scripted run plays the whole of Today instead.</p>
          <div className="el-btns">
            <a className="lab-btn primary" href="#/watch">
              Watch a run
            </a>
            <a className="lab-btn" href="#/">
              Back to Vire
            </a>
          </div>
        </section>
      )}
      {b && s && (
        <section className="td-main">
          {!ended ? (
            <div className="hd-now-say" aria-live="off">
              <p className="td-day">The screen asked</p>
              <h1 className="wt-say" data-ask={step?.ask ?? ''}>
                {step ? CHECK_ASK[step.ask] : ' '}
              </h1>
              <p className="hd-hears" data-hears={hears ?? ''}>
                {hears ? `The AirPods heard ${hears}.` : 'The AirPods hear neither a nod nor a head shake.'}
              </p>
            </div>
          ) : (
            <div className="hd-now-say" data-verdict>
              <p className="td-day">What the AirPods heard, with no camera</p>
              <h1 className="wt-say">
                {s.nod.heard} of {s.nod.asked} nods, {s.shake.heard} of {s.shake.asked} head shakes.
              </h1>
              <p className="hd-hears">
                {s.nod.unasked + s.shake.unasked === 0 ? 'Nothing heard that was not asked.' : `Heard ${s.nod.unasked + s.shake.unasked} that were not asked.`} One check, on one person.
              </p>
            </div>
          )}
          <div className="hd-chart">
            <Row b={b} e="nod" pos={pos} />
            <Row b={b} e="shake" pos={pos} />
            <p className="hd-key">
              <span>
                <i className="hd-k-asked" aria-hidden="true" />
                the screen asked for it
              </span>
              <span>
                <i className="hd-k-line" aria-hidden="true" />
                what the AirPods felt
              </span>
              <span>
                <i className="hd-k-heard" aria-hidden="true" />
                the model heard it
              </span>
            </p>
          </div>
          <ul className="hd-facts">
            <li>
              The model was taught {hours} hours earlier, from the one-minute setup done {b.model.minutes} times, where the camera labelled the nods and head shakes. A locked Modal Sandbox tried {b.model.tried} models
              and kept the best.
            </li>
            <li>This check had no camera: the screen asked, the AirPods felt the head move, and the model said what it heard. {Math.round(b.ms / 1000)} seconds, played {SPEED} times faster.</li>
            <li>
              Asked seconds told from the rest, in this check: nods {s.nod.auc.toFixed(2)}, head shakes {s.shake.auc.toFixed(2)} (1.00 is never wrong, 0.50 is luck). When it was taught, on a
              setup minute it never saw: <span data-held>{b.model.held.nod.toFixed(2)} and {b.model.held.shake.toFixed(2)}</span>. Smiles are asked too, but not read from the AirPods:{' '}
              {b.model.held.smile.toFixed(2)} on the setup minutes, too weak to count.
            </li>
          </ul>
        </section>
      )}
      {b && (
        <div className="wt-controls">
          <div className="el-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (pos / b.ms) * 100)}%` }} />
          </div>
          <div className="el-btns">
            <button type="button" className="lab-btn" onClick={pause} data-pause aria-pressed={paused} disabled={ended}>
              {paused ? 'Play' : 'Pause'}
            </button>
            <button type="button" className="lab-btn" onClick={replay} data-replay>
              Replay
            </button>
            <a className="lab-btn" href="#/watch">
              Watch a whole run
            </a>
          </div>
        </div>
      )}
    </main>
  )
}
