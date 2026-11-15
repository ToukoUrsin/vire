// /#/try: the breathing, for someone with a phone and no AirPods. One tap, about a minute. The phone is held flat
// against the chest and its own motion sensor stands in for the AirPods: each breath tilts it a degree or two. The
// sea starts at ten breaths a minute; every stretch long enough to read, the phone is asked whether the breath
// went with it (flow.ts, with Today's own breath.ts and pace.ts), the sea steps down, holds or eases back, and the
// screen says what was read. The slow tilt is drawn beside the sea's rise and fall as it happens.
// A try is not a practice: it goes to /api/try alone, as motion numbers, and to no person or clinic list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encode } from 'uqr'
import { apiUrl } from '../shared/api'
import { loadManifest, nextSegment } from '../tune/session/sound'
import type { SoundManifest } from '../tune/session/sound'
import { Swell } from '../tune/session/swell'
import { TRY, afterBreath, breathTrace, countsOf, newTry, paceWord, planBreath, resultLines } from './flow'
import type { TryBreath, TryCounts, TryState } from './flow'
import { MotionStream, OUT_HZ, askMotion, listenMotion } from './phoneMotion'
import '../tune/ears-lab.css'
import './try.css'

type Stage = 'start' | 'run' | 'result' | 'refused' | 'nophone'
type Ended = 'time' | 'done' | 'left' | 'no-motion' | 'refused'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** tests run the same minute faster (#/try?speed=4): the page's clock runs that much faster and nothing else changes */
const speed = () => {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  return Math.max(1, Math.min(8, Number(q.get('speed')) || 1))
}
const newId = () => `try-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
/** this page's address, to open on a phone */
const address = () => `${location.origin}${location.pathname}#/try`
const VIEW_MS = 24_000
const W = 300
const H = 96

interface Live {
  phase: 'in' | 'out'
  secs: number
  pace: number
}
interface Drawn {
  tilt: string
  sea: string
  swing: number
  together: number
  points: number
}
/** the whole try, drawn once it is over: the phone was on the chest, so this is the first time the person sees it */
interface Whole {
  tilt: string
  sea: string
  marks: { x: number; by: 'breath' | 'stillness' | 'held' }[]
  secs: number
}
interface Run {
  id: string
  at: string
  t0: number
  sp: number
  state: TryState
  stream: MotionStream
  current: TryBreath | null
  pieces: { id: string; t: number; made: 'live' | 'set' }[]
  ended: Ended | null
  /** the whole try has been sent */
  sent: boolean
  /** a "left" line has been sent */
  leftSent: boolean
}

export default function Try() {
  const [stage, setStage] = useState<Stage>('start')
  const [live, setLive] = useState<Live>({ phase: 'out', secs: 0.05, pace: 10 })
  const [said, setSaid] = useState<string | null>(null)
  const [checks, setChecks] = useState(0)
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [hz, setHz] = useState(0)
  const [made, setMade] = useState<'tone' | 'modal'>('tone')
  const [audio, setAudio] = useState('off')
  const [counts, setCounts] = useState<TryCounts | null>(null)
  const [whole, setWhole] = useState<Whole | null>(null)
  const swell = useRef(new Swell())
  const token = useRef(0)
  const run = useRef<Run | null>(null)
  const stopAsked = useRef(false)

  /** everything about this try, as it stands now: what was read, what the sea did, and the motion rows */
  const body = (r: Run, ended: Ended, withRows: boolean) => {
    const now = (performance.now() - r.t0) * r.sp
    return JSON.stringify({
      v: 1,
      id: r.id,
      at: r.at,
      ua: navigator.userAgent,
      sampleHz: Math.round(r.stream.inHz * 10) / 10,
      rowHz: OUT_HZ,
      ended,
      ms: Math.round(now),
      checks: r.state.checks.map(({ line: _line, ...c }) => c),
      result: countsOf(r.state),
      sound: r.pieces.length ? 'modal' : 'tone',
      pieces: r.pieces,
      breaths: r.state.breaths.map((b) => [Math.round(b.t0), Math.round(b.tMid), Math.round(b.t1), b.perMin]),
      rows: withRows ? r.stream.rows : [],
      gyro: withRows ? r.stream.gyro : [],
      ...(withRows ? {} : { rowsLeftOut: true }),
      holes: r.stream.holes,
      joined: r.stream.joined,
      speed: r.sp,
      screen: `${window.innerWidth}x${window.innerHeight}`,
    })
  }

  /** the try is over: keep it */
  const send = useCallback((r: Run, ended: Ended) => {
    if (r.sent) return
    r.sent = true
    r.ended = ended
    void fetch(apiUrl('try'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(r, ended, true) }).catch(() => {})
  }, [])

  /** the page is being left in the middle: a phone only lets a short message out then, so the rows go if they fit */
  const leave = useCallback(() => {
    const r = run.current
    if (!r || r.sent || r.leftSent || !navigator.sendBeacon) return
    r.leftSent = true
    const blob = (withRows: boolean) => new Blob([body(r, 'left', withRows)], { type: 'application/json' })
    if (!navigator.sendBeacon(apiUrl('try'), blob(true))) navigator.sendBeacon(apiUrl('try'), blob(false))
  }, [])

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') leave()
    }
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', hidden)
    const sw = swell.current
    return () => {
      window.removeEventListener('pagehide', leave)
      document.removeEventListener('visibilitychange', hidden)
      leave()
      token.current++
      sw.stop()
    }
  }, [leave])

  const begin = useCallback(async () => {
    const mine = ++token.current
    const sp = speed()
    const sw = swell.current
    stopAsked.current = false
    // The motion question and the sound may only start inside this tap: both are asked before anything is awaited.
    const asked = askMotion()
    try {
      // an iPhone with its ringer switched off still plays this
      ;(navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'playback'
    } catch {
      /* not an iPhone, or an older one */
    }
    const sounding = sw.start()
    let lock: { release?: () => Promise<void> } | null = null
    void (navigator as unknown as { wakeLock?: { request: (k: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})
    const awake = () => void lock?.release?.().catch(() => {})

    setSaid(null)
    setChecks(0)
    setDrawn(null)
    setCounts(null)
    setWhole(null)
    setElapsed(0)
    setHz(0)
    setMade('tone')
    setLive({ phase: 'out', secs: 0.05, pace: newTry().pacer.pace })
    setStage('run')
    // an iPhone asks its question here; the minute's clock starts only once it is answered
    const [allowed, sounds] = await Promise.all([asked, sounding])

    const t0 = performance.now()
    const now = () => (performance.now() - t0) * sp
    const stream = new MotionStream()
    const r: Run = { id: newId(), at: new Date().toISOString(), t0, sp, state: newTry(), stream, current: null, pieces: [], ended: null, sent: false, leftSent: false }
    const unlisten = listenMotion(stream, now)
    const finish = (to: Stage, ended: Ended) => {
      unlisten()
      clearInterval(drawing)
      sw.stop()
      awake()
      if (mine !== token.current) return
      send(r, ended)
      setCounts(countsOf(r.state))
      // the whole minute as one line: the first seconds are left out while the slow filter settles
      const end = now()
      const from = Math.min(4000, end / 4)
      const tr = breathTrace(stream.rows, r.state.breaths, from, end, 240)
      if (to === 'result' && tr.tilt.length > 20) {
        const scale = Math.max(TRY.minTiltDeg * 2, tr.swingDeg)
        const pt = (x: number, y: number) => `${(x * W).toFixed(1)},${y.toFixed(1)}`
        setWhole({
          tilt: tr.tilt.map((v, i) => pt(tr.x[i]!, H * (0.5 - 0.72 * (v / scale)))).join(' '),
          sea: tr.sea.map((v, i) => pt(tr.x[i]!, H * (0.86 - 0.72 * v))).join(' '),
          marks: r.state.checks.map((c) => ({ x: (c.t - from) / (end - from), by: c.by })).filter((m) => m.x >= 0 && m.x <= 1),
          secs: Math.round(end / 1000),
        })
      }
      setStage(to)
    }
    let drawing: ReturnType<typeof setInterval> | undefined
    if (mine !== token.current) return finish('start', 'left')
    run.current = r
    setAudio(sounds ? (sw.context?.state ?? 'off') : 'off')
    if (allowed === 'denied') return finish('refused', 'refused')
    // the line is drawn eight times a second from the rows as they are
    drawing = setInterval(() => {
      if (mine !== token.current) return clearInterval(drawing)
      const t = now()
      setElapsed(t)
      setHz(Math.round(stream.inHz * sp))
      const tr = breathTrace(stream.rows, r.current ? [...r.state.breaths, r.current] : r.state.breaths, t - VIEW_MS, t)
      if (!tr.tilt.length) return setDrawn(null)
      const scale = Math.max(TRY.minTiltDeg * 2, tr.swingDeg)
      const pt = (x: number, y: number) => `${(x * W).toFixed(1)},${y.toFixed(1)}`
      setDrawn({
        tilt: tr.tilt.map((v, i) => pt(tr.x[i]!, H * (0.5 - 0.72 * (v / scale)))).join(' '),
        sea: tr.sea.map((v, i) => pt(tr.x[i]!, H * (0.86 - 0.72 * v))).join(' '),
        swing: tr.swingDeg,
        together: tr.together,
        points: tr.tilt.length,
      })
    }, 125)
    // The sea: the phone's own at once; a piece made on Modal takes its place as soon as it is fetched.
    sw.level(0.7, 0.8)
    let manifest: SoundManifest | null = null
    const gotManifest = loadManifest()
      .then((m) => (manifest = m))
      .catch(() => null)
    let playing = ''
    let liveAsked = false
    const put = (id: string, buffer: AudioBuffer, how: 'live' | 'set') => {
      if (mine !== token.current || r.sent || playing === id) return
      sw.setStem('sea', buffer, id)
      playing = id
      r.pieces.push({ id, t: Math.round(now()), made: how })
      setMade('modal')
    }
    const piece = async (pace: number, fresh: boolean) => {
      const ctx = sw.context
      if (!ctx) return
      await gotManifest
      const stage = pace <= 7 ? 'deep' : 'settle'
      const beds = (manifest?.beds ?? []).filter((b) => b.input?.kind === 'breathe')
      const far = (b: (typeof beds)[number]) => (b.input!.stage === stage ? 0 : 4) + Math.abs(b.input!.pace - pace) + Math.abs(b.input!.calm - 0.7) * 3
      const bed = beds.sort((a, b) => far(a) - far(b))[0]
      if (bed && bed.id !== playing) {
        try {
          const res = await fetch(bed.url)
          if (res.ok) put(bed.id, await ctx.decodeAudioData(await res.arrayBuffer()), 'set')
        } catch {
          /* the phone's own sea goes on */
        }
      }
      if (!fresh || liveAsked || !manifest?.live) return
      liveAsked = true
      try {
        const got = await nextSegment({ kind: 'breathe', stage, pace, calm: 0.7, waitMs: 30_000 }, ctx)
        if (got.info.made === 'live') put(got.info.id, got.buffer, 'live')
      } catch {
        /* no new piece this time */
      }
    }
    void piece(r.state.pacer.pace, false)

    /** wait until `t` on the page's clock; false when the try was stopped, left, or the phone gives no motion */
    let motionSeen = false
    const until = async (t: number): Promise<'go' | 'stop' | 'nophone'> => {
      for (;;) {
        if (mine !== token.current || stopAsked.current) return 'stop'
        if (!motionSeen) {
          if (stream.count > 0) motionSeen = true
          else if (performance.now() - t0 > 1500) return 'nophone'
        }
        const left = (t - now()) / sp
        if (left <= 0) return 'go'
        await wait(Math.min(50, left))
      }
    }
    for (;;) {
      const b = planBreath(r.state, now())
      r.current = b
      const inS = (b.tMid - b.t0) / sp / 1000
      const outS = (b.t1 - b.tMid) / sp / 1000
      sw.breath(inS, outS)
      setLive({ phase: 'in', secs: inS, pace: b.perMin })
      let w = await until(b.tMid)
      if (w === 'go') {
        setLive({ phase: 'out', secs: outS, pace: b.perMin })
        w = await until(b.t1)
      }
      if (w === 'nophone') return finish('nophone', 'no-motion')
      if (w === 'stop') return finish(mine === token.current ? 'result' : 'start', mine === token.current ? 'done' : 'left')
      r.current = null
      const got = afterBreath(r.state, { ...b, t1: Math.max(b.t1, now()) }, stream.rows, now())
      if (got.check) {
        setSaid(got.check.line)
        setChecks(r.state.checks.length)
        if (got.check.to !== got.check.from) void piece(got.check.to, true)
      }
      if (got.done) return finish('result', 'time')
    }
  }, [send])

  const firstIn = Math.max(0, Math.ceil((24_000 - elapsed) / 1000))
  const res = counts ? resultLines(counts) : null
  const flat = drawn !== null && drawn.swing < TRY.minTiltDeg && elapsed > 8000
  return (
    <main className="el ty" data-stage={stage} data-pace={live.pace} data-phase={live.phase} data-checks={checks} data-sound={made} data-audio={audio} data-hz={hz}>
      <header className="el-top">
        <a className="el-mark" href="#/">
          Vire
        </a>
        <span className="el-where">Try the breathing</span>
      </header>
      <section className="ty-main">
        {stage === 'start' && (
          <>
            <h1>Try the breathing with your phone</h1>
            <p className="ty-lede">A little over a minute. Turn the sound on, with any headphones or the speaker. Tap the button, then hold your phone flat against your chest.</p>
            <p className="ty-lede ty-quiet">A sea rises and falls. It slows when your phone reads your breath going with it, and it says what it read. Here the phone&rsquo;s motion sensor stands in for the AirPods.</p>
            <div className="ty-btns">
              <button type="button" className="lab-btn primary ty-go" data-start onClick={() => void begin()}>
                Start the sea
              </button>
              <a className="lab-btn" href="#/watch">
                Watch a run
              </a>
            </div>
            <p className="ty-fine">Motion numbers from this minute are saved. No sound, no video.</p>
            <p className="ty-fine">A signal, not a diagnosis.</p>
          </>
        )}
        {stage === 'run' && (
          <>
            {/* the same row as the replay: the sea beside what it asks */}
            <div className="run-now">
              <div className="ty-orb" data-phase={live.phase} style={{ transitionDuration: `${Math.max(0.05, live.secs)}s` }} aria-hidden="true" />
              <div>
                <h1 className="ty-say">{live.phase === 'in' ? 'Breathe in' : 'Breathe out'}</h1>
                <p className="ty-pace">
                  {live.phase === 'in' ? 'As the sea rises.' : 'As it falls.'} {paceWord(live.pace)} breaths a minute.
                </p>
              </div>
            </div>
            <p className="ty-read" data-read={said ? 'yes' : 'no'} aria-live="polite">
              {said ?? (firstIn > 0 ? `Hold the phone flat against your chest. First reading in ${firstIn} seconds.` : 'Reading now.')}
            </p>
            <figure className="ty-trace" data-swing={drawn?.swing ?? 0} data-together={drawn?.together ?? 0} data-points={drawn?.points ?? 0}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Your phone's slow tilt, drawn beside the sea's rise and fall, for the last 24 seconds">
                <line className="ty-mid" x1="0" x2={W} y1={H / 2} y2={H / 2} />
                {drawn && <polyline className="ty-sea" points={drawn.sea} />}
                {drawn && <polyline className="ty-tilt" points={drawn.tilt} />}
              </svg>
              <figcaption>
                <span className="ty-k-tilt">Your breath, as your phone tilts</span>
                <span className="ty-k-sea">The sea</span>
              </figcaption>
              {flat && <p className="ty-flat">The line is flat: no breath is reaching the phone. Press it flat against your chest, or lie back and rest it on your belly.</p>}
            </figure>
            <div className="el-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (elapsed / 82_000) * 100)}%` }} />
            </div>
            <div className="ty-btns">
              <button type="button" className="lab-btn" data-done onClick={() => (stopAsked.current = true)}>
                Done
              </button>
              <span className="ty-fine">{hz > 0 ? `Your phone’s motion sensor, ${hz} readings a second.` : 'Waiting for your phone’s motion sensor.'}</span>
            </div>
          </>
        )}
        {stage === 'result' && res && counts && (
          <>
            <h1 data-from={counts.from} data-to={counts.to}>
              {res.head}
            </h1>
            <ul className="ty-lines" data-checks={counts.checks} data-followed={counts.followed} data-still={counts.byStill} data-not={counts.notFollowed} data-moving={counts.moving}>
              {res.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {whole && (
              <figure className="ty-trace ty-whole" data-whole={whole.marks.length}>
                <svg viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" role="img" aria-label={`Your breath as your phone tilted, drawn over the sea for the whole ${whole.secs} seconds, with a mark at each reading`}>
                  <line className="ty-mid" x1="0" x2={W} y1={H / 2} y2={H / 2} />
                  <polyline className="ty-sea" points={whole.sea} />
                  <polyline className="ty-tilt" points={whole.tilt} />
                  {whole.marks.map((m) => (
                    <line key={m.x} className={`ty-mark ty-mark-${m.by}`} x1={m.x * W} x2={m.x * W} y1={H + 4} y2={H + 14} />
                  ))}
                </svg>
                <figcaption>
                  <span className="ty-k-tilt">Your breath, as your phone tilted</span>
                  <span className="ty-k-sea">The sea</span>
                  <span className="ty-k-mark">Each reading, orange when your breath followed</span>
                </figcaption>
              </figure>
            )}
            <p className="ty-lede ty-quiet">With AirPods the same is read from your head, with your heart rate, before and after the practice, and the clinic sees it. A signal, not a diagnosis.</p>
            <div className="ty-btns">
              <a className="lab-btn primary ty-go" href="#/watch">
                Watch a run
              </a>
              <a className="lab-btn" href="#/clinic">
                The clinic
              </a>
              <button type="button" className="lab-btn" data-again onClick={() => void begin()}>
                Try again
              </button>
            </div>
            <p className="ty-fine">Motion numbers from this minute were saved. No sound, no video.</p>
          </>
        )}
        {stage === 'refused' && (
          <>
            <h1>Your phone did not let this page feel it move.</h1>
            <p className="ty-lede">Reload the page, tap the button again and choose Allow when your phone asks.</p>
            <div className="ty-btns">
              <button type="button" className="lab-btn primary ty-go" onClick={() => location.reload()}>
                Reload
              </button>
              <a className="lab-btn" href="#/watch">
                Watch a run
              </a>
            </div>
          </>
        )}
        {stage === 'nophone' && (
          <>
            <h1>This needs a phone.</h1>
            <p className="ty-lede">It reads your breath from the way a phone tilts on your chest, and this device gave no motion. Open this address on your phone:</p>
            <Qr text={address()} />
            <p className="ty-address" data-address>
              {address()}
            </p>
            <div className="ty-btns">
              <a className="lab-btn primary ty-go" href="#/watch">
                Watch a run
              </a>
              <button type="button" className="lab-btn" data-again onClick={() => void begin()}>
                Try again
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}

/** this page's address as a code a phone's camera opens */
function Qr({ text }: { text: string }) {
  const { d, n } = useMemo(() => {
    const q = encode(text, { ecc: 'M', border: 2 })
    let path = ''
    q.data.forEach((row, yy) => row.forEach((on, xx) => on && (path += `M${xx} ${yy}h1v1h-1z`)))
    return { d: path, n: q.size }
  }, [text])
  return (
    <svg className="ty-qr" viewBox={`0 0 ${n} ${n}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#f3ece0" />
      <path d={d} fill="#14110d" />
    </svg>
  )
}
