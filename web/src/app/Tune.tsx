// The tune step in the app: TUNE's flow on the real camera, a scripted stand-in on demo signals.
// Whatever happens inside it, the person ends up on the next screen: a tune step that fails is a tune step skipped.
import { Component, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MUSCLES, TUNE_FACES } from '@shared/types'
import type { TuneFace } from '@shared/types'
import { MuscleMap, TuneFlow, clearModel, saveModel } from '../tune'
import { mockControl } from './mockSense'
import { scriptMuscles } from './personal'
import { currentSense, isMock, live, reapplyModel } from './session'

class Guard extends Component<{ onFail(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.warn('[app] the tune step failed', e)
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

interface Props {
  /** a model was trained and saved (or the scripted step ran to its end) */
  onDone(): void
  onSkip(): void
  autoStart?: boolean
}

export default function TuneStep({ onDone, onSkip, autoStart = false }: Props) {
  const sense = currentSense()
  const box = useRef<HTMLDivElement>(null)
  const over = useRef(false)
  const end = (fn: () => void) => {
    if (over.current) return
    over.current = true
    fn()
  }

  useEffect(() => {
    if (!sense) {
      end(onSkip)
      return
    }
    // the big screen watches the faces being made: numbers and wireframe flow for as long as the step is up
    live.setTuning(true)
    live.startFrames()
    // a tune step that draws nothing must not leave the person on an empty screen
    const id = window.setTimeout(() => {
      if (box.current && box.current.childElementCount === 0) end(onSkip)
    }, 1500)
    const hallLimit = autoStart ? window.setTimeout(() => end(onSkip), 15000) : 0
    return () => {
      clearTimeout(id)
      if (hallLimit) clearTimeout(hallLimit)
      live.setTuning(false)
      live.stopFrames()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!sense) return null
  return (
    <div className="va-tune" ref={box}>
      <Guard onFail={() => end(onSkip)}>
        {isMock() ? (
          <MockTune onDone={() => end(onDone)} onSkip={() => end(onSkip)} />
        ) : (
          <TuneFlow
            sense={sense}
            onDone={(model) =>
              end(() => {
                // The held-out second take is the honesty gate. Below 90% the model is not trusted,
                // so the reader stays on the population ranges until the person tries again.
                if (model.accuracy >= 0.9) saveModel(model)
                else clearModel()
                reapplyModel()
                onDone()
              })
            }
            onSkip={() => end(onSkip)}
            autoStart={autoStart}
            onLive={live.send}
          />
        )}
      </Guard>
    </div>
  )
}

// ---- demo signals: the scripted person makes the five faces ----

/** MUSCLES order: smile, cheek, browDown, browUp, frown, jaw, eyes, nose */
const SCRIPT: Record<TuneFace, number[]> = {
  rest: [0.05, 0.04, 0.04, 0.03, 0.03, 0.03, 0.08, 0.02],
  smile: [0.9, 0.7, 0.03, 0.05, 0, 0.15, 0.3, 0.2],
  sad: [0.02, 0.03, 0.35, 0.25, 0.8, 0.03, 0.15, 0.05],
  angry: [0.03, 0.12, 0.9, 0, 0.35, 0.05, 0.4, 0.55],
  surprised: [0.06, 0.03, 0, 0.9, 0.02, 0.6, 0, 0.03],
}
const ASK: Record<TuneFace, string> = {
  rest: 'Rest your face.',
  smile: 'Make your biggest smile.',
  sad: 'Pull the corners of your mouth down.',
  angry: 'Pull your eyebrows together and down.',
  surprised: 'Lift your eyebrows.',
}

function MockTune({ onDone, onSkip }: Props) {
  const faces = TUNE_FACES.slice(0, 2)
  const [step, setStep] = useState<TuneFace | 'training' | 'done'>('rest')
  const [muscles, setMuscles] = useState<number[]>(() => [...SCRIPT.rest])
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    let i = 0
    let want = SCRIPT.rest
    const now = [...SCRIPT.rest]
    const ids: number[] = []
    const next = () => {
      if (i < faces.length) {
        const f = faces[i++]
        mockControl.face = f
        want = SCRIPT[f]
        setStep(f)
        live.send({ type: 'tune', step: f })
        ids.push(window.setTimeout(next, 1700))
      } else if (i === TUNE_FACES.length) {
        i++
        mockControl.face = null
        want = SCRIPT.rest
        setStep('training')
        live.send({ type: 'tune', step: 'training' })
        ids.push(window.setTimeout(next, 800))
      } else {
        setStep('done')
        // scripted signals are nobody's face: no model is kept and no accuracy is claimed
        live.send({ type: 'tune', step: 'done' })
        ids.push(window.setTimeout(() => done.current(), 1500))
      }
    }
    ids.push(window.setTimeout(next, 300))
    const ease = window.setInterval(() => {
      const t = performance.now() / 1000
      for (let k = 0; k < MUSCLES.length; k++) now[k] += (want[k] - now[k]) * 0.35
      const out = now.map((x, k) => Math.max(0, Math.min(1, x * (1 + 0.04 * Math.sin(t * 6 + k)))))
      scriptMuscles(out)
      setMuscles(out)
    }, 80)
    return () => {
      ids.forEach((id) => clearTimeout(id))
      clearInterval(ease)
      mockControl.face = null
      scriptMuscles(null)
    }
  }, [])

  const n = step === 'training' || step === 'done' ? faces.length : faces.indexOf(step)
  return (
    <div className="va-tune-mock" data-step={step}>
      <div className="va-tune-top">
        <p className="va-dose-title">Teach Vire your face</p>
        <button className="va-btn va-btn-ghost va-tune-skip" onClick={onSkip}>
          Skip
        </button>
      </div>
      <MuscleMap mesh={null} muscles={muscles} className="va-tune-map" />
      <div className="va-stage-words" aria-live="polite">
        <p className="va-stage-line" key={step}>
          {step === 'training' ? 'Learning your range…' : step === 'done' ? 'That’s the two faces.' : ASK[step]}
        </p>
        <p className="va-stage-sub">
          {step === 'done' ? 'With a real camera, Vire now reads every smile against your own biggest one.' : 'Scripted demo: no camera, no face is learned.'}
        </p>
      </div>
      <ol className="va-tune-dots" aria-hidden="true">
        {faces.map((f, k) => (
          <li key={f} data-on={k < n} data-now={k === n}>
            {f}
          </li>
        ))}
      </ol>
    </div>
  )
}
