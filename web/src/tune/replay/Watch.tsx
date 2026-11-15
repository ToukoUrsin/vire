// /#/watch: a stored Today run played back in about 40 seconds, for anyone without AirPods. The check before,
// the breathing (squeezed, and said so), the check after with what Today said, then the practice landing on the
// clinic's screen. Every number is from that run (GET /api/ear/replay). Watching sends nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayBundle } from '@shared/earreplay'
import { PracticeBoard } from '../../clinic/stage/Practice'
import { api } from '../../shared/api'
import { breathRow, heartRow, stillRow, verdict } from '../session/result'
import { ReplaySound } from './replaySound'
import type { SoundState } from './replaySound'
import { at, breathAt, lastAt, mmss, paceAt, plan, squeeze } from './timeline'
import BreathTrace from './BreathTrace'
import type { Part, Plan } from './timeline'
import '../ears-lab.css'
import '../session/today.css'
import '../../clinic/stage/stage.css'
import './watch.css'

/** tests play it faster; nothing else sets this */
const speed = () => {
  try {
    return Math.max(1, Number(localStorage.getItem('vire.watch.speed')) || 1)
  } catch {
    return 1
  }
}
const day = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
const NAME = { breathe: 'Slow breathing', scan: 'Body scan', walk: 'A short walk' } as const
const PART: Record<Part, string> = { before: 'Check before', practice: '', after: 'Check after', result: 'What Today said', clinic: 'On the clinic’s screen' }
// one line under the heading for each part, so nobody has to guess what they are watching. The practices in Today's own words.
const ABOUT = {
  breathe: 'A sea in the ears rises and falls. It slows down as the breath does.',
  scan: 'A sea in the ears, and one part of the body at a time.',
  walk: 'Two and a half minutes of walking. The steps are felt.',
} as const
const WHAT: Record<'before' | 'after', string> = {
  before: 'Heart rate and head movement, read before the practice.',
  after: 'The same check again, to see what changed.',
}

/** the four parts of the run, as the first screen lists them, with the one playing lit */
function Steps({ kind, part }: { kind: ReplayBundle['kind']; part: Part }) {
  const on = part === 'before' ? 0 : part === 'practice' ? 1 : part === 'clinic' ? 3 : 2
  return (
    <ol className="run-parts wt-steps" aria-label="The four parts of this run">
      {['Check before', NAME[kind], 'Check after', 'The clinic’s screen'].map((x, i) => (
        <li key={x} data-state={i < on ? 'done' : i === on ? 'now' : 'next'} aria-current={i === on ? 'step' : undefined}>
          {x}
        </li>
      ))}
    </ol>
  )
}

export default function Watch() {
  const [b, setB] = useState<ReplayBundle | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tries, setTries] = useState(0)
  const [pos, setPos] = useState(0)
  const [paused, setPaused] = useState(false)
  const [sound, setSound] = useState<SoundState>('starting')
  const snd = useRef<ReplaySound | null>(null)
  const clock = useRef({ pos: 0, last: 0, paused: false, breath: -1, part: '' as Part | '', piece: 0 })
  const clinicRef = useRef<HTMLDivElement>(null)
  const reduced = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    let alive = true
    api<ReplayBundle>('ear/replay')
      .then((got) => alive && setB(got))
      .catch(() => alive && setErr('No run to show right now.'))
    return () => {
      alive = false
    }
  }, [tries])

  const p: Plan | null = useMemo(() => (b ? plan(b) : null), [b])

  // sound: tried at once; a browser that wants a tap first gets one button
  useEffect(() => {
    if (!b) return
    const s = new ReplaySound()
    snd.current = s
    s.prefetch(b.sound, b.kind)
    let alive = true
    void s.start().then((st) => {
      if (!alive) return
      setSound(st)
      if (st === 'on') s.on(!clock.current.paused)
    })
    return () => {
      alive = false
      s.stop()
      snd.current = null
    }
  }, [b])

  const tapSound = useCallback(async () => {
    const s = snd.current
    if (!s) return
    const st = await s.unblock()
    setSound(st)
    if (st === 'on') s.on(!clock.current.paused)
  }, [])

  // the clock: replay seconds, moved on each frame unless paused
  useEffect(() => {
    if (!b || !p) return
    const c = clock.current
    const sp = speed()
    let raf = 0
    c.last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - c.last) / 1000)
      c.last = now
      if (!c.paused && c.pos < p.end) {
        c.pos = Math.min(p.end, c.pos + dt * sp)
        step(b, p, c, snd.current, sp)
        setPos(c.pos)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [b, p])

  const now = p ? at(p, pos) : null
  const part = now?.part ?? 'before'
  useEffect(() => {
    if (part === 'clinic') clinicRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [part, reduced])

  const pause = () => {
    const c = clock.current
    c.paused = !c.paused
    setPaused(c.paused)
    if (sound === 'on') snd.current?.on(!c.paused)
  }
  const replay = () => {
    const c = clock.current
    Object.assign(c, { pos: 0, breath: -1, part: '', piece: 0, paused: false })
    snd.current?.rewind()
    if (sound === 'on') snd.current?.on(true)
    setPaused(false)
    setPos(0)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const tag = b ? (b.real ? `${b.label}, ${day(b.at)}` : b.label) : ''
  const ended = !!p && pos >= p.end
  return (
    <main className="el td wt" data-part={part} data-real={b ? String(b.real) : ''} data-sound={sound} data-paused={paused ? '1' : '0'}>
      <header className="el-top">
        <a className="el-mark wt-home" href="#/">
          Vire
        </a>
        <span className="el-where">Watch a run</span>
      </header>
      {/* the label that says what kind of run this is appears with the run, never over a loading or failed screen */}
      {b && (
        <p className="wt-tag" data-label>
          {tag}
        </p>
      )}
      {b && <Steps kind={b.kind} part={part} />}
      {!b && !err && (
        <section className="td-main wt-wait" role="status">
          <p className="td-day">Loading the run…</p>
          <div className="wt-still" aria-hidden="true" />
          <div className="wt-wait-lines" aria-hidden="true">
            <i className="skeleton" />
            <i className="skeleton" />
            <i className="skeleton" />
          </div>
        </section>
      )}
      {err && (
        <section className="td-main wt-none" role="alert">
          <h1>{err}</h1>
          <p className="el-lede">The server did not send one. Nothing is wrong on your side.</p>
          <div className="el-btns">
            <button
              type="button"
              className="lab-btn primary"
              onClick={() => {
                setErr(null)
                setTries((n) => n + 1)
              }}
              data-retry
            >
              Try again
            </button>
            <a className="lab-btn" href="#/">
              Back to Vire
            </a>
          </div>
        </section>
      )}
      {b && p && now && <Stage b={b} p={p} pos={pos} now={now} />}
      {b && (part === 'result' || part === 'clinic') && <Result b={b} />}
      {b && part === 'clinic' && (
        <div className="wt-clinic" ref={clinicRef} data-clinic>
          <p className="td-day">{PART.clinic}</p>
          <PracticeBoard seen={b.seen} />
          <p className="wt-see">
            <a className="lab-btn primary" href="#/clinic">
              See the clinic
            </a>
          </p>
        </div>
      )}
      {b && p && (
        <div className="wt-controls">
          <div className="el-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (pos / p.end) * 100)}%` }} />
          </div>
          <div className="el-btns">
            {sound === 'blocked' && (
              <button type="button" className="lab-btn primary" onClick={tapSound} data-tap-sound>
                Tap for sound
              </button>
            )}
            <button type="button" className="lab-btn" onClick={pause} data-pause aria-pressed={paused} disabled={ended}>
              {paused ? 'Play' : 'Pause'}
            </button>
            <button type="button" className="lab-btn" onClick={replay} data-replay>
              Replay
            </button>
            <a className="lab-btn" href="#/">
              Back to Vire
            </a>
          </div>
        </div>
      )}
    </main>
  )
}

/** what the sound does as the clock passes a moment: a breath, a chime at each part, a piece of the run coming in */
function step(b: ReplayBundle, p: Plan, c: { pos: number; breath: number; part: Part | ''; piece: number }, s: ReplaySound | null, sp: number) {
  const n = at(p, c.pos)
  if (n.part !== c.part) {
    const was = c.part
    c.part = n.part
    if (s) {
      if (n.part === 'result') {
        s.chime(true)
        if (!s.muted) s.sw.level(0, 1.5)
      } else if (was !== '' || n.part !== 'before') s.chime()
      if (n.part === 'after' && !s.muted) s.sw.level(0.3, 1)
      if (n.part === 'before' && !s.muted) s.sw.level(0.45, 1)
    }
  }
  if (n.t === null || !n.seg || !s) return
  while (c.piece < b.sound.length && b.sound[c.piece].t <= n.t) {
    const x = b.sound[c.piece++]
    if (x.made !== 'tone') void s.piece(x.id)
  }
  if (n.part === 'practice') {
    const got = breathAt(b.breaths, n.t)
    if (got && got.i !== c.breath) {
      c.breath = got.i
      if (!s.muted) s.sw.level(0.55, 0.5)
      const k = squeeze(n.seg) * sp
      s.breath((got.b.tMid - got.b.t0) / 1000 / k, (got.b.t1 - got.b.tMid) / 1000 / k)
    }
  }
}

function Stage({ b, p, pos, now }: { b: ReplayBundle; p: Plan; pos: number; now: ReturnType<typeof at> }) {
  const seg = now.seg
  const t = now.t
  const practice = now.part === 'practice'
  const breath = practice && t !== null ? breathAt(b.breaths, t) : null
  const pace = t !== null ? paceAt(b.breaths, t) : b.read.paceLast
  const check = t !== null ? [...b.checks].reverse().find((x) => x.t <= t) ?? null : null
  const hr = t !== null ? lastAt(b.heart.rows, t) : null
  const mv = t !== null ? lastAt(b.move, t) : null
  const span = seg ? mmss((seg.t1 - seg.t0) / 1000) : ''
  const k = seg ? squeeze(seg) : 1
  // "22 s in 6 s" alone is a riddle: say that the run is played faster than it happened
  const where = seg ? `${practice ? NAME[b.kind] : PART[seg.part]}: ${span} in ${seg.dur} s${k > 1.05 ? ', played faster' : ''}` : ''
  const heartFrom = b.scripted ? ', a stand-in' : b.heart.from === 'airpods' ? ', from the AirPods' : b.heart.from === 'camera' ? ', from the camera' : ''
  const said = now.part === 'before' || now.part === 'after' ? 'Sit still' : breath ? (breath.phase === 'in' ? 'Breathe in' : 'Breathe out') : practice ? NAME[b.kind] : null
  const phaseSecs = breath ? ((breath.phase === 'in' ? breath.b.tMid - breath.b.t0 : breath.b.t1 - breath.b.tMid) / 1000 / k) * 0.95 : 0.3
  const checkSaid = !check ? null : check.by === 'breath' ? 'breath followed' : check.by === 'stillness' ? 'no breath read, went by stillness' : 'breath did not follow, held'
  if (!seg) return null
  return (
    <section className="td-main wt-main" aria-live="off">
      <p className="td-day" data-where={seg.part}>
        {where}
      </p>
      {/* the sea beside what it asks: one row, on the page's left edge */}
      <div className="run-now">
        {practice && b.kind === 'breathe' ? (
          <div className="td-orb wt-orb" data-phase={breath?.phase ?? 'out'} style={{ transitionDuration: `${Math.max(0.05, phaseSecs)}s` }} aria-hidden="true" />
        ) : (
          <div className="wt-still" aria-hidden="true" />
        )}
        <div>
          {said && <h1 className="wt-say">{said}</h1>}
          <p className="wt-what">{practice ? ABOUT[b.kind] : WHAT[seg.part === 'after' ? 'after' : 'before']}</p>
        </div>
      </div>
      <ul className="td-live">
        <li data-heart={hr ? hr[1] : ''}>
          <b>Heart</b>
          <span>{hr ? `${Math.round(hr[1])} a minute${heartFrom}` : 'not read'}</span>
        </li>
        {practice && b.kind === 'breathe' && pace !== null && (
          <li data-pace={pace}>
            <b>Pace</b>
            <span>
              {pace} breaths a minute{checkSaid ? `, ${checkSaid}` : ''}
            </span>
          </li>
        )}
        <li data-move={mv ? mv[1] : ''}>
          <b>Head movement</b>
          <span>{mv ? `${mv[1].toFixed(1)}° a second` : 'not read'}</span>
        </li>
      </ul>
      {practice && b.kind === 'breathe' && t !== null && <BreathTrace b={b} t={t} />}
      <Strip b={b} p={p} pos={pos} part={now.part} />
    </section>
  )
}

/** heart rate and head movement as they were, drawn up to the moment playing, with each pace check */
function Strip({ b, p, pos, part }: { b: ReplayBundle; p: Plan; pos: number; part: Part }) {
  const W = 340
  const total = p.resultAt
  const x = (s: (typeof p.segments)[number], t: number) => ((s.at + ((t - s.t0) / (s.t1 - s.t0)) * s.dur) / total) * W
  const inSeg = (t: number) => p.segments.find((s) => t >= s.t0 && t <= s.t1)
  const hrs = b.heart.rows.filter((r) => inSeg(r[0]))
  const lo = Math.min(...hrs.map((r) => r[1])) - 2
  const hi = Math.max(...hrs.map((r) => r[1])) + 2
  const mvs = b.move.filter((r) => inSeg(r[0]))
  const top = Math.max(0.5, ...mvs.map((r) => r[1]).sort((a, c) => a - c).slice(0, Math.max(1, Math.floor(mvs.length * 0.98))))
  const path = (rows: [number, number][], y: (v: number) => number) => {
    let d = ''
    let prev: (typeof p.segments)[number] | undefined
    for (const r of rows) {
      const s = inSeg(r[0])!
      const px = x(s, r[0])
      if ((px / W) * total > pos) break
      d += `${d && s === prev ? 'L' : 'M'}${px.toFixed(1)},${y(r[1]).toFixed(1)}`
      prev = s
    }
    return d
  }
  const yh = (v: number) => 6 + (1 - (v - lo) / Math.max(1, hi - lo)) * 30
  const ym = (v: number) => 46 + (1 - Math.min(1, v / top)) * 28
  const shown = b.checks.filter((c) => inSeg(c.t) && (x(inSeg(c.t)!, c.t) / W) * total <= pos)
  return (
    <figure className="wt-strip">
      {/* which stretch of the strip is which: the two checks are short, the practice is the long middle */}
      <div className="wt-segs" aria-hidden="true">
        {p.segments.map((s) => (
          <span key={s.part} style={{ flexGrow: s.dur }} data-on={s.part === part ? '1' : '0'}>
            {s.part === 'practice' ? NAME[b.kind] : s.part === 'before' ? 'Before' : 'After'}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} 80`} preserveAspectRatio="none" role="img" aria-label="Heart rate and head movement as they were in this run">
        {p.segments.slice(1).map((s) => (
          <line key={s.part} className="wt-sep" x1={(s.at / total) * W} x2={(s.at / total) * W} y1={0} y2={80} />
        ))}
        {hrs.length > 1 && <path className="wt-hr" d={path(hrs, yh)} />}
        {mvs.length > 1 && <path className="wt-mv" d={path(mvs, ym)} />}
        <line className="wt-head" x1={(Math.min(pos, total) / total) * W} x2={(Math.min(pos, total) / total) * W} y1={0} y2={80} />
      </svg>
      <div className="wt-cks" aria-hidden="true">
        {shown.map((c) => (
          <i key={c.t} className={c.by === 'breath' ? 'wt-ck is-yes' : c.by === 'stillness' ? 'wt-ck is-still' : 'wt-ck'} style={{ left: `${(x(inSeg(c.t)!, c.t) / W) * 100}%` }} />
        ))}
      </div>
      <figcaption>
        <span className="wt-k-hr">heart rate</span>
        <span className="wt-k-mv">head movement</span>
        <span className="wt-k-ck">
          pace checks:
          <span>
            <i className="wt-ck is-yes" aria-hidden="true" />
            breath followed
          </span>
          <span>
            <i className="wt-ck is-still" aria-hidden="true" />
            by stillness
          </span>
          <span>
            <i className="wt-ck" aria-hidden="true" />
            not followed
          </span>
        </span>
      </figcaption>
    </figure>
  )
}

function Result({ b }: { b: ReplayBundle }) {
  const r = b.read
  const v = verdict(r)
  const hr = heartRow(r)
  const st = stillRow(r)
  return (
    <section className="td-main wt-result" data-result>
      <p className="td-day">{PART.result}</p>
      <h1 data-verdict={r.settle ?? ''}>{v.head}</h1>
      <p className="el-lede">{v.line}</p>
      <ul className="el-rows td-rows">
        <li data-ok={r.heartChange !== null && r.heartChange <= -1} data-row="heart">
          <b>Heart rate</b>
          {hr ? (
            <span>
              {hr.main}
              {!b.scripted && <i>{hr.note}</i>}
              {b.scripted && <i> (a stand-in)</i>}
            </span>
          ) : (
            <span>not read: the AirPods gave no heart rate in this run</span>
          )}
          {/* a bare 0 reads as a missing number */}
          <em>{hr ? (hr.change === '0' ? 'no change' : hr.change) : ''}</em>
        </li>
        <li data-ok={r.settle !== null && r.settle >= 5} data-row="still">
          <b>Stillness</b>
          <span>{st.main}</span>
          <em>{st.change}</em>
        </li>
        {r.kind === 'breathe' && (
          <li data-ok={r.followed > 0} data-row="breath">
            <b>Breathing</b>
            <span>{breathRow(r, b.scripted).main}</span>
            <em>{breathRow(r, b.scripted).own}</em>
          </li>
        )}
      </ul>
    </section>
  )
}
