// Tune on the big screen: the asked face named, each finished face kept as a small frozen wireframe,
// then the trained model's own check. Faces are asked for, not feelings read.
import { useEffect, useRef, useState } from 'react'
import { TUNE_FACES } from '@shared/types'
import type { TuneFace } from '@shared/types'
import { MuscleMap } from '../../tune'
import { FACE_WORDS } from './Face'
import type { Shot, Stage, View } from './store'

const ASK: Record<TuneFace, { h: string; p: string }> = {
  rest: { h: 'Resting face', p: 'Look at the screen and let your face rest.' },
  smile: { h: 'Smiling', p: 'Make your biggest smile.' },
  sad: { h: 'Corners down', p: 'Pull the corners of your mouth down.' },
  angry: { h: 'Brows down', p: 'Pull your eyebrows together and down.' },
  surprised: { h: 'Brows up', p: 'Lift your eyebrows.' },
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** One kept face. MuscleMap draws it, then the drawing is frozen into a picture so five of them cost nothing. */
function Kept({ shot, label }: { shot: Shot; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [still, setStill] = useState<string | null>(null)
  useEffect(() => {
    setStill(null)
    const id = setTimeout(() => {
      const cv = box.current?.querySelector('canvas')
      if (!cv || !cv.width) return
      try {
        setStill(cv.toDataURL('image/png'))
      } catch {
        /* keep the live drawing */
      }
    }, 1300)
    return () => clearTimeout(id)
  }, [shot])
  return (
    <div ref={box}>
      {still ? <img src={still} alt={`${label} face, as a wireframe`} /> : <MuscleMap mesh={shot.mesh} muscles={shot.mus} scale={1000} />}
    </div>
  )
}

export function TunePanel({ stage, view, whose }: { stage: Stage; view: View; whose: string }) {
  const step = view.tuneStep
  const shots = stage.tune.shots
  const n = step && step !== 'training' && step !== 'done' ? TUNE_FACES.indexOf(step) + 1 : 0
  const total = step === 'rest' || step === 'smile' ? 2 : 5
  let h = 'Two faces, about 15 seconds'
  let p = ''
  if (step === 'sad' || step === 'angry' || step === 'surprised') h = 'Teach three more (about 25 seconds)'
  if (step === 'training') {
    h = 'Training'
    p = 'A small model learns these faces, on the phone, in under a second.'
  } else if (step === 'done') {
    h = 'Model trained'
    // The phone can stop after two faces or continue with the three muscle-map poses.
    p =
      view.tuneAccuracy === null
          ? `It now knows ${whose} own range for every muscle group.`
        : view.tuneAccuracy > 0.2
          ? `It reads ${whose} five faces right ${pct(view.tuneAccuracy)} of the time, on frames it had not seen.`
          : `It has ${whose} own range for every muscle group. The five faces were too alike for it to check itself this time.`
  } else if (step) {
    h = ASK[step].h
    p = ASK[step].p
  }
  return (
    <div className="sg-right sg-tune">
      <header className="sg-say" key={step ?? 'x'}>
        <h1>{h}</h1>
        <p>{p}</p>
        {n > 0 && <p className="sg-tune-count">Face {Math.min(n, total)} of {total}. Vire is learning how far {whose} own muscles go.</p>}
      </header>
      <ol className="sg-shots">
        {TUNE_FACES.map((f) => {
          const shot = shots[f]
          return (
            <li key={f} className={step === f ? 'is-now' : shot ? 'is-done' : ''}>
              {shot ? (
                <Kept shot={shot} label={FACE_WORDS[f]} />
              ) : (
                <div>
                  <span aria-hidden="true" />
                </div>
              )}
              <b>{FACE_WORDS[f]}</b>
            </li>
          )
        })}
      </ol>
      <p className="sg-foot">Muscle movement against {whose} own range, never emotion detection. 478 points. No picture leaves the phone.</p>
    </div>
  )
}
