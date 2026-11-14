// The tune step: five faces, one at a time, the person's own face as a wireframe in the middle, a ring that
// fills while the face is held, then the model and its own honest check.
// The camera picture is never drawn: only landmarks.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { MUSCLES } from '@shared/types'
import type { LiveMessage, TuneFace } from '@shared/types'
import type { Sense } from '../sense'
import { FLOW_STEPS, TuneRun } from './flow'
import type { FlowState, FlowStep } from './flow'
import { createReader, typicalMax } from './model'
import type { PersonalModel, Reader } from './model'
import { MUSCLE_NAMES, MuscleMap } from './MuscleMap'
import { loadModel } from './store'
import './tune.css'

export interface TuneFlowProps {
  /** already started (camera on). TuneFlow turns detail on and off itself. */
  sense: Sense
  /** the person tapped Done on the result. The model is not saved here: call saveModel(model). */
  onDone(model: PersonalModel): void
  onSkip(): void
  /** `tune` live messages for the big-screen mirror */
  onLive?(msg: LiveMessage): void
  /** hall QR flow: the first tap already unlocked the camera, so keep it hands-free */
  autoStart?: boolean
}

const ASK: Record<TuneFace, { first: string; again: string; help: string }> = {
  rest: { first: 'Rest your face', again: 'Rest your face', help: 'Nothing to do. Just look here.' },
  smile: { first: 'Your biggest smile', again: 'Biggest smile', help: 'As big as it goes.' },
  sad: { first: 'Pull the corners of your mouth down', again: 'Corners of your mouth down', help: 'Like an upside-down smile.' },
  angry: { first: 'Lower your brows and bring them together', again: 'Brows down and together', help: 'Down and together.' },
  surprised: { first: 'Raise your brows high', again: 'Brows up', help: 'As high as they go.' },
}
/** how each face is named in a sentence */
const FACE_WORDS: Record<TuneFace, string> = { rest: 'resting', smile: 'smiling', sad: 'corners-down', angry: 'brows-down', surprised: 'brows-up' }
const FACE_NOW: Record<TuneFace, string> = { rest: 'Resting', smile: 'Smiling', sad: 'Corners down', angry: 'Brows down', surprised: 'Brows up' }
/** which muscle groups each face is for (MUSCLES order): they glow faintly while Vire waits for the face */
const HINT: Record<TuneFace, number[]> = { rest: [], smile: [0, 1], sad: [4], angry: [2], surprised: [3] }
/** the ranges shown on the result: the five the faces were for */
const SHOWN = [0, 1, 2, 3, 4]
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five']

/** the ring: an upright oval around the face, drawn clockwise from the top */
const OVAL = 'M50 1.4a48.6 60.6 0 1 1 0 121.2a48.6 60.6 0 1 1 0-121.2'

type Screen = 'intro' | 'run' | 'training' | 'result'

/** one <audio> element for every line: once a tap has started it, iOS lets it play the next ones */
class Voice {
  private el: HTMLAudioElement | null = null
  private missing = new Set<string>()

  play(name: string, onEnd?: () => void): void {
    let fired = false
    const done = () => {
      if (fired) return
      fired = true
      onEnd?.()
    }
    try {
      if (this.missing.has(name)) return done()
      const el = (this.el ??= new Audio())
      el.onended = done
      el.onerror = () => {
        this.missing.add(name)
        done()
      }
      el.src = new URL(`audio/vo-tune-${name}.mp3`, document.baseURI).toString()
      const p = el.play()
      if (p) p.catch(done)
    } catch {
      done()
    }
  }

  stop(): void {
    try {
      if (this.el) {
        this.el.onended = null
        this.el.onerror = null
        this.el.pause()
      }
    } catch {
      /* nothing playing */
    }
  }
}

function accuracyLine(m: PersonalModel): string {
  const faces = m.clf?.classes.length ?? 0
  if (!m.clf || !m.heldOut || m.holdout === 'none' || faces < 2) return 'Vire has your ranges, but it could not check itself this time. You can do this again any time.'
  const pct = Math.round(m.accuracy * 100)
  const how = m.holdout === 'lap' ? 'on your second takes, which it had not seen' : 'on frames it had not seen'
  return `It told your ${COUNT[faces] ?? faces} faces apart ${pct}% of the time ${how}.${m.accuracy < 0.9 ? ' That check was too shaky to use your personal model.' : ''}`
}

function missedLine(m: PersonalModel): string | null {
  const list = (m.missed ?? []).map((f) => FACE_WORDS[f])
  if (!list.length) return null
  const names = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  return list.length === 1 ? `Your ${names} face did not show on camera, so Vire left it out.` : `Your ${names} faces did not show on camera, so Vire left them out.`
}

function weakLine(m: PersonalModel): string | null {
  if (!m.perFace) return null
  let worst: TuneFace | null = null
  for (const f of Object.keys(m.perFace) as TuneFace[]) {
    const v = m.perFace[f] ?? 1
    if (v < 0.6 && (worst === null || v < (m.perFace[worst] ?? 1))) worst = f
  }
  if (!worst || worst === 'rest') return null
  return `Your ${FACE_WORDS[worst]} face looked a lot like another one, so that one is shaky.`
}

export function TuneFlow({ sense, onDone, onSkip, onLive, autoStart = false }: TuneFlowProps): JSX.Element {
  const fullSteps = sense.caps.airpodsMotion ? FLOW_STEPS : FLOW_STEPS.filter((s) => s.lap < 2)
  const shortSteps = fullSteps.filter((s) => s.face === 'rest' || s.face === 'smile')
  const [full, setFull] = useState(false)
  const steps = full ? fullSteps : shortSteps
  const [screen, setScreen] = useState<Screen>('intro')
  const [at, setAt] = useState<{ index: number; step: FlowStep } | null>(null)
  const [state, setState] = useState<FlowState>('idle')
  const [model, setModel] = useState<PersonalModel | null>(null)
  const [reads, setReads] = useState<TuneFace | null>(null)

  const cb = useRef({ onDone, onSkip, onLive })
  cb.current = { onDone, onSkip, onLive }
  const run = useRef<TuneRun | null>(null)
  const reader = useRef<Reader | null>(null)
  const voice = useRef(new Voice())
  const timers = useRef<number[]>([])
  const finished = useRef(false)
  const shown = useRef<{ screen: Screen; face: TuneFace | null; state: FlowState }>({ screen: 'intro', face: null, state: 'idle' })
  shown.current = { screen, face: at?.step.face ?? null, state }
  const now = useRef<{ mesh: Float32Array | null; muscles: number[] | null; face: TuneFace | null; ear: number | null; lastFaceAt: number }>({ mesh: null, muscles: null, face: null, ear: null, lastFaceAt: 0 })
  const scratch = useRef<number[]>(MUSCLES.map(() => 0))
  const ring = useRef<SVGPathElement>(null)
  const fills = useRef<(HTMLElement | null)[]>([])
  const earFill = useRef<HTMLElement | null>(null)

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  // the camera's frames: into the run while it is on, into the trained reader after
  useEffect(() => {
    const hadDetail = !!sense.latest().face?.detail
    sense.setDetail(true)
    // raw values while tuning: an earlier calibration must not shape the new one
    sense.setCalibration(null)
    let names: string[] = []
    const offFace = sense.on('face', (f) => {
      if (!names.length) names = sense.blendNames()
      const n = now.current
      n.lastFaceAt = performance.now()
      n.mesh = f.present && f.detail ? f.detail.mesh : null
      const r = run.current
      if (r && r.state !== 'idle' && r.state !== 'done') {
        r.face(f, names)
        // nothing lights before the person's own resting face is known: a typical range would light a face at rest
        n.muscles = r.index > 0 && r.muscles.length ? r.muscles : null
        n.face = null
      } else if (reader.current) {
        const out = reader.current.face(f, names)
        n.muscles = f.present ? out.muscles : null
        n.face = out.face ? out.face.label : null
      } else {
        n.muscles = null
        n.face = null
      }
    })
    const offHead = sense.on('head', (h) => {
      run.current?.head(h)
      if (reader.current) now.current.ear = reader.current.head(h)
    })
    const ids = timers.current
    const v = voice.current
    return () => {
      offFace()
      offHead()
      ids.forEach((id) => clearTimeout(id))
      v.stop()
      if (!hadDetail) sense.setDetail(false)
      if (!finished.current) sense.setCalibration(loadModel()?.calibration ?? null)
    }
  }, [sense])

  // ring, state and the live meters, straight to the DOM: no React render per camera frame
  useEffect(() => {
    let raf = 0
    let lastState: FlowState = 'idle'
    let lastRead: TuneFace | null = null
    let lastReadAt = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const r = run.current
      const n = now.current
      if (r) {
        if (ring.current) {
          const p = r.progress
          ring.current.style.strokeDashoffset = String(1 - p)
          // a round cap on an empty stroke still draws a dot
          ring.current.style.opacity = p > 0.004 ? '1' : '0'
        }
        // a camera that has stopped delivering frames is the same as no face
        const st = (r.state === 'wait' || r.state === 'hold') && performance.now() - n.lastFaceAt > 1500 ? 'look' : r.state
        if (st !== lastState) {
          lastState = st
          setState(st)
        }
      }
      if (shown.current.screen === 'result') {
        const m = n.muscles
        for (let i = 0; i < SHOWN.length; i++) {
          const el = fills.current[i]
          if (el) el.style.transform = `scaleX(${m ? Math.max(0, Math.min(1, m[SHOWN[i]])).toFixed(3) : 0})`
        }
        if (earFill.current) earFill.current.style.transform = `scaleX(${n.ear === null ? 0 : n.ear.toFixed(3)})`
        if (n.face !== lastRead && t - lastReadAt > 180) {
          lastRead = n.face
          lastReadAt = t
          setReads(n.face)
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  /** what the wireframe shows: the live face; a faint glow on the asked-for muscles while waiting; a sweep while training */
  const live = useCallback(() => {
    const n = now.current
    const s = shown.current
    const out = scratch.current
    const t = performance.now()
    if (s.screen === 'training') {
      for (let i = 0; i < out.length; i++) out[i] = 0.5 + 0.5 * Math.sin(t / 130 - i * 0.8)
      return { mesh: n.mesh, muscles: out }
    }
    const m = n.muscles
    for (let i = 0; i < out.length; i++) out[i] = m ? m[i] : 0
    if (s.screen === 'run' && s.face && (s.state === 'wait' || s.state === 'look')) {
      const glow = 0.2 + 0.12 * Math.sin(t / 260)
      for (const i of HINT[s.face]) if (out[i] < glow) out[i] = glow
    }
    return { mesh: n.mesh, muscles: out }
  }, [])

  const train = useCallback((r: TuneRun) => {
    setScreen('training')
    cb.current.onLive?.({ type: 'tune', step: 'training' })
    const t0 = performance.now()
    // one beat so the screen is painted before the (short) maths
    later(() => {
      let m: PersonalModel
      try {
        m = r.train()
      } catch (err) {
        console.warn('[tune] training failed', err)
        cb.current.onSkip()
        return
      }
      reader.current = createReader(m, { calibrated: false })
      later(
        () => {
          setModel(m)
          setScreen('result')
          cb.current.onLive?.({ type: 'tune', step: 'done', accuracy: m.accuracy, earAccuracy: m.earAccuracy })
          // The result copy is the honest held-out check; the old voice line claimed the model knew a face.
        },
        Math.max(0, 1500 - (performance.now() - t0)),
      )
    }, 80)
  }, [])

  const start = useCallback(() => {
    reader.current = null
    now.current.ear = null
    setModel(null)
    setAt(null)
    setState('idle')
    setScreen('run')
    const r = new TuneRun(steps)
    r.onStep = (index, step) => {
      setAt({ index, step })
      cb.current.onLive?.({ type: 'tune', step: step.face })
      if (step.lap === 0) voice.current.play(step.face)
    }
    r.onEnd = () => train(r)
    run.current = r
    let begun = false
    const begin = () => {
      if (begun || run.current !== r) return
      begun = true
      r.begin()
    }
    // the first face waits for the intro line, or starts at once when there is no audio
    voice.current.play('intro', () => later(begin, 300))
    later(begin, 5500)
  }, [steps, train])

  useEffect(() => {
    if (autoStart && screen === 'intro') start()
  }, [autoStart, screen, start])

  const skip = () => {
    voice.current.stop()
    onSkip()
  }

  const done = () => {
    if (!model) return
    finished.current = true
    voice.current.stop()
    sense.setCalibration(model.calibration)
    onDone(model)
  }

  const teachMore = () => {
    setFull(true)
    setScreen('intro')
    setModel(null)
  }

  const step = at?.step ?? null
  const kicker = !step ? 'Get ready' : step.lap === 0 ? `${at!.index + 1} of ${steps.length / 2}` : step.lap === 1 ? 'Once more' : 'Last one'
  const prompt = !step ? (full ? 'Five faces, a few seconds each' : 'Two faces, about 15 seconds') : step.lap === 0 ? ASK[step.face].first : step.lap === 1 ? ASK[step.face].again : 'One more big smile'
  const help = !step ? 'Look at the screen.' : state === 'look' ? 'Bring your face into view' : state === 'hold' ? 'Hold it there' : ASK[step.face].help
  const earPct = model && model.earAccuracy !== null ? Math.round(model.earAccuracy * 100) : null
  const weak = model ? weakLine(model) : null
  const missed = model ? missedLine(model) : null

  return (
    <div className="vt-flow" data-screen={screen} data-step={screen === 'run' ? (step?.face ?? 'intro') : screen} data-state={state} data-index={at?.index ?? -1}>
      <div className="vt-top">
        <ol className="vt-steps" aria-hidden="true">
          {steps.map((s, i) => (
            <li key={i} data-on={screen === 'training' || screen === 'result' || (at !== null && i < at.index)} data-now={screen === 'run' && at?.index === i} data-gap={i > 0 && s.lap !== FLOW_STEPS[i - 1].lap} />
          ))}
        </ol>
        {screen === 'result' ? (
          <button type="button" className="vt-skip" data-testid="tune-again" onClick={start}>
            Again
          </button>
        ) : (
          <button type="button" className="vt-skip" data-testid="tune-skip" onClick={skip}>
            Later
          </button>
        )}
      </div>

      <div className="vt-body">
        <div className="vt-stage">
          <div className="vt-ringbox">
            <MuscleMap mesh={null} muscles={null} live={live} mirrored />
            <svg className="vt-ring" viewBox="0 0 100 124" aria-hidden="true">
              <path className="vt-ring-track" d={OVAL} />
              <path ref={ring} className="vt-ring-fill" d={OVAL} pathLength={1} />
              {screen === 'run' && at && at.index > 0 && <path key={at.index} className="vt-ring-flash" d={OVAL} />}
            </svg>
          </div>
        </div>

        {screen === 'intro' && (
          <div className="vt-words">
            <h1 className="vt-title">Teach Vire your face</h1>
            <p className="vt-help">{full ? 'Teach three more (about 25 seconds).' : 'Two faces, about 15 seconds.'} Vire measures muscle movement against your own range.</p>
            <button type="button" className="vt-btn" data-testid="tune-start" onClick={start}>
              Start
            </button>
            <p className="vt-fine">Your face is drawn from points, never the picture.</p>
          </div>
        )}

        {screen === 'run' && (
          <div className="vt-words" aria-live="polite">
            <p className="vt-kicker">{kicker}</p>
            <h1 className="vt-prompt" key={at?.index ?? -1}>
              {prompt}
            </h1>
            <p className="vt-help" data-hold={state === 'hold'}>
              {help}
            </p>
          </div>
        )}

        {screen === 'training' && (
          <div className="vt-words" aria-live="polite">
            <p className="vt-kicker">One moment</p>
            <h1 className="vt-prompt">Learning your face</h1>
            <p className="vt-help">You can relax now.</p>
          </div>
        )}

        {screen === 'result' && model && (
          <div className="vt-words vt-result">
            <h1 className="vt-title">{model.accuracy < 0.9 ? 'That check was not clear enough' : 'Your own face range is ready'}</h1>
            <p className="vt-read" aria-live="polite">
              <span>Right now</span>
              <b data-on={reads !== null}>{reads ? FACE_NOW[reads] : 'Make a face'}</b>
            </p>
            <p className="vt-acc" data-testid="tune-accuracy">
              {accuracyLine(model)}
            </p>
            {missed && <p className="vt-fine">{missed}</p>}
            {weak && <p className="vt-fine">{weak}</p>}
            <ul className="vt-ranges">
              {SHOWN.map((mi, i) => {
                const r = model.muscles?.[mi]
                // drawn on a common scale, so a small smile shows as a short band: Vire reads it as the whole range all the same
                const top = r ? typicalMax(r) * 1.25 : 1
                const lo = r ? Math.max(0, Math.min(0.88, r.rest / top)) : 0
                const hi = r ? Math.max(lo + 0.08, Math.min(1, r.max / top)) : 1
                return (
                  <li key={mi} data-weak={!!r?.weak}>
                    <span>{MUSCLE_NAMES[mi]}</span>
                    <i>
                      <em style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}>
                        <u
                          ref={(el) => {
                            fills.current[i] = el
                          }}
                        />
                      </em>
                    </i>
                  </li>
                )
              })}
            </ul>
            <p className="vt-fine">Each band is your own range. Vire measures muscle movement, not a feeling.</p>
            {earPct !== null && (
              <div className="vt-ear" data-testid="tune-ear">
                <p>Your AirPods can feel your smile: right {earPct}% of the time.</p>
                <i>
                  <u ref={earFill} />
                </i>
              </div>
            )}
            {earPct === null && model.earCheck && <p className="vt-fine">Your AirPods moved too little with your smile to learn it this time. Vire keeps using the camera for it.</p>}
            <div className="vt-actions">
              {model.accuracy < 0.9 && (
                <button type="button" className="vt-btn" data-testid="tune-again-main" onClick={start}>
                  Try again
                </button>
              )}
              {!full && <button type="button" className="vt-btn" data-testid="tune-more" onClick={teachMore}>Teach three more (about 25 seconds)</button>}
              <button type="button" className={model.accuracy < 0.9 ? 'vt-btn vt-btn-secondary' : 'vt-btn'} data-testid="tune-done" onClick={done}>
                {!full ? "That's enough" : model.accuracy < 0.9 ? 'Use general ranges' : 'Done'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
