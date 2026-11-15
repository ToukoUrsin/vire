// One practice, start to finish: what it is, the practice itself, and what Vire read while you did it.
// With AirPods in, the reading is real: how much the head moved second by second, the heart rate before and
// after, steps on a walk, each move of the neck. Without them the practice still runs and the result shown is
// a sample, and says so. The sound is the main site's own MusicGen beds; it moves to the deeper one once the
// head has gone still.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createStepCounter } from '@web/app/doses/steps'
import type { SoundKind } from '@web/tune/session/sound'
import { PRACTICES } from '../data/sample'
import { back, go } from '../router'
import { keepAwake, onHead, sense, usePods } from '../live/pods'
import { Bed } from '../live/sound'
import { HeadView, type Pose } from '../live/views'
import { BandLine } from '../ui/charts'
import { I } from '../ui/icons'
import { Badge, Btn, Chip, SampleNote, Screen, Seg } from '../ui/kit'
import './practice.css'

type Mode = 'breathe' | 'parts' | 'sit' | 'moves' | 'walk' | 'rest'
const MODE: Record<string, { mode: Mode; bed: SoundKind }> = {
  breathing: { mode: 'breathe', bed: 'breathe' },
  bodyscan: { mode: 'parts', bed: 'scan' },
  sit: { mode: 'sit', bed: 'scan' },
  yoga: { mode: 'moves', bed: 'scan' },
  walk: { mode: 'walk', bed: 'walk' },
  winddown: { mode: 'rest', bed: 'scan' },
}
const PARTS = ['Feet', 'Legs', 'Belly', 'Chest', 'Shoulders', 'Face']
type Axis = 'pitch' | 'yaw' | 'roll'
const MOVES: Array<{ word: string; axis: Axis; min: number }> = [
  { word: 'Chin to chest', axis: 'pitch', min: 13 },
  { word: 'Look up', axis: 'pitch', min: 9 },
  { word: 'Turn left', axis: 'yaw', min: 26 },
  { word: 'Turn right', axis: 'yaw', min: 26 },
  { word: 'Left ear down', axis: 'roll', min: 11 },
  { word: 'Right ear down', axis: 'roll', min: 11 },
]
const TIP: Record<Mode, string> = {
  breathe: 'In through the nose, out slowly.',
  parts: 'Rest your attention here.',
  sit: 'When the mind wanders, come back to the breath.',
  moves: 'Slowly. Stop where it pulls.',
  walk: 'Any pace.',
  rest: 'Nothing to do.',
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.round(s)) % 60).padStart(2, '0')}`
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const wrap = (d: number) => (d > 180 ? d - 360 : d < -180 ? d + 360 : d)
const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)))

interface Result {
  seconds: number
  full: boolean
  real: boolean
  /** head movement, degrees a second, one number per second */
  move: number[]
  hr0: number | null
  hr1: number | null
  steps: number
  cadence: number | null
  moves: number
}
interface View {
  left: number
  word: string
  line: string
  beat: string
  n: number
  done: boolean[]
  rest: boolean
}

/** a believable result for a phone with no AirPods, clearly marked as a sample on the screen */
function sampleMove(seconds: number): number[] {
  const out: number[] = []
  for (let i = 0; i < seconds; i++) out.push(1.7 + 5.4 * Math.exp(-i / (seconds * 0.22)) + 0.7 * Math.sin(i * 1.7) * Math.exp(-i / (seconds * 0.5)) + 0.35 * Math.sin(i * 0.61))
  return out
}

function compare(move: number[]): { a: number; b: number; pct: number } | null {
  if (move.length < 12) return null
  const n = Math.max(4, Math.min(20, Math.floor(move.length / 3)))
  const a = mean(move.slice(0, n))
  const b = mean(move.slice(-n))
  if (a <= 0) return null
  return { a, b, pct: (a - b) / a }
}

function keep(id: string, r: Result, felt?: string) {
  try {
    const key = 'vire.app.practice.v1'
    const all = JSON.parse(localStorage.getItem(key) || '[]') as unknown[]
    const c = compare(r.move)
    all.push({ id, at: Date.now(), seconds: r.seconds, real: r.real, stiller: c ? Math.round(c.pct * 100) : null, hr0: r.hr0, hr1: r.hr1, steps: r.steps, moves: r.moves, felt })
    localStorage.setItem(key, JSON.stringify(all.slice(-60)))
  } catch {
    /* private window: nothing kept */
  }
}

export function Practice({ id }: { id?: string; topic?: string }) {
  const p = PRACTICES.find((x) => x.id === id) ?? PRACTICES[0]
  const { mode, bed: bedKind } = MODE[p.id] ?? MODE.breathing
  const Icon = I[p.icon]
  const pods = usePods()
  const [phase, setPhase] = useState<'intro' | 'run' | 'done'>('intro')
  const [len, setLen] = useState<'short' | 'full'>('full')
  const [view, setView] = useState<View>({ left: p.minutes * 60, word: '', line: '', beat: '', n: 0, done: [], rest: false })
  const [result, setResult] = useState<Result | null>(null)
  const [felt, setFelt] = useState<string | null>(null)
  const [sound, setSound] = useState<string | null>(null)

  const c1 = useRef<HTMLDivElement>(null)
  const c2 = useRef<HTMLDivElement>(null)
  const c3 = useRef<HTMLDivElement>(null)
  const pose = useRef<Pose | null>(null)
  const zero = useRef(0)
  const bpm = useRef<number | null>(null)
  bpm.current = pods.bpmAge != null && pods.bpmAge < 20 ? pods.bpm : null
  const podsOn = useRef(false)
  podsOn.current = pods.on
  const stop = useRef<(full: boolean) => void>(() => {})

  const begin = useCallback(() => {
    const total = (len === 'short' ? 60 : p.minutes * 60) * 1000
    const bed = new Bed(bedKind)
    bed.bell()
    void bed.play('settle', 5).then(() => bed.info && setSound(bed.info.model))
    bed.warm('deep')
    if (pods.app) sense.setHeartSession(true)
    const t0 = performance.now()
    const move: number[] = []
    const hrs: number[] = []
    const steps = createStepCounter()
    let sum = 0
    let n = 0
    let sec = 0
    let prev: { t: number; pitch: number; yaw: number; roll: number } | null = null
    let frames = 0
    let stillFor = 0
    let deep = false
    let recent = 0
    let faded = false
    // yoga: where the head rested when this move was asked for, and which way the first of a pair went
    let moveAt = -1
    let base: { pitch: number; yaw: number; roll: number; n: number } | null = null
    let heldSince = 0
    let restUntil = 0
    let firstSign = 0
    let nowMove = 0
    let read = 0
    const done: boolean[] = []
    let ended = false
    let partAt = -1

    const offHead = onHead((h) => {
      frames++
      pose.current = { t: performance.now(), pitch: h.pitch, yaw: h.yaw, roll: h.roll }
      steps.feed(h.t, Math.hypot(h.ax, h.ay, h.az))
      let speed = 0
      if (h.rx != null && h.ry != null && h.rz != null) speed = Math.hypot(h.rx, h.ry, h.rz)
      else if (prev && h.t > prev.t) speed = (Math.hypot(h.pitch - prev.pitch, wrap(h.yaw - prev.yaw), h.roll - prev.roll) / (h.t - prev.t)) * 1000
      prev = { t: h.t, pitch: h.pitch, yaw: h.yaw, roll: h.roll }
      sum += speed
      n++
      recent += (speed - recent) * 0.02
      if (mode !== 'moves') return
      const m = MOVES[nowMove]
      const now = performance.now()
      if (!m || done[nowMove] != null || now < restUntil) return
      if (!base || base.n < 25) {
        base = base ?? { pitch: 0, yaw: h.yaw, roll: 0, n: 0 }
        base.pitch += h.pitch
        base.roll += h.roll
        base.n++
        if (base.n === 25) {
          base.pitch /= 25
          base.roll /= 25
          base.yaw = h.yaw
        }
        return
      }
      const d = m.axis === 'yaw' ? wrap(h.yaw - base.yaw) : h[m.axis] - base[m.axis]
      const second = nowMove % 2 === 1
      const ok = Math.abs(d) >= m.min && (!second || !firstSign || Math.sign(d) !== firstSign)
      if (!ok) {
        heldSince = 0
        return
      }
      if (!heldSince) heldSince = now
      if (now - heldSince > 320) {
        done[nowMove] = true
        read++
        if (!second) firstSign = Math.sign(d)
        restUntil = now + 2400
        moveAt = now
        bed.bell(true)
      }
    })

    let sleep = () => {}
    void keepAwake().then((off) => (sleep = off))
    let raf = 0
    let lastView = ''
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = performance.now()
      const el = now - t0
      if (el >= total) return finish(true)
      // every second: one number for how much the head moved in it
      while (el / 1000 >= sec + 1) {
        if (n > 5) {
          const v = sum / n
          move.push(v)
          stillFor = v < 3.2 ? stillFor + 1 : 0
        }
        sum = 0
        n = 0
        sec++
        if (bpm.current != null) hrs.push(bpm.current)
        const quiet = podsOn.current ? stillFor >= 12 : el > total * 0.4
        if (!deep && (quiet || el > total * 0.6)) {
          deep = true
          void bed.play('deep', 6)
        }
        if (mode === 'rest' && podsOn.current) {
          const fade = stillFor >= 20
          if (fade !== faded) {
            faded = fade
            bed.level(fade ? 0.22 : 1, 8)
          }
        }
      }
      // the circle: four seconds in and six out for the breathing, an even slow swell for the rest
      let b = 0.5
      let word = ''
      if (mode === 'breathe') {
        const x = (el / 1000) % 10
        b = x < 4 ? ease(x / 4) : 1 - ease((x - 4) / 6)
        word = x < 4 ? 'In' : 'Out'
      } else if (mode === 'walk') {
        b = 0.35
      } else {
        b = 0.25 + 0.5 * ease(1 - Math.abs((((el / 1000) % 12) / 6) - 1))
      }
      if (c1.current) c1.current.style.transform = `scale(${(0.34 + 0.3 * b).toFixed(4)})`
      if (c2.current) c2.current.style.transform = `scale(${(0.56 + 0.3 * b).toFixed(4)})`
      if (c3.current) c3.current.style.transform = `scale(${(0.78 + 0.22 * b).toFixed(4)})`

      let idx = 0
      let rest = false
      if (mode === 'parts') {
        idx = Math.min(PARTS.length - 1, Math.floor((el / total) * PARTS.length))
        word = PARTS[idx]
        if (idx !== partAt) {
          if (partAt >= 0) bed.bell(true)
          partAt = idx
        }
      } else if (mode === 'moves') {
        // a move that was read moves on after a short rest; one that was not gets twelve seconds
        if (done[nowMove] === true && now > restUntil) step()
        else if (done[nowMove] == null && now - moveAt > 12000) {
          done[nowMove] = false
          step()
        }
        idx = nowMove
        rest = now < restUntil
        word = rest ? 'Back to the middle' : MOVES[idx].word
      } else if (mode === 'walk') {
        word = String(steps.count())
      } else if (mode === 'sit') word = 'Breathe'
      else if (mode === 'rest') word = 'Rest'

      const on = podsOn.current && frames > 20
      const cad = steps.cadence(prev?.t ?? 0)
      const line =
        mode === 'walk'
          ? on
            ? cad
              ? `${Math.round(cad)} steps a minute`
              : 'Steps, felt in your AirPods'
            : 'Steps need AirPods in. Walk anyway.'
          : mode === 'moves'
            ? on
              ? rest
                ? 'Read from your AirPods'
                : TIP.moves
              : 'With AirPods in, Vire reads each move.'
            : mode === 'rest' && on
              ? faded
                ? 'You are still. The sound is fading.'
                : 'The sound fades once you are still.'
              : on
                ? recent < 3.2
                  ? 'Your head is still.'
                  : recent < 9
                    ? 'Settling.'
                    : 'Let your head rest.'
                : TIP[mode]
      const next: View = { left: Math.ceil((total - el) / 1000), word, line, beat: bpm.current != null ? `${bpm.current}` : '', n: idx, done: done.slice(), rest }
      const key = JSON.stringify(next)
      if (key !== lastView) {
        lastView = key
        setView(next)
      }
    }
    const step = () => {
      nowMove++
      // six moves make a round; then the round starts again
      if (nowMove >= MOVES.length) {
        nowMove = 0
        done.length = 0
      }
      base = null
      heldSince = 0
      moveAt = performance.now()
      if (nowMove % 2 === 0) firstSign = 0
    }
    moveAt = t0

    const finish = (full: boolean) => {
      if (ended) return
      ended = true
      cancelAnimationFrame(raf)
      offHead()
      sleep()
      bed.bell()
      bed.stop(3)
      if (pods.app) sense.setHeartSession(false)
      const seconds = Math.round((performance.now() - t0) / 1000)
      const real = move.length >= 8
      const r: Result = {
        seconds,
        full,
        real,
        move: real ? move : sampleMove(Math.max(24, seconds)),
        hr0: hrs.length >= 6 ? Math.round(mean(hrs.slice(0, 5))) : null,
        hr1: hrs.length >= 6 ? Math.round(mean(hrs.slice(-5))) : null,
        steps: steps.count(),
        cadence: steps.cadence(prev?.t ?? 0),
        moves: read,
      }
      setResult(r)
      setPhase('done')
    }
    stop.current = finish
    raf = requestAnimationFrame(frame)
    setPhase('run')
  }, [len, p, bedKind, mode, pods.app])

  // leaving the screen in the middle ends it quietly
  useEffect(() => () => stop.current(false), [])

  if (phase === 'intro') {
    return (
      <Screen nav="" flow backTo="/practices">
        <div className="pad prac-intro">
          <div className="prac-art rise" style={{ '--i': 0 } as React.CSSProperties} aria-hidden>
            <i />
            <i />
            <i>
              <Icon size={30} />
            </i>
          </div>
          <div className="rise" style={{ '--i': 1 } as React.CSSProperties}>
            <Chip>{len === 'short' ? '1 min' : `${p.minutes} min`}</Chip>
            <h1 className="title-xl" style={{ marginTop: 14 }}>
              {p.name}
            </h1>
            <p className="lede" style={{ marginTop: 10 }}>
              {p.line}
            </p>
          </div>
          <ol className="prac-steps rise" style={{ '--i': 2 } as React.CSSProperties}>
            {p.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="card prac-reads rise" style={{ '--i': 3 } as React.CSSProperties}>
            <Badge icon="airpods" tone={pods.on ? 'ember' : 'plain'} />
            <div>
              <div className="row-title">{pods.on ? 'Your AirPods are reading' : 'No AirPods here'}</div>
              <div className="row-sub">{pods.on ? p.reads : 'The practice runs. The result at the end is a sample.'}</div>
            </div>
          </div>
          <div className="prac-go rise" style={{ '--i': 4 } as React.CSSProperties}>
            <Seg
              value={len}
              onChange={setLen}
              options={[
                { id: 'full', label: `${p.minutes} min` },
                { id: 'short', label: '1 min' },
              ]}
            />
            <Btn wide onClick={begin}>
              Begin
            </Btn>
          </div>
        </div>
      </Screen>
    )
  }

  if (phase === 'run') {
    const total = len === 'short' ? 60 : p.minutes * 60
    return (
      <Screen flow>
        <div className="prac-run">
          <div className="train-bar" style={{ marginTop: 'calc(var(--safe-t) + 14px)' }}>
            <i style={{ width: `${(100 * (total - view.left)) / total}%` }} />
          </div>
          <div className="prac-top">
            {pods.on ? (
              <Chip tone="live" dot pulse>
                AirPods
              </Chip>
            ) : (
              <span />
            )}
            {view.beat && (
              <span className="prac-beat num">
                <I.heart size={15} />
                {view.beat}
              </span>
            )}
          </div>

          {mode === 'moves' ? (
            <div className="prac-head">
              <HeadView pose={pose} smile={zero} size={250} />
              <div className="prac-ticks">
                {MOVES.map((m, i) => (
                  <i key={m.word} className={view.done[i] ? 'is-done' : i === view.n ? 'is-now' : ''} />
                ))}
              </div>
            </div>
          ) : (
            <div className={`pacer ${mode === 'walk' ? 'is-count' : ''}`}>
              <div className="pacer-rim" />
              <div className="pacer-c" ref={c3} />
              <div className="pacer-c" ref={c2} />
              <div className="pacer-c" ref={c1} />
              {(mode === 'breathe' || mode === 'walk') && (
                <div className="pacer-word num" key={mode === 'breathe' ? `b${view.word}` : 'n'}>
                  {view.word}
                </div>
              )}
            </div>
          )}

          <div className="prac-say">
            {mode !== 'breathe' && mode !== 'walk' && (
              <div className={`prac-word ${view.rest ? 'is-rest' : ''}`} key={`w${view.word}`}>
                {view.word}
              </div>
            )}
            {mode === 'walk' && <div className="prac-unit">steps</div>}
            <div className="prac-left num">{clock(view.left)}</div>
            <p className="prac-line" key={`l${view.line}`}>
              {view.line}
            </p>
          </div>

          <div className="prac-end">
            {sound && <p className="small">Sound made by MusicGen on Modal</p>}
            <Btn kind="ghost" onClick={() => stop.current(false)}>
              Finish
            </Btn>
          </div>
        </div>
      </Screen>
    )
  }

  const r = result!
  const c = compare(r.move)
  const pct = c ? Math.round(Math.abs(c.pct) * 100) : 0
  const sentence = !c
    ? 'Too short to compare the start with the end. Stay a little longer next time.'
    : c.pct >= 0.12
      ? `Your head moved ${pct}% less at the end than at the start.`
      : c.pct <= -0.12
        ? 'Your head moved more at the end than at the start. That happens, and it still counts.'
        : 'Your head moved about the same from start to end.'
  const bins: number[] = []
  const size = Math.max(2, Math.round(r.move.length / 24))
  for (let i = 0; i + size <= r.move.length; i += size) bins.push(mean(r.move.slice(i, i + size)))
  const xs = bins.map((_, i) => i * size)

  return (
    <Screen flow>
      <div className="pad prac-done">
        <div className="prac-check rise" style={{ '--i': 0 } as React.CSSProperties}>
          <I.check size={26} />
        </div>
        <h1 className="title-xl rise" style={{ '--i': 1 } as React.CSSProperties}>
          {r.full ? 'Done.' : 'Stopped early.'}
        </h1>
        <p className="lede rise" style={{ '--i': 1, marginTop: 8 } as React.CSSProperties}>
          {clock(r.seconds)} of {p.name.toLowerCase()}.
        </p>

        <div className="card rise" style={{ '--i': 2, marginTop: 26 } as React.CSSProperties}>
          <span className={`tag ${r.real ? 'is-real' : ''}`} style={{ marginTop: 0 }}>
            {r.real ? 'From your AirPods' : 'Sample'}
          </span>
          <p className="prac-sentence">
            {mode === 'walk' && r.real
              ? `${r.steps} steps${r.cadence ? `, at about ${Math.round(r.cadence)} a minute` : ''}.`
              : mode === 'moves' && r.real
                ? `${r.moves} ${r.moves === 1 ? 'move' : 'moves'}, read from how your head tipped and turned.`
                : r.real
                  ? sentence
                  : `Head movement fell by ${pct}% from start to end.`}
          </p>
          {bins.length > 3 && mode !== 'walk' && (
            <div style={{ marginTop: 18 }}>
              <BandLine x={xs} y={bins} tone="move" fmtX={(s) => clock(s)} fmtY={(v) => `${v.toFixed(1)}° a second`} height={150} />
              <p className="small" style={{ marginTop: 8 }}>
                How much your head moved, through the practice.
              </p>
            </div>
          )}
        </div>

        {r.hr0 != null && r.hr1 != null && (
          <div className="card prac-hr rise" style={{ '--i': 3 } as React.CSSProperties}>
            <Badge icon="heart" tone="heart" size={44} />
            <div>
              <div className="row-title num">
                {r.hr0} to {r.hr1} beats a minute
              </div>
              <div className="row-sub">Heart rate at the start and at the end, from your AirPods</div>
            </div>
          </div>
        )}
        {!r.real && <SampleNote>Sample result. With AirPods in, this card shows your own head, second by second.</SampleNote>}

        <div className="prac-felt rise" style={{ '--i': 4 } as React.CSSProperties}>
          <h2 className="title-m">How do you feel now?</h2>
          <div className="prac-felt-row">
            {['Tenser', 'Same', 'Calmer', 'Much calmer'].map((f) => (
              <button key={f} className={`prac-pick ${felt === f ? 'is-on' : ''}`} onClick={() => setFelt(f)}>
                {f}
              </button>
            ))}
          </div>
          <p className="small" style={{ marginTop: 12 }}>
            Vire keeps what calms you, and offers that first the next time your day goes quiet.
          </p>
        </div>

        <div className="prac-go rise" style={{ '--i': 5 } as React.CSSProperties}>
          <Btn
            wide
            onClick={() => {
              keep(p.id, r, felt ?? undefined)
              back('/practices')
            }}
          >
            Done
          </Btn>
          <Btn wide kind="ghost" onClick={() => go('/loop')}>
            How the loop works
          </Btn>
        </div>
      </div>
    </Screen>
  )
}
