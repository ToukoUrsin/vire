// /#/tune: TUNE's own page. The camera on, the live face as a wireframe, what the reader says, and the tune step itself.
//   ?auto=1          start the camera without a tap
//   ?flow=1          go straight into the tune step
//   ?airpods=sim     feed made-up AirPods motion that follows the camera's smile (to try the ear model without AirPods)
//   ?airpods=noise   the same motion with no smile in it (the ear line must stay away)
//   ?dev=map&m=..    the built-in face with one slider per muscle group (m = eight values, bare=1 hides the sliders)
import { useEffect, useMemo, useRef, useState } from 'react'
import { MUSCLES } from '@shared/types'
import type { LiveMessage } from '@shared/types'
import { createSense } from '../sense'
import type { Sense } from '../sense'
import { Observer, createReader } from './model'
import type { PersonalModel } from './model'
import { MUSCLE_NAMES, MuscleMap } from './MuscleMap'
import { clearModel, loadModel, saveModel } from './store'
import { TuneFlow } from './TuneFlow'
import './tune.css'

export default function TuneLab() {
  const q = useMemo(() => new URLSearchParams(location.hash.split('?')[1] ?? ''), [])
  return q.get('dev') === 'map' ? <MapDemo q={q} /> : <Lab q={q} />
}

function MapDemo({ q }: { q: URLSearchParams }) {
  const preset = (q.get('m') ?? '').split(',').map(Number)
  const [m, setM] = useState<number[]>(MUSCLES.map((_, i) => preset[i] || 0))
  return (
    <div className="vt-lab" style={{ flexDirection: 'column' }}>
      <div className="vt-lab-map">
        <MuscleMap mesh={null} muscles={m} mirrored labels={q.get('labels') === '1'} />
      </div>
      {q.get('bare') !== '1' && (
        <div className="vt-lab-sliders">
          {MUSCLES.map((name, i) => (
            <label key={name}>
              {name}
              <input type="range" min={0} max={1} step={0.01} value={m[i]} onChange={(e) => setM(m.map((v, j) => (j === i ? Number(e.target.value) : v)))} />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

interface Now {
  mesh: Float32Array | null
  muscles: number[] | null
  face: string
  ear: number | null
  smile: number
  /** the latest observation (what the model sees), for the test tools */
  x: Float32Array | null
}

interface TuneDebug {
  sense: Sense
  model(): PersonalModel | null
  live: LiveMessage[]
  now: Now
}

function Lab({ q }: { q: URLSearchParams }) {
  const sense = useMemo(() => createSense(), [])
  const video = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<'off' | 'starting' | 'on' | 'failed'>('off')
  const [tuning, setTuning] = useState(false)
  const [model, setModel] = useState<PersonalModel | null>(() => loadModel())
  const [read, setRead] = useState({ face: '', ear: '' })
  const now = useRef<Now>({ mesh: null, muscles: null, face: '', ear: null, smile: 0, x: null })
  const bars = useRef<(HTMLElement | null)[]>([])
  const liveLog = useRef<LiveMessage[]>([])
  const modelRef = useRef(model)
  modelRef.current = model
  const airpods = q.get('airpods')
  const tuningRef = useRef(tuning)
  tuningRef.current = tuning

  // the tune step turns detail off behind itself when it thinks it was off: this page always wants it
  useEffect(() => {
    if (!tuning && phase === 'on') sense.setDetail(true)
  }, [tuning, phase, sense])

  const start = async () => {
    if (phase === 'starting' || phase === 'on' || !video.current) return
    setPhase('starting')
    try {
      await sense.start({ video: video.current, audio: false })
      sense.setDetail(true)
      sense.setCalibration(modelRef.current?.calibration ?? null)
      setPhase('on')
      if (q.get('flow') === '1') setTuning(true)
    } catch (err) {
      console.warn('[tune] camera failed', err)
      setPhase('failed')
    }
  }

  useEffect(() => {
    ;(window as unknown as { __tune?: TuneDebug }).__tune = { sense, model: () => modelRef.current, live: liveLog.current, now: now.current }
    if (q.get('auto') === '1' || q.get('flow') === '1') void start()
    return () => sense.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sense])

  // the reader, on every frame
  useEffect(() => {
    const reader = createReader(model)
    const observer = new Observer(model?.k ?? 0)
    let names: string[] = []
    const n = now.current
    n.ear = null
    const offFace = sense.on('face', (f) => {
      if (!names.length) names = sense.blendNames()
      n.smile = f.present ? f.smile : 0
      n.mesh = f.present && f.detail ? f.detail.mesh : null
      const out = reader.face(f, names)
      n.x = observer.observe(f, names)
      n.muscles = f.present ? out.muscles : null
      n.face = out.face ? `${out.face.label} ${Math.round(out.face.p * 100)}%` : ''
    })
    const offHead = sense.on('head', (h) => {
      n.ear = reader.head(h)
    })
    return () => {
      offFace()
      offHead()
    }
  }, [sense, model])

  // made-up AirPods motion, for trying the ear model's wiring in a browser
  useEffect(() => {
    if (phase !== 'on' || (airpods !== 'sim' && airpods !== 'noise')) return
    const push = (window as unknown as { __vireNative?: (m: unknown) => void }).__vireNative
    if (!push) return
    const g = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.87
    let pitch = 2
    let yaw = -5
    let roll = 1
    let tilt = 0
    let prev = [pitch, yaw, roll]
    const id = window.setInterval(() => {
      pitch += g() * 0.03
      yaw += g() * 0.05
      roll += g() * 0.03
      // raw smile while the tune step runs (sense uncalibrated), a share of the own range otherwise
      const s = airpods === 'sim' ? Math.max(0, Math.min(1, now.current.smile / (tuningRef.current ? 0.3 : 1))) : 0
      tilt += (s * 0.6 - tilt) * 0.5
      const p = pitch + tilt * 0.5 + g() * 0.02
      const y = yaw + g() * 0.02
      const r = roll + tilt + g() * 0.02
      const row = [performance.timeOrigin + performance.now(), p, y, r, g() * 0.003 + s * g() * 0.004, g() * 0.003 + s * 0.004, g() * 0.003, (p - prev[0]) / 0.04 + g() * 0.3 + s * g() * 1.2, (y - prev[1]) / 0.04 + g() * 0.3, (r - prev[2]) / 0.04 + g() * 0.3 + s * g() * 1.2]
      prev = [p, y, r]
      push({ k: 'head', s: [row] })
    }, 40)
    return () => clearInterval(id)
  }, [phase, airpods])
  // bars straight to the DOM; the words a few times a second
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const m = now.current.muscles
      for (let i = 0; i < MUSCLES.length; i++) {
        const el = bars.current[i]
        if (el) el.style.transform = `scaleX(${m ? m[i].toFixed(3) : 0})`
      }
      if (t - last > 200) {
        last = t
        const ear = now.current.ear === null ? '' : `${Math.round(now.current.ear * 100)}%`
        setRead((r) => (r.face === now.current.face && r.ear === ear ? r : { face: now.current.face, ear }))
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const live = useMemo(() => () => ({ mesh: now.current.mesh, muscles: now.current.muscles }), [])

  return (
    <div className="vt-lab" data-phase={phase} data-model={model ? 'yes' : 'no'}>
      <video ref={video} playsInline muted />
      {!tuning && (
        <>
          <div className="vt-lab-map">
            <MuscleMap mesh={null} muscles={null} live={live} mirrored labels />
          </div>
          <div className="vt-lab-side">
            <h2>Your face, live</h2>
            {phase !== 'on' && (
              <div className="vt-lab-btns">
                <button type="button" data-main="true" data-testid="lab-start" onClick={() => void start()}>
                  {phase === 'starting' ? 'Starting' : 'Turn the camera on'}
                </button>
              </div>
            )}
            {phase === 'failed' && <p className="vt-lab-note">The camera did not start. Check the permission and try again.</p>}
            {phase === 'on' && (
              <>
                <p className="vt-lab-read" data-testid="lab-read">
                  <span>
                    Face <b>{read.face || 'not sure'}</b>
                  </span>
                  {read.ear && (
                    <span>
                      Smile from the AirPods <b>{read.ear}</b>
                    </span>
                  )}
                </p>
                <ul className="vt-lab-bars">
                  {MUSCLE_NAMES.map((name, i) => (
                    <li key={name}>
                      <span>{name}</span>
                      <i>
                        <u
                          ref={(el) => {
                            bars.current[i] = el
                          }}
                        />
                      </i>
                    </li>
                  ))}
                </ul>
                <div className="vt-lab-btns">
                  <button type="button" data-main="true" data-testid="lab-tune" onClick={() => setTuning(true)}>
                    {model ? 'Tune again' : 'Tune my face'}
                  </button>
                  {model && (
                    <button
                      type="button"
                      onClick={() => {
                        clearModel()
                        setModel(null)
                        sense.setCalibration(null)
                      }}
                    >
                      Forget my model
                    </button>
                  )}
                </div>
                <p className="vt-lab-note" data-testid="lab-model">
                  {model
                    ? `Your model: ${Math.round(model.accuracy * 100)}% on takes it had not seen${model.earAccuracy !== null ? `, AirPods smile ${Math.round(model.earAccuracy * 100)}%` : ''}.`
                    : 'No model yet, so these are typical ranges.'}
                  {airpods === 'sim' || airpods === 'noise' ? ' AirPods motion here is made up for testing.' : ''}
                </p>
              </>
            )}
          </div>
        </>
      )}
      {tuning && (
        <TuneFlow
          sense={sense}
          onDone={(m) => {
            saveModel(m)
            setModel(m)
            setTuning(false)
          }}
          onSkip={() => setTuning(false)}
          onLive={(msg) => {
            liveLog.current.push(msg)
          }}
        />
      )}
    </div>
  )
}
