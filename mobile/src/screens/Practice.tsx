// One practice, start to finish: what it is, the practice itself, and what Vire read while you did it.
// With AirPods in, the reading is real: how much the head moved second by second, the heart rate before and
// after, steps on a walk, each move of the neck. Without them the practice still runs and the result shown is
// a sample, and says so. The sound is the main site's own MusicGen beds; it moves to the deeper one once the
// head has gone still.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createStepCounter } from '@web/app/doses/steps'
import type { SoundKind } from '@web/tune/session/sound'
import { PRACTICES } from '../data/sample'
import { back, go } from '../router'
import { keepAwake, onHead, sense, usePods } from '../live/pods'
import { Bed } from '../live/sound'
import { HeadView, type Pose } from '../live/views'
import { BandLine } from '../ui/charts'
import { I } from '../ui/icons'
import { Art, Btn, Chip, SampleNote, Screen, Seg, Stat, type ArtKind, type Tone } from '../ui/kit'
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
/** the cover, the colour of the light in the player, and the glow behind the result */
const LOOK: Record<string, { art: ArtKind; hue: string; hi: string; glow: Tone }> = {
  breathing: { art: 'breath', hue: '#2fa596', hi: '#b4f7e8', glow: 'voice' },
  bodyscan: { art: 'body', hue: '#7a74ee', hi: '#d6d2ff', glow: 'move' },
  sit: { art: 'sit', hue: '#dc8438', hi: '#ffd9ad', glow: 'face' },
  yoga: { art: 'stretch', hue: '#d45c8a', hi: '#ffc6dc', glow: 'heart' },
  walk: { art: 'walk', hue: '#46a877', hi: '#c9f2da', glow: 'voice' },
  winddown: { art: 'sleep', hue: '#6a80e4', hi: '#d6deff', glow: 'move' },
}
const RING = 2 * Math.PI * 97
const rise = (i: number) => ({ '--i': i }) as CSSProperties
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
  /** how the head sits right now, in one word; empty without AirPods */
  still: string
}

/**
 * A believable result for a phone with no AirPods, clearly marked as a sample on the screen. Steady through the
 * first third, a fall through the middle, steady through the last third: compare() reads the two ends, so the line
 * drawn, the two tiles and the percent all say the same fall (4.5 to 1.8 is 60%).
 */
const SAMPLE_START = 4.5
const SAMPLE_END = 1.8
function sampleMove(seconds: number): number[] {
  const third = Math.floor(seconds / 3)
  const out: number[] = []
  for (let i = 0; i < seconds; i++) {
    const level = SAMPLE_START + (SAMPLE_END - SAMPLE_START) * ease((i - third + 1) / (seconds - 2 * third + 1))
    out.push(level + 0.2 * Math.sin(i * 1.7) + 0.1 * Math.sin(i * 0.61))
  }
  // the small wobble must not pull either end off its value: set each end's mean, over the stretch compare() reads
  const n = Math.max(4, Math.min(20, third))
  const settle = (from: number, to: number, want: number, read: number[]) => {
    const d = want - mean(read)
    for (let i = from; i < to; i++) out[i] += d
  }
  settle(0, third, SAMPLE_START, out.slice(0, n))
  settle(seconds - third, seconds, SAMPLE_END, out.slice(-n))
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
  const look = LOOK[p.id] ?? LOOK.breathing
  const hue = { '--hue': look.hue, '--hi': look.hi } as CSSProperties
  const pods = usePods()
  const [phase, setPhase] = useState<'intro' | 'run' | 'done'>('intro')
  const [len, setLen] = useState<'short' | 'full'>('full')
  const [view, setView] = useState<View>({ left: p.minutes * 60, word: '', line: '', beat: '', n: 0, done: [], rest: false, still: '' })
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
      const next: View = { left: Math.ceil((total - el) / 1000), word, line, beat: bpm.current != null ? `${bpm.current}` : '', n: idx, done: done.slice(), rest, still: on && mode !== 'walk' ? (recent < 3.2 ? 'Still' : recent < 9 ? 'Settling' : 'Moving') : '' }
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
      <Screen flow className="pr-flow">
        <div className="pr-intro" style={hue}>
          <button className="pr-close" onClick={() => back('/practices')} aria-label="Close">
            <I.close size={20} />
          </button>
          <Art kind={look.art} h={348} className="pr-hero" />
          <div className="pad pr-intro-body">
            <div className="rise" style={rise(1)}>
              <div className="pills">
                <span className="pill num">
                  <I.clock size={14} /> {len === 'short' ? '1 min' : `${p.minutes} min`}
                </span>
                {pods.on ? (
                  <span className="pill pr-pill-live">
                    <span className="dot is-pulse" /> AirPods in
                  </span>
                ) : (
                  <span className="pill">
                    <I.airpods size={14} /> No AirPods
                  </span>
                )}
              </div>
              <h1 className="title-xl" style={{ marginTop: 14 }}>
                {p.name}
              </h1>
              <p className="lede" style={{ marginTop: 8 }}>
                {p.line}
              </p>
            </div>
            <ol className="pr-steps rise" style={rise(2)}>
              {p.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="small rise" style={{ ...rise(3), marginTop: 14 }}>
              {pods.on ? `Vire reads: ${p.reads.charAt(0).toLowerCase()}${p.reads.slice(1)}` : 'The practice runs without AirPods. The result at the end is a sample.'}
            </p>
          </div>
          <div className="pr-cta rise" style={rise(4)}>
            <Seg
              value={len}
              onChange={setLen}
              options={[
                { id: 'full', label: `${p.minutes} min` },
                { id: 'short', label: '1 min' },
              ]}
            />
            <Btn wide icon="play" onClick={begin}>
              Begin
            </Btn>
          </div>
        </div>
      </Screen>
    )
  }

  if (phase === 'run') {
    const total = len === 'short' ? 60 : p.minutes * 60
    const gone = Math.max(0, Math.min(1, (total - view.left) / total))
    // what Vire says, large: the breath, the part of the body, the move
    const say = mode === 'breathe' ? (view.word === 'Out' ? 'Breathe out' : 'Breathe in') : mode === 'walk' ? TIP.walk : view.word
    return (
      <Screen flow className="pr-flow">
        <div className={`pr-run is-${mode}`} style={hue}>
          <div className="pr-run-top">
            <span className="pr-run-name">{p.name}</span>
            <span className="pr-run-left num" aria-label="Time left">
              {clock(view.left)}
            </span>
          </div>

          <div className="pr-stage">
            <svg className="pr-prog" viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,240,220,0.09)" strokeWidth="2" />
              <circle className="pr-prog-fill" cx="100" cy="100" r="97" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - gone)} transform="rotate(-90 100 100)" />
            </svg>
            {mode === 'moves' ? (
              <div className="pr-headview">
                <HeadView pose={pose} smile={zero} size={232} />
              </div>
            ) : (
              <>
                <div className="pr-c is-3" ref={c3} />
                <div className="pr-c is-2" ref={c2} />
                <div className="pr-c is-1" ref={c1} />
                {mode === 'walk' && (
                  <div className="pr-count num">
                    {view.word || '0'}
                    <small>steps</small>
                  </div>
                )}
              </>
            )}
          </div>
          {mode === 'moves' && (
            <div className="pr-ticks" aria-hidden="true">
              {MOVES.map((m, i) => (
                <i key={m.word} className={view.done[i] ? 'is-done' : i === view.n ? 'is-now' : ''} />
              ))}
            </div>
          )}

          <div className="pr-say">
            <div className={`pr-word voice ${view.rest ? 'is-rest' : ''}`} key={`w${say}`}>
              {say}
            </div>
            <p className="pr-line" key={`l${view.line}`}>
              {view.line}
            </p>
          </div>

          <div className="pills pr-live">
            {pods.on ? (
              <span className="pill pr-pill-live">
                <span className="dot is-pulse" /> AirPods
              </span>
            ) : (
              <span className="pill">
                <I.airpods size={14} /> No AirPods
              </span>
            )}
            {view.beat && (
              <span className="pill num pr-pill-heart">
                <I.heart size={14} /> {view.beat} bpm
              </span>
            )}
            {view.still && (
              <span className="pill">
                <I.move size={14} /> {view.still}
              </span>
            )}
          </div>

          <div className="pr-end">
            <button className="pr-finish" onClick={() => stop.current(false)}>
              Finish
            </button>
            <p className="small pr-sound">{sound ? 'Sound made by MusicGen on Modal' : ' '}</p>
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
  // a walk with no AirPods has nothing to show: no steps were felt, and a walk has no stillness to sample
  const blank = mode === 'walk' && !r.real
  const said = blank
    ? 'No steps counted without AirPods.'
    : mode === 'walk'
      ? `${r.steps} steps${r.cadence ? `, at about ${Math.round(r.cadence)} a minute` : ''}.`
      : mode === 'moves' && r.real
        ? `${r.moves} ${r.moves === 1 ? 'move' : 'moves'}, read from how your head tipped and turned.`
        : r.real
          ? sentence
          : `Head movement fell by ${pct}% from start to end.`
  // the one number: what changed
  const big =
    mode === 'walk'
      ? r.real
        ? { v: String(r.steps), u: 'steps' }
        : { v: clock(r.seconds), u: 'walked' }
      : mode === 'moves' && r.real
        ? { v: String(r.moves), u: r.moves === 1 ? 'move' : 'moves' }
        : c && Math.abs(c.pct) >= 0.12
          ? { v: `${pct}%`, u: c.pct > 0 ? 'stiller' : 'more movement' }
          : { v: clock(r.seconds), u: 'practised' }
  const hr = r.hr0 != null && r.hr1 != null

  return (
    <Screen flow glow={look.glow}>
      <div className="pad pr-done">
        <div className="pr-done-top rise" style={rise(0)}>
          {r.real ? (
            <Chip tone="live" dot>
              From your AirPods
            </Chip>
          ) : (
            <Chip>{blank ? 'No AirPods' : 'Sample result'}</Chip>
          )}
          <span className="pr-done-what num">
            {p.name} · {clock(r.seconds)}
          </span>
        </div>
        <h1 className="title-l rise" style={rise(1)}>
          {r.full ? 'Done.' : 'Stopped early.'}
        </h1>
        <div className="big-num pr-big rise" style={rise(1)}>
          {big.v}
          <small>{big.u}</small>
        </div>
        <p className="pr-result voice rise" style={rise(2)}>
          {said}
        </p>

        {bins.length > 3 && mode !== 'walk' && (
          <div className="card pr-chart rise" style={rise(3)}>
            <BandLine x={xs} y={bins} tone="move" fmtX={(s) => clock(s)} fmtY={(v) => `${v.toFixed(1)}° a second`} height={150} />
            <p className="small" style={{ marginTop: 8 }}>
              How much your head moved, through the practice.
            </p>
          </div>
        )}

        {((c && mode !== 'walk') || hr || (mode === 'walk' && r.real)) && (
          <div className="stat-grid pr-stats rise" style={rise(4)}>
            {c && mode !== 'walk' && (
              <>
                <Stat icon="move" tone="move" label="At the start" value={c.a.toFixed(1)} unit="° a sec" sub="head movement" />
                <Stat icon="move" tone="move" label="At the end" value={c.b.toFixed(1)} unit="° a sec" sub="head movement" />
              </>
            )}
            {mode === 'walk' && r.real && (
              <>
                <Stat icon="walk" tone="move" label="Pace" value={r.cadence ? Math.round(r.cadence) : '0'} unit="steps a min" />
                <Stat icon="clock" label="Time" value={clock(r.seconds)} unit="min" />
              </>
            )}
            {hr && <Stat wide icon="heart" tone="heart" label="Heart rate" value={`${r.hr0} to ${r.hr1}`} unit="bpm" sub="At the start and at the end, from your AirPods" />}
          </div>
        )}
        {!r.real && <SampleNote>{blank ? 'With AirPods in, Vire counts your steps.' : 'Sample result. With AirPods in, this is your own head, second by second.'}</SampleNote>}

        <div className="pr-felt rise" style={rise(5)}>
          <h2 className="title-m">How do you feel now?</h2>
          <div className="pr-felt-row">
            {['Tenser', 'Same', 'Calmer', 'Much calmer'].map((f) => (
              <button key={f} className={`pr-pick ${felt === f ? 'is-on' : ''}`} aria-pressed={felt === f} onClick={() => setFelt(f)}>
                {f}
              </button>
            ))}
          </div>
          <p className="small" style={{ marginTop: 12 }}>
            Vire keeps what calms you and offers it first next time.
          </p>
        </div>

        <div className="pr-go rise" style={rise(6)}>
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
