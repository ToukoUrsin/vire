// The teaching minute. The camera shows the AirPods what this person's nod, head shake and smile look like;
// 13 small models are made on the phone, then a wider search runs in a Modal Sandbox of the person's own.
// The minute, the training and the check are the main site's own code (web/src/tune/ear), not a copy of it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { fullMinutes, teaches, thin, type EarEvent, type EarJob, type EarModel2, type EarRecording, type EarScore, type EarStored } from '@shared/ear'
import { api } from '@web/shared/api'
import { postNative } from '@web/sense/native'
import { EarRecorder, TEACH_MS, TEACH_ROUNDS, TEACH_STEPS, adoptSearch, earKey, keepMinute, listMinutes, scoreModelOn, syncMinutes, trainEarModel } from '@web/tune/ear'
import { go } from '../router'
import { currentModel, inApp, keepAwake, keepModel, onHead, sense, usePods, wakePods } from '../live/pods'
import { MotionStrip } from '../live/views'
import { I } from '../ui/icons'
import { Badge, Btn, Chip, Head, Row, RunsOn, Screen, Section } from '../ui/kit'
import './train.css'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** nods, head shakes and smiles */
const list = (a: string[]): string => (a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)
const speed = () => {
  try {
    return Math.max(1, Number(localStorage.getItem('vire.ears.speed')) || 1)
  } catch {
    return 1
  }
}
function countKept(all: EarRecording[]): number {
  const taught = all.filter(teaches).sort((a, b) => a.at.localeCompare(b.at))
  return taught.length ? fullMinutes(taught, taught[taught.length - 1]).length : 0
}

export const NAMES: Record<string, string> = { nod: 'Nod', shake: 'Head shake', smile: 'Smile', laugh: 'Laugh', talk: 'Talking' }
const SHOWN: EarEvent[] = ['nod', 'shake', 'smile']
type Phase = 'intro' | 'starting' | 'minute' | 'working' | 'done'
type Stage = 'wait' | 'busy' | 'ok' | 'fail'
interface Search {
  state: EarJob['state']
  tried: number
  seconds: number
  minutes: number
  board: EarJob['board']
  error?: string
}
interface Result {
  rec: EarRecording
  /** the model from the earlier minutes, asked about this whole new minute before anything was learned from it */
  again: Partial<Record<EarEvent, EarScore>> | null
  before: number
  minutes: number
  ms: number
}

/** one thing the model can or cannot read, with the score it got on what it never saw */
export function ScoreRow({ e, score, by }: { e: string; score: EarScore; by?: string }) {
  return (
    <div className="score">
      <Badge icon={e === 'nod' ? 'nod' : e === 'shake' ? 'shake' : 'smile'} tone={e === 'smile' ? 'face' : 'move'} />
      <div>
        <div className="score-top">
          <span className="row-title">{NAMES[e] ?? e}</span>
          <span className="score-n num">{score.auc.toFixed(2)}</span>
        </div>
        <div className="score-bar" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(1, (score.auc - 0.5) * 2)) * 100}%` }} className={score.ok ? 'is-ok' : ''} />
        </div>
        <div className="row-sub">
          {score.ok ? 'Read from the AirPods alone' : 'Not yet. The camera keeps this one'}
          {by ? ` · ${by}` : ''}
        </div>
      </div>
    </div>
  )
}

export function Train() {
  const pods = usePods()
  const videoRef = useRef<HTMLVideoElement>(null)
  const rec = useRef(new EarRecorder())
  const run = useRef(0)
  const watching = useRef(0)
  const seen = useRef({ face: false })
  const [phase, setPhase] = useState<Phase>('intro')
  const [step, setStep] = useState(0)
  const [left, setLeft] = useState(0)
  const [done, setDone] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [kept, setKept] = useState<number | null>(null)
  const [sent, setSent] = useState<Stage>('wait')
  const [made, setMade] = useState<Stage>('wait')
  const [search, setSearch] = useState<Search | null>(null)
  const [model, setModel] = useState<EarModel2 | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    let live = true
    void listMinutes().then((m) => live && setKept(countKept(m)))
    void syncMinutes()
      .then(() => listMinutes())
      .then((m) => live && setKept(countKept(m)))
      .catch(() => {})
    const offs = [
      onHead((h) => rec.current.head(h)),
      sense.on('face', (f) => {
        seen.current.face = f.present
        rec.current.face(f)
      }),
    ]
    return () => {
      live = false
      offs.forEach((off) => off())
      run.current++
      watching.current++
      sense.stop()
      // stopping the camera also tells the AirPods to stop: ask for them again, the rest of the app goes on reading
      postNative({ cmd: 'start' })
    }
  }, [])

  const take = useCallback((job: EarJob) => {
    setSearch({ state: job.state, tried: job.tried, seconds: job.seconds, minutes: job.minutes ?? 1, board: job.board ?? [], ...(job.error ? { error: job.error } : {}) })
    if (job.state !== 'done' || !job.model) return
    const merged = adoptSearch(currentModel(), job.model)
    if (merged) {
      keepModel(merged)
      setModel(merged)
    }
    const mine = currentModel()
    if (!job.landedAt && mine?.by === 'sandbox' && mine.at === job.model.at) void api(`ear/jobs/${job.id}/landed`, {}).catch(() => {})
  }, [])
  const watch = useCallback(
    async (id: string) => {
      const token = ++watching.current
      for (let i = 0; i < 240 && token === watching.current; i++) {
        try {
          const job = await api<EarJob>(`ear/jobs/${id}`)
          if (token !== watching.current) return
          take(job)
          if (job.state === 'done' || job.state === 'failed') return
        } catch {
          /* the network blinked: ask again */
        }
        await wait(1000)
      }
    },
    [take],
  )

  const minute = useCallback(async () => {
    if (!videoRef.current) return
    const token = ++run.current
    watching.current++
    setError(null)
    setResult(null)
    setSearch(null)
    setSent('wait')
    setMade('wait')
    setPhase('starting')
    const awake = await keepAwake()
    try {
      // the camera only: with the microphone open an iPhone may put the AirPods in call mode, and they then send
      // a few motion samples a second instead of 50
      await sense.start({ video: videoRef.current, audio: false })
    } catch (e) {
      awake()
      setPhase('intro')
      setError((e as Error)?.message || 'The camera did not start.')
      return
    }
    for (let i = 0; i < 100 && !seen.current.face && token === run.current; i++) await wait(100)
    if (token !== run.current) return awake()
    const r = rec.current
    r.begin(performance.now())
    setPhase('minute')
    const total = TEACH_MS / speed()
    const began = performance.now()
    for (let i = 0; i < TEACH_STEPS.length; i++) {
      const s = TEACH_STEPS[i]
      setStep(i)
      const t0 = performance.now()
      const ms = s.ms / speed()
      while (performance.now() - t0 < ms) {
        setLeft(Math.ceil((ms - (performance.now() - t0)) / 1000))
        setDone(Math.min(1, (performance.now() - began) / total))
        await wait(100)
        if (token !== run.current) return awake()
      }
      r.step(s.ask, t0, performance.now())
    }
    const recording = r.end({ userId: null, shell: inApp() ? 'ios' : 'mac', ua: navigator.userAgent })
    sense.stop()
    postNative({ cmd: 'start' })
    awake()
    setPhase('working')
    setSent('busy')
    await wait(50)
    // the minute is sent first: whatever the training does, the recording is safe
    let stored: (EarStored & { jobId?: string }) | null = null
    try {
      stored = await api<EarStored & { jobId?: string }>('ear/recordings', { recording, key: earKey() })
      setSent('ok')
    } catch (e) {
      setSent('fail')
      setError(`The minute was not sent, so the wider search cannot run: ${(e as Error)?.message ?? e}`)
    }
    if (stored?.jobId) void watch(stored.jobId)
    let mine: EarRecording[] = [recording]
    try {
      await keepMinute(recording, stored?.id ?? null)
      await syncMinutes(4000)
      const all = await listMinutes()
      mine = fullMinutes([...all.filter((x) => x.at !== recording.at), recording], recording).filter(teaches)
      setKept(countKept(all))
    } catch (e) {
      console.error('[train] earlier minutes not read', e)
    }
    setMade('busy')
    await wait(80)
    let next: EarModel2 | null = null
    let again: Result['again'] = null
    let before = 0
    const t0 = performance.now()
    try {
      const old = currentModel()
      if (old && old.shell !== 'sim' && old.at !== recording.at) {
        const got = scoreModelOn(old, recording)
        if (Object.keys(got).length) {
          again = got
          before = old.minutes ?? 1
        }
      }
      next = trainEarModel(mine)
      setMade('ok')
    } catch (e) {
      setMade('fail')
      setError(`Training stopped: ${(e as Error)?.message ?? e}`)
    }
    if (token !== run.current) return
    if (next && Object.keys(next.events).length) {
      // the sandbox may already have answered while the phone was still training: keep the better of the two
      const cur = currentModel()
      const merged = cur && cur.by === 'sandbox' && cur.at >= recording.at ? cur : next
      keepModel(merged)
      setModel(merged)
    }
    setResult({ rec: recording, again, before, minutes: mine.length, ms: Math.round(performance.now() - t0) })
    await wait(650)
    if (token === run.current) setPhase('done')
  }, [watch])

  const s = TEACH_STEPS[step]
  const round = Math.min(TEACH_ROUNDS, Math.floor(Math.max(0, step - 1) / 8) + 1)
  const live = phase === 'starting' || phase === 'minute'
  const shown = model ? SHOWN.filter((e) => model.events[e]) : []
  const okNames = shown.filter((e) => model!.events[e]!.score.ok)
  const searching = search && (search.state === 'queued' || search.state === 'running')

  return (
    <Screen nav="Teach your AirPods" flow backTo="/you" className={live ? 'train-live' : ''}>
      <div className="train-bar" style={{ opacity: phase === 'minute' ? 1 : 0 }}>
        <i style={{ width: `${done * 100}%` }} />
      </div>

      {/* the camera's picture never leaves this element */}
      <div className={`train-cam ${live ? 'is-on' : ''}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        {phase === 'minute' && (
          <span className="train-round">
            <Chip>
              Round {round} of {TEACH_ROUNDS}
            </Chip>
          </span>
        )}
      </div>

      {phase === 'intro' && (
        <>
          <Head title="Teach your AirPods" sub="65 seconds. The camera shows your AirPods what your nod, your head shake and your smile look like. After that they read them on their own." />
          <Section i={1}>
            <div className="group">
              <Row icon="airpods" tone={pods.on ? 'ember' : 'plain'} title="AirPods" sub={pods.on ? `In. ${pods.hz} samples a second` : pods.app ? 'Put them in. They show up here by themselves' : 'Not connected on this device'} right={pods.on ? <Chip tone="live" dot pulse>Live</Chip> : undefined} />
              <Row icon="camera" title="Camera" sub="For this minute only. No picture leaves the phone, only numbers" />
              <Row icon="box" title="Your own sandbox" sub="The model is searched for on Modal, in a box of its own with the network blocked" />
            </div>
            {kept != null && kept > 0 && (
              <p className="small" style={{ marginTop: 12 }}>
                {kept} {kept === 1 ? 'minute' : 'minutes'} taught so far. Each one makes the model better.
              </p>
            )}
            {error && (
              <p className="train-error" role="alert">
                {error}
              </p>
            )}
          </Section>
          <div className="pad train-go">
            <Btn wide onClick={() => void minute()} disabled={!pods.on}>
              Start the minute
            </Btn>
            {!pods.on && !pods.app && (
              <>
                <Btn wide kind="quiet" onClick={() => void wakePods().then((ok) => !ok && setError('Vire Ears did not answer on this Mac. On an iPhone, open Vire in the Vire app.'))}>
                  Connect AirPods on this Mac
                </Btn>
                <Btn wide kind="ghost" onClick={() => go('/live', { replace: true })}>
                  No AirPods here? Try it with the camera
                </Btn>
              </>
            )}
          </div>
        </>
      )}

      {phase === 'starting' && (
        <div className="pad train-ask">
          <p className="train-word">Look at the screen</p>
          <p className="lede">It starts when the camera sees your face.</p>
        </div>
      )}

      {phase === 'minute' && s && (
        <>
          <div className="pad train-ask" key={step}>
            <p className="train-word">{s.say}</p>
            <p className="lede">
              {s.hint} <span className="num train-left">{left}</span>
            </p>
          </div>
          <div className="pad train-strip">
            <div className="train-strip-head">
              <span className="small">What your AirPods feel</span>
              <span className="small num">{pods.hz} a second</span>
            </div>
            <MotionStrip sub={onHead} />
          </div>
        </>
      )}

      {phase === 'working' && (
        <div className="pad train-work">
          <h1 className="title-l">Making your model</h1>
          <div className="group" style={{ marginTop: 22 }}>
            <WorkRow stage={sent} title="Minute saved" sub="Angles and a smile level. No picture, no sound" />
            <WorkRow stage={made} title="13 small models on this phone" sub="Each checked on a part of your minutes it never saw" />
            <WorkRow stage={search ? (search.state === 'done' ? 'ok' : search.state === 'failed' ? 'fail' : 'busy') : sent === 'ok' ? 'busy' : 'wait'} title={search?.tried ? `${search.tried} models in your sandbox` : 'A wider search in your sandbox'} sub="On Modal, network blocked" />
          </div>
          <div style={{ marginTop: 16 }}>
            <RunsOn />
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <>
          <Head
            title={okNames.length ? `Your AirPods now read your ${list(okNames.map((e) => (e === 'shake' ? 'head shakes' : `${e}s`)))}` : 'Not there yet'}
            sub={okNames.length ? 'From motion alone, camera off.' : 'One more minute usually does it.'}
          />
          {thin(result.rec) && (
            <p className="pad train-error" role="alert">
              The AirPods sent only {Math.round(result.rec.device.hz)} samples a second in this minute. They should send about 50, so do the minute again.
            </p>
          )}
          {model && (
            <Section i={1}>
              <div className="card">
                {shown.map((e) => (
                  <ScoreRow key={e} e={e} score={model.events[e]!.score} />
                ))}
                <p className="small" style={{ marginTop: 14 }}>
                  1.00 is never wrong, 0.50 is luck. Checked on a whole {model.held === 'minute' ? 'minute' : 'round'} the model never saw.
                </p>
              </div>
            </Section>
          )}
          {result.again && (
            <Section title="Before it learned from this minute" i={2}>
              <div className="card">
                <p className="body-2">
                  Your model from {result.before} earlier {result.before === 1 ? 'minute' : 'minutes'} was asked about this new one, which it had never seen.
                </p>
                <div className="train-again">
                  {SHOWN.filter((e) => result.again![e]).map((e) => (
                    <div key={e}>
                      <span className="small">{NAMES[e]}</span>
                      <span className="title-m num">{result.again![e]!.auc.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}
          <Section title="Your sandbox" i={3}>
            <div className="card">
              <div className="sandbox-top">
                <Badge icon="box" tone="ember" size={46} />
                <div>
                  <div className="title-l num">{search?.tried ?? 0}</div>
                  <div className="row-sub" style={{ marginTop: 0 }}>
                    {searching ? 'models tried so far' : search?.state === 'done' ? `models tried in ${Math.round(search.seconds)} seconds` : search?.state === 'failed' ? 'the search stopped' : 'waiting for the sandbox'}
                  </div>
                </div>
                {searching && (
                  <span style={{ marginLeft: 'auto' }}>
                    <Chip tone="ember" dot pulse>
                      Searching
                    </Chip>
                  </span>
                )}
              </div>
              <div style={{ marginTop: 14 }}>
                <RunsOn bare />
              </div>
              <p className="body-2" style={{ marginTop: 12 }}>
                Your sandbox tries hundreds of models on your {(search?.minutes ?? result.minutes) === 1 ? 'minute' : `${search?.minutes ?? result.minutes} minutes`}, with the network blocked. The best one lands on this phone by itself.
              </p>
              {!!search?.board.length && (
                <div className="board">
                  {search.board.slice(0, 4).map((b, i) => (
                    <div key={i}>
                      <span>{b.name}</span>
                      <span className="num">{b.auc.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              {search?.error && <p className="small">{search.error}</p>}
            </div>
          </Section>
          <p className="pad small" style={{ marginTop: 16 }}>
            {result.rec.head.length} AirPods samples at {Math.round(result.rec.device.hz)} a second, {result.rec.face.length} camera frames. The phone's own models took {(result.ms / 1000).toFixed(1)} s.
          </p>
          {error && (
            <p className="pad train-error" role="alert">
              {error}
            </p>
          )}
          <div className="pad train-go">
            <Btn wide onClick={() => go('/live', { replace: true, move: 'push' })}>
              See it live
            </Btn>
            <Btn wide kind="quiet" onClick={() => void minute()} disabled={!pods.on}>
              Teach another minute
            </Btn>
          </div>
        </>
      )}
    </Screen>
  )
}

function WorkRow({ stage, title, sub }: { stage: Stage; title: string; sub: string }) {
  return (
    <div className="row" style={{ opacity: stage === 'wait' ? 0.5 : 1 }}>
      <span className={`work-dot is-${stage}`}>{stage === 'ok' ? <I.check size={18} /> : stage === 'fail' ? <I.close size={16} /> : null}</span>
      <span>
        <span className="row-title num" style={{ display: 'block' }}>
          {title}
        </span>
        <span className="row-sub" style={{ display: 'block' }}>
          {sub}
        </span>
      </span>
      <span />
    </div>
  )
}
