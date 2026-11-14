import { useEffect, useRef, useState } from 'react'
import type { EarEvent, EarModel2, EarRecording, EarScore } from '@shared/ear'
import { EAR_EVENTS } from '@shared/ear'
import { EarRecorder, TEACH_MS, TEACH_STEPS, trainEarModel, saveEarModel } from '../../tune/ear'
import { currentCaps, currentSense, hasMic, isMock, isShell, live, stopSession } from '../session'
import { audio } from '../audio'
import { dailyUrl } from '../daily'
import { apiUrl } from '../../shared/api'
import { loadModel, saveModel } from '../../tune'
import type { FaceCalibration } from '../../sense/types'
import { mockControl } from '../mockSense'

export interface TeachMinuteProps {
  userId: string | null
  onHome(): void
  onAgain(): void
  onCamera(): void
}

interface SearchState {
  tried: number
  state: 'idle' | 'running' | 'done'
}

interface TeachResult {
  model: EarModel2 | null
  recording: EarRecording | null
  failed: boolean
  reason: string | null
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const a = [...xs].sort((x, y) => x - y)
  return a[a.length >> 1]!
}
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const a = [...xs].sort((x, y) => x - y)
  return a[Math.max(0, Math.min(a.length - 1, Math.floor((a.length - 1) * q)))]!
}

function saveMinuteCalibration(rec: EarRecording): void {
  const faces = rec.face.filter((x) => x[1] > 0)
  if (!faces.length) return
  const restSteps = rec.steps.filter((s) => s.ask === 'rest' || s.ask === 'relax')
  const smileSteps = rec.steps.filter((s) => s.ask === 'smile')
  const inStep = (row: number[], steps: typeof rec.steps) => steps.some((s) => row[0]! >= s.t0 && row[0]! <= s.t1)
  const rest = faces.filter((x) => inStep(x, restSteps)).map((x) => x[2]!)
  const smile = faces.filter((x) => inStep(x, smileSteps)).map((x) => x[2]!)
  const browRest = faces.filter((x) => inStep(x, restSteps)).map((x) => x[5]!)
  const browAll = faces.map((x) => x[5]!)
  const calibration: FaceCalibration = {
    smile: [median(rest), Math.max(median(rest) + 0.05, quantile(smile.length ? smile : faces.map((x) => x[2]!), 0.95))],
    brow: [median(browRest), Math.max(median(browRest) + 0.05, quantile(browAll, 0.95))],
  }
  const old = loadModel()
  saveModel({
    ...(old ?? { version: 1, accuracy: 0, earAccuracy: null }),
    at: new Date().toISOString(),
    calibration,
  })
  try { currentSense()?.setCalibration(calibration) } catch { /* older sensing core */ }
}

function scoreLine(score: EarScore | undefined): string {
  if (!score || !Number.isFinite(score.auc)) return 'not read from AirPods on this minute'
  const right = Math.round(clamp(score.auc, 0.5, 1) * 10)
  const chance = Math.round(clamp(score.chance || 0.5, 0, 1) * 10)
  return `right ${right} times in 10 on parts of the minute it never saw · chance ${chance} in 10`
}

function eventName(event: EarEvent): string {
  return event === 'talk' ? 'Talk' : event.charAt(0).toUpperCase() + event.slice(1)
}

function Line({ values, color = 'var(--ember)' }: { values: number[]; color?: string }) {
  const points = values.length ? values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${50 - clamp(v, -1, 1) * 36}`).join(' ') : '0,50 100,50'
  return <svg className="va-teach-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg>
}

export default function TeachMinute({ userId, onHome, onAgain, onCamera }: TeachMinuteProps) {
  const sense = currentSense()
  const recorder = useRef<EarRecorder | null>(null)
  const startAt = useRef(0)
  const elapsed = useRef(0)
  const stepAt = useRef(0)
  const stepIndex = useRef(0)
  const doneRef = useRef(false)
  const [step, setStep] = useState(0)
  const [runMs, setRunMs] = useState(0)
  const [paused, setPaused] = useState<string | null>(null)
  const [result, setResult] = useState<TeachResult>({ model: null, recording: null, failed: false, reason: null })
  const [search, setSearch] = useState<SearchState>({ tried: 0, state: 'idle' })
  const [teacher, setTeacher] = useState<number[]>([])
  const [student, setStudent] = useState<number[]>([])

  const stepInfo = TEACH_STEPS[Math.min(step, TEACH_STEPS.length - 1)]!
  const progress = result.recording ? 1 : clamp(runMs / TEACH_MS, 0, 1)
  const demo = isMock()
  const shell = demo ? 'sim' : isShell() ? 'ios' : currentCaps()?.native ? 'ios' : 'mac'
  const values = { teacher, student }

  useEffect(() => {
    doneRef.current = false
    if (!sense || !hasMic()) {
      setResult({ model: null, recording: null, failed: true, reason: 'The camera or microphone did not start.' })
      return
    }
    const now = performance.now()
    if (isMock()) mockControl.teachStart = now
    startAt.current = now
    stepAt.current = now
    elapsed.current = 0
    stepIndex.current = 0
    const rec = new EarRecorder()
    recorder.current = rec
    rec.begin(now)
    rec.step(TEACH_STEPS[0]!.ask, now, now + TEACH_STEPS[0]!.ms)
    live.setPhase('idle')
    live.startFrames()
    live.send({ type: 'teach', state: 'step', ask: TEACH_STEPS[0]!.ask, say: TEACH_STEPS[0]!.say, index: 0, of: TEACH_STEPS.length })
    let latestFace = sense.latest().face
    let latestHead = sense.latest().head
    const offs = [
      sense.on('face', (f) => { latestFace = f; rec.face(f) }),
      sense.on('head', (h) => { latestHead = h; rec.head(h) }),
      sense.on('voice', (v) => rec.voice(v)),
    ]
    const line = window.setInterval(() => {
      if (doneRef.current) return
      const t = performance.now()
      const f = latestFace
      const h = latestHead
      const why = !f?.present ? 'Bring your face back into view. The minute will resume.' : !h || h.source !== 'airpods' ? 'Put your AirPods in. The minute will resume when they are felt.' : null
      setPaused(why)
      if (why) return
      const dt = Math.min(120, Math.max(0, t - (stepAt.current + elapsed.current)))
      elapsed.current += dt
      setRunMs(t - startAt.current)
      if (f) setTeacher((xs) => [...xs.slice(-36), clamp(f.smile, 0, 1)])
      if (h) setStudent((xs) => [...xs.slice(-36), clamp((Math.abs(h.rx ?? 0) + Math.abs(h.ry ?? 0) + Math.abs(h.rz ?? 0)) / 90, -1, 1)])
      const current = TEACH_STEPS[stepIndex.current]!
      if (elapsed.current >= current.ms) {
        const nextAt = t
        stepAt.current = t
        elapsed.current = 0
        stepIndex.current++
        if (stepIndex.current >= TEACH_STEPS.length) {
          doneRef.current = true
          const recording = rec.end({ userId, shell, ua: navigator.userAgent })
          live.send({ type: 'teach', state: 'training' })
          const model = trainEarModel(recording)
          saveEarModel(model)
          saveMinuteCalibration(recording)
          live.send({ type: 'teach', state: 'done', model })
          const enough = recording.head.length >= 20 && recording.head.at(-1)?.[0]! >= 20_000
          const faceSeen = recording.face.some((x) => x[1] > 0)
          const failed = !enough || !faceSeen
          const reason = !faceSeen ? 'The camera never saw a face.' : !enough ? 'The AirPods sent under 20 seconds of motion.' : null
          setResult({ model: failed ? null : model, recording, failed, reason })
          if (!failed) {
            void uploadAndSearch(recording, model)
          }
          return
        }
        const next = TEACH_STEPS[stepIndex.current]!
        rec.step(next.ask, nextAt, nextAt + next.ms)
        setStep(stepIndex.current)
        live.send({ type: 'teach', state: 'step', ask: next.ask, say: next.say, index: stepIndex.current, of: TEACH_STEPS.length })
        if (next.ask === 'laugh') void audio.playUrl(dailyUrl('laugh'), { gain: 1 })
      }
    }, 100)
    return () => {
      doneRef.current = true
      clearInterval(line)
      offs.forEach((off) => off())
      live.stopFrames()
      if (isMock()) mockControl.teachStart = null
      if (rec.running) rec.end({ userId, shell, ua: navigator.userAgent })
    }
  // The session is intentionally captured once for one teaching minute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const uploadAndSearch = async (recording: EarRecording, model: EarModel2) => {
    try {
      const quick = Object.fromEntries(Object.entries(model.events).map(([event, value]) => [event, value?.score]))
      const response = await fetch(apiUrl('ear/recordings'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recording, quick }) })
      const body = await response.json().catch(() => null) as { jobId?: string } | null
      if (!body?.jobId) return
      setSearch({ tried: 0, state: 'running' })
      const started = Date.now()
      const poll = async (): Promise<void> => {
        if (Date.now() - started > 180_000) { setSearch((s) => ({ ...s, state: 'done' })); return }
        try {
          const r = await fetch(apiUrl(`ear/jobs/${encodeURIComponent(body.jobId!)}`))
          const job = await r.json()
          setSearch({ tried: Number(job.tried) || 0, state: job.state === 'done' || job.state === 'failed' ? 'done' : 'running' })
          live.send({ type: 'search', job })
          if (job.state === 'done' && job.model) {
            const candidate = job.model as EarModel2
            const best = (m: EarModel2) => Object.values(m.events).reduce((n, e) => n + (e?.score.auc ?? 0), 0)
            if (best(candidate) >= best(model)) { saveEarModel(candidate); setResult((x) => ({ ...x, model: candidate })) }
            return
          }
          if (job.state === 'failed') return
        } catch { /* the search is optional */ }
        window.setTimeout(() => void poll(), 1500)
      }
      void poll()
    } catch { /* the minute is useful even when the upload is offline */ }
  }

  const finished = result.recording != null
  if (finished) {
    if (result.failed) return <div className="va-ear-result va-page"><p className="va-small">The minute stopped short</p><h1 className="va-h1">We could not check the AirPods yet.</h1><p className="va-lede">{result.reason} Try the minute again, or use the camera path.</p><div className="va-ear-actions"><button className="va-btn va-btn-primary va-btn-big" onClick={onAgain}>Do the minute again</button><button className="va-link" onClick={onCamera}>Use the camera instead</button></div></div>
    const model = result.model
    return <div className="va-ear-result va-page"><h1 className="va-h1">{model?.shell === 'sim' ? 'The script ran.' : 'Your AirPods learned you.'}</h1>{model?.shell === 'sim' && <p className="va-small">This is a script, not you.</p>}<p className="va-lede">Each line was checked on parts of the minute the model never saw.</p><div className="va-ear-results">{EAR_EVENTS.map((event) => { const score = model?.events[event]?.score; return <div className="va-ear-result-row" key={event}><div><b>{eventName(event)}</b><span>{score?.ok ? 'AirPods alone' : 'The camera keeps this one'}</span></div><p>{scoreLine(score)}</p>{score && <small>{score.ok ? 'good enough to follow' : 'not good enough to follow alone'}</small>}</div> })}</div>{search.state === 'running' && <p className="va-small">Searching for a better model in a sandbox of your own: {search.tried} tried</p>}{search.state === 'done' && search.tried > 0 && <p className="va-small">Found after {search.tried} tries.</p>}<div className="va-ear-actions"><button className="va-btn va-btn-primary va-btn-big" onClick={() => { stopSession(); onHome() }}>Go on with AirPods only</button><button className="va-link" onClick={onAgain}>Do the minute again</button></div></div>
  }

  return <div className="va-teach va-page" data-step={stepInfo.ask}>
    <header className="va-bar"><span className="va-wordmark">Vire</span><span className="va-small">Teaching minute</span></header>
    <main className="va-teach-main"><p className="va-teach-progress">{Math.round(progress * 100)}% · about one minute</p><h1 className="va-teach-say" key={stepInfo.say}>{paused ?? stepInfo.say}</h1><p className="va-lede">{paused ? 'We will pick up where we left off.' : stepInfo.hint}</p><div className="va-teach-streams"><div><span>Camera · teacher</span><Line values={values.teacher} color="var(--ch-smile)" /></div><div><span>AirPods · student</span><Line values={values.student} color="var(--ch-move)" /></div></div><div className="va-teach-bar"><span style={{ width: `${Math.max(4, progress * 100)}%` }} /></div><p className="va-small">Your camera teaches the AirPods what your movement feels like. Numbers only leave this phone.</p></main>
  </div>
}
