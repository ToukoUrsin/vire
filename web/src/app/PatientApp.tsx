// Vire, the patient app: first run -> tune -> ping -> echo -> dose -> mini ping -> what Vire learned -> home.
// At #/visit the same ping serves a hall guest: one screen in, ping, echo, one screen out.
import { Component, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { DOSES } from '@shared/types'
import type { DoseKind, DoseResult, DoseSuggestion, Echo, PingKind, PingSetting, PingUpload, PingUploadExtras } from '@shared/types'
import { clearModel, loadModel } from '../tune'
import './app.css'
import { audio } from './audio'
import Breathe from './doses/Breathe'
import Forest from './doses/Forest'
import Reach from './doses/Reach'
import Smile from './doses/Smile'
import Walk from './doses/Walk'
import Wait from './doses/Wait'
import PingStage from './PingStage'
import type { PingResult } from './PingStage'
import { Confirm, DoseIntro, EchoView, Feel, FirstRun, HelpSheet, Home, Learned, PHQ2, Settings, VisitEnd, VisitIntro } from './screens'
import type { Air } from './screens'
import {
  askMotionPermission,
  attachVideo,
  currentCaps,
  currentSense,
  isMock,
  isShell,
  keepAwake,
  live,
  probeShell,
  startSession,
  stopSession,
} from './session'
import type { Identity, Notice, PingMeta, Who } from './store'
import {
  flushQueue,
  getEchoes,
  getNotice,
  getSetting,
  getSuggestion,
  getToday,
  getTodayMeta,
  checkDue,
  rememberCheck,
  postCheck,
  getReminderHour,
  isToday,
  loadIdentity,
  postDose,
  postPing,
  queued,
  register,
  resetAll,
  roomCode,
  serverSeen,
  spendSuggestion,
  setSetting,
  setReminderHourIfUnset,
  setReminderHour,
  upgradeIdentity,
} from './store'
import TuneStep from './Tune'
import { chooseStim, recordStim } from './personal'
import { getDaily, prefetchDaily } from './daily'

type After = 'ping' | 'home' | 'visitEnd'
type View =
  | { v: 'first' }
  | { v: 'visit' }
  | { v: 'tune'; then: After }
  | { v: 'home' }
  | { v: 'ping' }
  | { v: 'echo'; echo: Echo; meta: PingMeta | null; fresh: boolean }
  | { v: 'check'; echo: Echo; meta: PingMeta | null }
  | { v: 'visitEnd' }
  | { v: 'intro'; dose: DoseKind; reason?: string }
  | { v: 'dose'; dose: DoseKind }
  | { v: 'mini'; dose: DoseKind }
  | { v: 'feel'; dose: DoseKind }
  | { v: 'learned'; dose: DoseKind; result: DoseResult; pre: Echo | null; post: Echo | null; felt: -1 | 0 | 1 | null; line: string; metrics: Record<string, number> }

interface DoseRun {
  dose: DoseKind
  startedAt: string
  t0: number
  durationS: number
  metrics: Record<string, number>
  /** the sentence the dose itself held on screen at its end */
  line: string
  post: Promise<Echo | null>
}

const STAGE_VIEWS = new Set(['tune', 'ping', 'echo', 'check', 'intro', 'dose', 'mini', 'feel', 'learned'])
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? ''

/** what went wrong starting the camera, and the next step for this very phone */
function friendly(e: unknown): string {
  const name = errName(e)
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const ua = navigator.userAgent
    const how = isShell()
      ? 'Open the iPhone’s Settings, find Vire, and switch on Camera and Microphone.'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'Tap the icon at the left of the address bar, then Website Settings, and allow Camera and Microphone.'
        : /Android/.test(ua)
          ? 'Tap the icon at the left of the address bar, then Permissions, and allow Camera and Microphone.'
          : 'Allow the camera and microphone for this page in your browser’s site settings.'
    return `Vire needs the camera to see how you answer. ${how} Then tap Try again.`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Vire couldn’t find a camera on this device. Try it on a phone.'
  if (name === 'NotReadableError') return 'Another app is using the camera. Close it, then tap Try again.'
  return 'Vire couldn’t start the camera just now. Wait a moment, then tap Try again.'
}

const DOSE_VIEW: Record<DoseKind, typeof Breathe> = { breathe: Breathe, smile: Smile, forest: Forest, walk: Walk, reach: Reach, wait: Wait }

class AppGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    const saved = queued() > 0
    return <div className="va-page va-error-screen"><h1 className="va-h1">{saved ? 'Something went wrong on this screen. Your ping is saved.' : 'Something went wrong on this screen.'}</h1><button className="va-btn va-btn-primary" onClick={() => window.location.reload()}>Reload</button></div>
  }
}

export default function PatientApp() {
  // the owner's app and the hall guest's flow keep separate state: switching route starts the other one clean
  const visitor = useLocation().pathname.startsWith('/visit')
  return <AppGuard><Vire key={visitor ? 'visitor' : 'me'} visitor={visitor} /></AppGuard>
}

function Vire({ visitor }: { visitor: boolean }) {
  const who: Who = visitor ? 'visitor' : 'me'
  const [id, setId] = useState<Identity | null>(() => loadIdentity(who))
  const [view, setView] = useState<View>(() => (visitor ? { v: 'visit' } : loadIdentity(who) ? { v: 'home' } : { v: 'first' }))
  const [today, setToday] = useState<Echo | null>(() => (visitor ? null : getToday()))
  const [todayMeta, setTodayMeta] = useState<PingMeta | null>(() => (visitor ? null : getTodayMeta()))
  const [echoes, setEchoes] = useState<Echo[]>([])
  const [suggestion, setSuggestion] = useState<DoseSuggestion | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [setting, setSettingState] = useState<PingSetting>(() => getSetting())
  const [reminderHour, setReminderHourState] = useState<number | null>(() => getReminderHour())
  const [settings, setSettings] = useState(false)
  const [asking, setAsking] = useState(false)
  const [helping, setHelping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [waiting, setWaiting] = useState(() => queued())
  const [air, setAir] = useState<Air | null>(null)
  const [runKey, setRunKey] = useState(0)
  const [sync, setSync] = useState(0)
  const run = useRef<DoseRun | null>(null)
  const seenEcho = useRef(false)
  /** this phone had a person before this visit began: only then is the visitor greeted as coming back */
  const cameBack = useRef(id != null)
  const stim = useRef('laugh-1')
  /** a hall guest's latest echo, for their last screen */
  const [guestEcho, setGuestEcho] = useState<Echo | null>(null)
  const idRef = useRef(id)
  idRef.current = id

  const stage = STAGE_VIEWS.has(view.v)

  useEffect(() => {
    if (!busy) { setSlow(false); return }
    const t = window.setTimeout(() => setSlow(true), 8000)
    return () => clearTimeout(t)
  }, [busy])

  // the page behind the app follows the surface, so overscroll and the status bar match
  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const c = s.getPropertyValue(stage ? '--stage' : '--paper').trim()
    document.body.style.background = c
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c)
    return () => {
      document.body.style.background = ''
    }
  }, [stage])

  useEffect(() => {
    audio.prefetch()
    void prefetchDaily()
    // home-screen icon (index.html is not ours to edit)
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const l = document.createElement('link')
      l.rel = 'apple-touch-icon'
      l.href = new URL('icon-1024.png', document.baseURI).toString()
      document.head.appendChild(l)
    }
    return () => {
      stopSession()
      live.close()
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view.v])

  // ---- the calm screens: home data, whatever is waiting to be sent, and whether AirPods are in
  const userId = id?.userId
  const calm = view.v === 'home' || view.v === 'visit' || view.v === 'visitEnd' || view.v === 'first'
  useEffect(() => {
    if (!id || !calm) return
    let gone = false
    void (async () => {
      const real = await upgradeIdentity(id)
      if (gone) return
      if (real.userId !== id.userId) {
        setId(real)
        return
      }
      const moved = await flushQueue()
      if (gone) return
      setWaiting(queued())
      if (visitor) return
      if (moved) {
        setToday(getToday())
        setTodayMeta(getTodayMeta())
      }
      if (view.v !== 'home') return
      live.connect(roomCode(real.userId), real.name)
      const [es, n, s] = await Promise.all([getEchoes(real.userId), getNotice(real.userId), getSuggestion(real.userId)])
      if (gone) return
      setEchoes(es)
      setNotice(n)
      setSuggestion(s)
      setOffline(!serverSeen)
      setToday((t) => t ?? [...es].reverse().find((e) => isToday(e.at)) ?? null)
    })()
    return () => {
      gone = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, view.v, sync])

  useEffect(() => {
    if (!calm) return
    // something is waiting: try again when the network says it is back, and every so often regardless
    const again = () => {
      if (queued() > 0 || loadIdentity(who)?.local) setSync((n) => n + 1)
    }
    const caps = () => {
      const c = currentCaps()
      const next: Air | null = c ? { shell: isShell(), motion: c.airpodsMotion, hr: c.airpodsHr } : isShell() ? { shell: true, motion: false, hr: false } : null
      setAir((a) => (a && next && a.shell === next.shell && a.motion === next.motion && a.hr === next.hr ? a : next))
    }
    // inside the iPhone app: ask for the AirPods early, so the person hears about them before the ping
    probeShell()
    caps()
    window.addEventListener('online', again)
    const t1 = window.setInterval(again, 20000)
    const t2 = window.setInterval(caps, 1000)
    return () => {
      window.removeEventListener('online', again)
      clearInterval(t1)
      clearInterval(t2)
    }
  }, [calm, who])

  useEffect(() => {
    if (reminderHour == null || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const timer = window.setInterval(() => {
      const now = new Date()
      if (now.getHours() === reminderHour && now.getMinutes() === 0) new Notification('Vire: your daily ping', { body: 'A minute to hear your own echo.' })
    }, 60_000)
    return () => clearInterval(timer)
  }, [reminderHour])

  const leaveStage = useCallback(() => {
    live.stopFrames()
    stopSession()
    void keepAwake(false)
    run.current = null
    setBusy(false)
    // a hall guest who has seen an echo goes to the last screen; one who stopped before it, back to the first
    setView(visitor ? (seenEcho.current ? { v: 'visitEnd' } : { v: 'visit' }) : { v: 'home' })
  }, [visitor])

  /** Start the camera (and the mic). Resolves to what went wrong, or null. Call inside the tap. */
  const begin = async (withMic: boolean, demo = false): Promise<unknown> => {
    try {
      await startSession({ audio: withMic, demo })
      return null
    } catch (e) {
      // the microphone may be the one that was refused or missing: the camera alone still makes an echo, without the voice
      if (!withMic || demo) return e
      try {
        await startSession({ audio: false })
        return null
      } catch (e2) {
        return errName(e2) ? e2 : e
      }
    }
  }

  /** after Start: the face step first when this phone has not learned a face yet, then the ping */
  const enter = () => {
    stim.current = chooseStim()
    setView(visitor || !loadModel() ? { v: 'tune', then: 'ping' } : { v: 'ping' })
  }

  // ---- ping
  const beginPing = async (demo = false) => {
    setError(null)
    setBusy(true)
    const daily = getDaily()
    stim.current = daily?.laugh.source === 'generated' ? `daily-${daily.date}` : chooseStim()
    const err = await begin(true, demo)
    setBusy(false)
    if (err) setError(friendly(err))
    else setView({ v: 'ping' })
  }

  const firstStart = async (name: string, code: string, demo = false) => {
    setError(null)
    setBusy(true)
    // camera + mic are asked inside this same tap; the account is made alongside
    const started = begin(true, demo)
    const me = idRef.current ?? (await register(name, code, who))
    setId(me)
    live.connect(roomCode(me.userId), me.name)
    const err = await started
    setBusy(false)
    if (err) setError(friendly(err))
    else enter()
  }

  /** the ping was interrupted (a call, the lock screen, another app) and the person tapped "Start again" */
  const restart = async (kind: PingKind, dose?: DoseKind) => {
    const err = await begin(kind === 'full' || kind === 'hall')
    if (!err) setRunKey((k) => k + 1)
    else if (kind === 'mini' && dose) {
      // the dose itself is done: carry on without the second listen
      setView({ v: 'feel', dose })
    } else {
      leaveStage()
      setError(friendly(err))
    }
  }

  const upload = (kind: PingKind, r: PingResult): PingUpload & PingUploadExtras => {
    const caps = currentSense()?.caps
    const u: PingUpload & PingUploadExtras = {
      userId: idRef.current?.userId ?? 'local',
      kind,
      setting: getSetting(),
      startedAt: r.startedAt,
      features: r.features,
      traces: r.traces,
      stim: stim.current,
      stepReadings: r.stepReadings,
      device: {
        ua: navigator.userAgent,
        native: !!caps?.native,
        airpodsMotion: !!caps?.airpodsMotion || r.head === 'airpods',
        airpodsHr: !!caps?.airpodsHr || r.heart === 'airpods',
      },
    }
    if (r.unreadable.length) u.unreadable = r.unreadable
    if (visitor) u.visitor = true
    if (isMock() || /[?&]test=1/.test(location.search) || /[?&]test=1/.test(location.hash)) u.test = true
    return u
  }
  const metaOf = (r: PingResult): PingMeta => ({ head: r.head, heart: r.heart, unreadable: r.unreadable, why: r.why, traces: r.traces, stim: stim.current, demo: isMock() })

  const pingDone = async (r: PingResult) => {
    recordStim(stim.current, r.features)
    const u = upload(visitor ? 'hall' : 'full', r)
    const meta = metaOf(r)
    if (!visitor) setReminderHourState(setReminderHourIfUnset(new Date(r.startedAt)))
    live.stopFrames()
    stopSession() // releases the microphone: an open mic keeps AirPods in call mode
    const [echo] = await Promise.all([postPing(u, who, meta), wait(1900)])
    live.send({ type: 'echo', echo })
    seenEcho.current = true
    setWaiting(queued())
    if (!visitor) {
      setToday(echo)
      setTodayMeta(meta)
    } else setGuestEcho(echo)
    setView((v) => (v.v === 'ping' ? { v: 'echo', echo, meta, fresh: true } : v))
  }

  // ---- tune
  const openTune = async (then: After) => {
    setError(null)
    setSettings(false)
    setBusy(true)
    const err = await begin(false)
    setBusy(false)
    if (err) setError(friendly(err))
    else setView({ v: 'tune', then })
  }
  const tuneOver = (then: After) => {
    if (then === 'ping') setView({ v: 'ping' })
    else leaveStage()
  }

  // ---- dose
  const openDose = (dose: DoseKind, reason?: string) => {
    if (!DOSES.includes(dose)) return
    audio.init()
    setError(null)
    // the camera starts following the pulse now, so the dose's first breath can already be read
    void startSession({ audio: false }).catch(() => null)
    setView({ v: 'intro', dose, reason })
  }

  const beginDose = async (dose: DoseKind) => {
    setBusy(true)
    audio.init()
    // camera only: no microphone during doses or the mini ping
    const started = startSession({ audio: false }).catch(() => null)
    if (dose === 'walk' || dose === 'forest') await askMotionPermission()
    await started
    run.current = { dose, startedAt: new Date().toISOString(), t0: Date.now(), durationS: 0, metrics: {}, line: '', post: Promise.resolve(null) }
    live.setPhase('dose')
    live.startFrames()
    void keepAwake(true)
    setBusy(false)
    setView({ v: 'dose', dose })
  }

  const doseDone = (dose: DoseKind, metrics: Record<string, number>, line: string) => {
    const d = run.current
    if (!d) return leaveStage()
    d.metrics = metrics
    d.line = line
    d.durationS = Math.round((Date.now() - d.t0) / 1000)
    if (currentSense()) setView({ v: 'mini', dose })
    else setView({ v: 'feel', dose })
  }

  const miniDone = (dose: DoseKind, r: PingResult) => {
    const d = run.current
    const u = upload('mini', r)
    live.stopFrames()
    stopSession()
    void keepAwake(false)
    if (d) {
      d.post = postPing(u, who, metaOf(r)).catch(() => null)
      if (visitor) void d.post.then((e) => e && setGuestEcho(e))
    }
    setTimeout(() => setView((v) => (v.v === 'mini' ? { v: 'feel', dose } : v)), 1500)
  }

  const feelPicked = async (dose: DoseKind, felt: -1 | 0 | 1 | null) => {
    const d = run.current
    if (!d || !idRef.current) return leaveStage()
    setBusy(true)
    live.stopFrames()
    stopSession()
    // "before" is today's ping, or the last one there is
    const pre = visitor ? guestEcho : today ?? echoes[echoes.length - 1] ?? null
    const post = await d.post
    const result = await postDose({
      userId: idRef.current.userId,
      dose,
      startedAt: d.startedAt,
      durationS: d.durationS,
      prePingId: pre?.pingId ?? null,
      postPingId: post?.pingId ?? null,
      felt,
      metrics: d.metrics,
    })
    setWaiting(queued())
    // what today's echo offered was written before this dose: home asks the server again
    spendSuggestion()
    setSuggestion(null)
    setToday((t) => (t?.suggestion ? { ...t, suggestion: null } : t))
    if (!visitor && post) {
      setToday({ ...post, suggestion: null })
      setEchoes((xs) => xs.concat(post).slice(-90))
    }
    setBusy(false)
    setView({ v: 'learned', dose, result, pre, post, felt, line: d.line, metrics: d.metrics })
  }

  // ---- settings
  const changeSetting = (s: PingSetting) => {
    setSetting(s)
    setSettingState(s)
  }
  /** start over: this phone forgets the person, their echoes, what waited to be sent and the face it learned */
  const reset = () => {
    live.stopFrames()
    stopSession()
    void keepAwake(false)
    live.close()
    resetAll()
    clearModel()
    run.current = null
    setId(null)
    setToday(null)
    setTodayMeta(null)
    setEchoes([])
    setNotice(null)
    setSuggestion(null)
    setSettings(false)
    setAsking(false)
    setError(null)
    setBusy(false)
    setWaiting(0)
    seenEcho.current = false
    cameBack.current = false
    setView(visitor ? { v: 'visit' } : { v: 'first' })
  }
  const ask = () => setAsking(true)
  const openCheck = (echo: Echo, meta: PingMeta | null) => setView({ v: 'check', echo, meta })
  const finishCheck = async (items: [number, number], echo: Echo, meta: PingMeta | null) => {
    if (idRef.current) await postCheck({ userId: idRef.current.userId, at: new Date().toISOString(), items }, who)
    setWaiting(queued())
    setView({ v: 'echo', echo, meta, fresh: false })
  }

  let screen
  switch (view.v) {
    case 'first':
      screen = (
        <FirstRun busy={busy} error={error} slow={slow} onRetry={() => void firstStart('', '')} onStart={(n, c) => void firstStart(n, c)} onDemo={(n, c) => void firstStart(n, c, true)} onHold={ask} />
      )
      break
    case 'visit':
      screen = (
        <VisitIntro known={id} back={cameBack.current || seenEcho.current} busy={busy} error={error} slow={slow} onRetry={() => void firstStart('', '')} onStart={(n) => void firstStart(n, '')} onDemo={(n) => void firstStart(n, '', true)} onHold={ask} />
      )
      break
    case 'tune':
      screen = <TuneStep key={runKey} autoStart={visitor} onDone={() => tuneOver(view.then)} onSkip={() => tuneOver(view.then)} />
      break
    case 'home':
      screen = id ? (
        <Home
          id={id}
          today={today}
          todayMeta={todayMeta}
          reminderHour={reminderHour}
          echoes={echoes}
          suggestion={suggestion}
          notice={notice}
          busy={busy}
          error={error}
          offline={offline}
          waiting={waiting}
          air={air}
          onPing={() => void beginPing()}
          onDemo={() => void beginPing(true)}
          onEcho={() => today && setView({ v: 'echo', echo: today, meta: todayMeta, fresh: false })}
          onDose={openDose}
          onSettings={() => setSettings(true)}
          onReminder={(h) => { setReminderHour(h); setReminderHourState(h) }}
          onHelp={() => setHelping(true)}
          onHold={ask}
          slow={slow}
          onRetry={() => void beginPing()}
        />
      ) : null
      break
    case 'ping':
      screen = (
        <PingStage key={`${visitor ? 'hall' : 'full'}-${runKey}`} kind={visitor ? 'hall' : 'full'} stim={stim.current} onDone={(r) => void pingDone(r)} onLeave={leaveStage} onRestart={() => void restart(visitor ? 'hall' : 'full')} />
      )
      break
    case 'echo':
      screen = (
        <EchoView
          echo={view.echo}
          meta={view.meta}
          fresh={view.fresh}
          visitor={visitor}
          checkDue={!visitor && checkDue()}
          onCheck={() => openCheck(view.echo, view.meta)}
          onSkipCheck={() => { rememberCheck(); setView({ v: 'echo', echo: view.echo, meta: view.meta, fresh: false }) }}
          onDose={openDose}
          onClose={() => setView(visitor ? { v: 'visitEnd' } : { v: 'home' })}
        />
      )
      break
    case 'check':
      screen = <PHQ2 onDone={(items) => void finishCheck(items, view.echo, view.meta)} onSkip={() => { rememberCheck(); setView({ v: 'echo', echo: view.echo, meta: view.meta, fresh: false }) }} onHelp={ask} />
      break
    case 'visitEnd':
      screen = id ? (
        <VisitEnd
          id={id}
          echo={guestEcho}
          waiting={waiting}
          busy={busy}
          error={error}
          onTune={() => void openTune('visitEnd')}
          onAgain={() => void beginPing()}
          onKeep={() => { window.location.hash = '#/minute' }}
          onDemo={() => void beginPing(true)}
          onHold={ask}
          onRetry={() => void beginPing()}
        />
      ) : null
      break
    case 'intro':
      screen = (
        <DoseIntro dose={view.dose} reason={view.reason} busy={busy} onBegin={() => void beginDose(view.dose)} onBack={leaveStage} />
      )
      break
    case 'dose': {
      const D = DOSE_VIEW[view.dose] ?? Wait
      screen = <D key={view.dose} onFinish={(m, line) => doseDone(view.dose, m, line)} onLeave={leaveStage} />
      break
    }
    case 'mini':
      screen = (
        <PingStage
          key={`mini-${runKey}`}
          kind="mini"
          stim={stim.current}
          onDone={(r) => miniDone(view.dose, r)}
          onLeave={leaveStage}
          onRestart={() => void restart('mini', view.dose)}
        />
      )
      break
    case 'feel':
      screen = <Feel busy={busy} onPick={(f) => void feelPicked(view.dose, f)} />
      break
    case 'learned':
      screen = <Learned dose={view.dose} result={view.result} pre={view.pre} post={view.post} felt={view.felt} line={view.line} metrics={view.metrics} onDone={leaveStage} />
      break
  }

  return (
    <div className="va-app" data-tone={stage ? 'stage' : 'paper'} data-view={view.v}>
      <video ref={attachVideo} className="va-video" playsInline muted aria-hidden="true" />
      {screen}
      {settings && id && (
        <Settings
          id={id}
          setting={setting}
          onSetting={changeSetting}
          onTune={() => void openTune('home')}
          onReset={reset}
          onClose={() => setSettings(false)}
          reminderHour={reminderHour}
          onReminder={(h) => { setReminderHour(h); setReminderHourState(h) }}
          onHelp={() => { setSettings(false); setHelping(true) }}
        />
      )}
      {helping && <HelpSheet onClose={() => setHelping(false)} />}
      {asking && (
        <Confirm
          title="Start over on this phone?"
          body="Vire forgets who you are here, your echoes on this phone and the face it learned. What was already sent stays where it is."
          yes="Start over"
          no="Keep"
          onYes={reset}
          onNo={() => setAsking(false)}
        />
      )}
      {isMock() && (view.v === 'ping' || view.v === 'mini' || view.v === 'dose' || view.v === 'tune') && <span className="va-demo">Demo signals</span>}
    </div>
  )
}
