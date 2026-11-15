// The calm screens around the ping: first run, the hall guest's two screens, home, echo, dose intro,
// "how do you feel", what Vire learned, settings.
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Channel, DoseKind, DoseResult, DoseSuggestion, Echo, PingSetting, PingTraces } from '@shared/types'
import { CHANNELS, DOSES } from '@shared/types'
import { loadModel } from '../tune'
import { DOSE_INFO } from './doses/shared'
import EchoCanvas from './EchoCanvas'
import EchoFigure from './EchoFigure'
import { measuredChange } from './fallback'
import { DoseIcon, IconArrow, IconClose, IconSettings } from './icons'
import type { Identity, Notice, PingMeta } from './store'
import { byDay, checkClinic, roomCode } from './store'
import { HONEST, beliefWords, doseHeadline, echoHeadline, sourceLine, todayTag, unreadLine } from './words'
import { saveLovedLaugh } from './laugh'
import { stimLine } from './personal'
import { heartMissingText, readingFigure, readingLabel, readingText } from './echoText'
import { displayName } from '../shared/name'

const doseInfo = (dose: unknown) => (typeof dose === 'string' && Object.prototype.hasOwnProperty.call(DOSE_INFO, dose) ? DOSE_INFO[dose as DoseKind] : { title: String(dose ?? 'Unknown dose'), short: String(dose ?? 'Unknown'), time: '1 minute', line: 'One minute.', needs: 'Nothing special is needed.' })

/** a sentence that runs long is set smaller rather than left to shout */
const long = (s: string) => (s.length > 70 ? ' va-long' : '')

/** what the sensing core can reach, for the one small line about AirPods */
export interface Air {
  /** inside the iPhone app, where AirPods can be read at all */
  shell: boolean
  motion: boolean
  hr: boolean
}

// ---------------------------------------------------------------- the wordmark, and the way back to a clean phone

/** "Vire". Held for two seconds it offers to start over: the booth's way to hand the phone to the next person. */
export function Wordmark({ onHold, className = '' }: { onHold?: () => void; className?: string }) {
  const timer = useRef(0)
  const clear = () => {
    clearTimeout(timer.current)
    timer.current = 0
  }
  useEffect(() => clear, [])
  if (!onHold) return <span className={`va-wordmark ${className}`}>Vire</span>
  return (
    <span
      className={`va-wordmark va-hold ${className}`}
      onPointerDown={() => {
        clear()
        timer.current = window.setTimeout(() => {
          timer.current = 0
          onHold()
        }, 2000)
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
    >
      Vire
    </span>
  )
}

/** An in-app question with two answers (the iPhone shell shows no browser dialogs). */
export function Confirm({
  title,
  body,
  yes,
  no,
  onYes,
  onNo,
}: {
  title: string
  body: string
  yes: string
  no: string
  onYes(): void
  onNo(): void
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onNo()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNo])
  return (
    <div className="va-sheet-wrap va-confirm-wrap" onClick={onNo}>
      <div className="va-confirm" role="alertdialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <h2 className="va-h2 va-sheet-title">{title}</h2>
        <p className="va-small">{body}</p>
        <div className="va-row-btns">
          <button className="va-btn va-btn-quiet" onClick={onNo}>
            {no}
          </button>
          <button className="va-btn va-btn-ink" onClick={onYes}>
            {yes}
          </button>
        </div>
      </div>
    </div>
  )
}

/** the camera was refused, or could not start: what to do about it, and a way on regardless */
function Trouble({ error, onDemo, onRetry }: { error: string; onDemo(): void; onRetry?: () => void }) {
  return (
    <div className="va-note" role="alert">
      <p>{error}</p>
      <div className="va-note-links">
        <button type="button" className="va-link" onClick={onDemo}>
          Try it with demo signals instead
        </button>
        {onRetry && <button type="button" className="va-link" onClick={onRetry}>Try again</button>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- first run

/** the camera minute is the way in for people without AirPods; Vire itself is on the first screen */
function CameraNote() {
  return (
    <p className="va-camera-note">
      This is the camera version, for people without AirPods. <a href="#/">What Vire is</a>
    </p>
  )
}

export function FirstRun({
  busy,
  error,
  onStart,
  onDemo,
  onHold,
  slow,
  onRetry,
}: {
  busy: boolean
  error: string | null
  onStart(name: string, code: string): void
  onDemo(name: string, code: string): void
  onHold(): void
  slow?: boolean
  onRetry?(): void
}) {
  const [name, setName] = useState('')
  const [hasCode, setHasCode] = useState(false)
  const [code, setCode] = useState('')
  const [clinic, setClinic] = useState<{ code: string; name: string } | null>(null)
  const [clinicError, setClinicError] = useState(false)
  const [checkingClinic, setCheckingClinic] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (hasCode) codeRef.current?.focus()
  }, [hasCode])

  return (
    <form
      className="va-first"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && !clinicError) onStart(name.trim(), hasCode ? code.trim() : '')
      }}
    >
      <div className="va-first-hero">
        <EchoCanvas mode="idle" className="va-first-canvas" />
        <Wordmark className="va-first-mark" onHold={onHold} />
      </div>
      <div className="va-first-body">
        <CameraNote />
        <h1 className="va-h1">A minute a day to hear your own echo.</h1>
        <p className="va-lede">
          Vire plays a few small things and notices how you answer: a nod, a smile, a sentence, two slow breaths.
        </p>
        <p className="va-first-now">One minute now: you'll see how your smile, voice, heart and nod answered, and get one small thing to try.</p>

        <label className="va-field">
          <span>Your first name, if you like</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="go"
            maxLength={24}
          />
        </label>

        {hasCode ? (
          <>
          <label className="va-field">
            <span>Code from your clinic</span>
            <input
              ref={codeRef}
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setClinic(null); setClinicError(false) }}
              onBlur={() => {
                const v = code.trim()
                if (!v) return
                setCheckingClinic(true)
                void checkClinic(v).then((found) => { setClinic(found); setClinicError(!found) }).finally(() => setCheckingClinic(false))
              }}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
              className="va-code"
            />
          </label>
          {checkingClinic && <p className="va-small">Checking that code…</p>}
          {clinic && <p className="va-small">{displayName(clinic.name)}</p>}
          {clinicError && (
            <div className="va-note" role="alert">
              <p>That clinic code is not recognised.</p>
              <button type="button" className="va-link" onClick={() => { setCode(''); setClinicError(false); setClinic(null) }}>Continue without a clinic</button>
            </div>
          )}
          </>
        ) : (
          <button type="button" className="va-link" onClick={() => setHasCode(true)}>
            I got a code from my clinic
          </button>
        )}

        {error && <Trouble error={error} onDemo={() => onDemo(name.trim(), hasCode ? code.trim() : '')} onRetry={onRetry} />}
        {slow && !error && <div className="va-note" role="status"><p>Still waiting for the camera or connection.</p>{onRetry && <button type="button" className="va-link" onClick={onRetry}>Try again</button>}</div>}

        <div className="va-first-go">
          <button type="submit" className="va-btn va-btn-primary va-btn-big" disabled={busy}>
            {busy ? 'Opening camera…' : 'Start'}
          </button>
          {busy && <p className="va-small va-starting" role="status">Camera first, then the face model. If this takes over 8 seconds, it is a one-time download.</p>}
          <p className="va-small">
            First Vire learns your face from two quick faces, about 15 seconds. You can teach three more (about 25 seconds) afterwards. Then comes your first 60-second ping. Your usual appears after three pings. It will ask for
            your camera and microphone; only numbers leave this phone, never video or sound.
          </p>
          <p className="va-small va-honest">{HONEST}</p>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- hall guest: one screen in, one screen out

export function VisitIntro({
  known,
  back = false,
  busy,
  error,
  onStart,
  onDemo,
  onHold,
  slow,
  onRetry,
}: {
  /** this phone has a person: the nickname was already asked */
  known: Identity | null
  /** they came back: this phone had a person before this visit, or already made an echo */
  back?: boolean
  busy: boolean
  error: string | null
  onStart(name: string): void
  onDemo(name: string): void
  onHold(): void
  slow?: boolean
  onRetry?(): void
}) {
  const [name, setName] = useState('')
  return (
    <form
      className="va-first va-visit"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) onStart(name.trim())
      }}
    >
      <div className="va-first-hero">
        <EchoCanvas mode="idle" className="va-first-canvas" />
        <Wordmark className="va-first-mark" onHold={onHold} />
      </div>
      <div className="va-first-body">
        <CameraNote />
        <h1 className="va-h1">{back ? 'Welcome back.' : 'One minute. See how you answer.'}</h1>
        <p className="va-lede">
          Vire plays a few small things and measures how you answer: a nod, a smile, a sentence, two slow breaths.
        </p>
        <ul className="va-facts">
          <li>Only numbers leave this phone. No video, no audio.</li>
          <li>At a hackathon it mostly shows how tired the weekend has made you.</li>
        </ul>

        {!known && (
          <label className="va-field">
            <span>A nickname for the wall, if you like</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="go"
              maxLength={24}
            />
          </label>
        )}

        {error && <Trouble error={error} onDemo={() => onDemo(name.trim())} onRetry={onRetry} />}
        {slow && !error && <div className="va-note" role="status"><p>Still waiting for the camera or connection.</p>{onRetry && <button type="button" className="va-link" onClick={onRetry}>Try again</button>}</div>}

        <div className="va-first-go">
          <button type="submit" className="va-btn va-btn-primary va-btn-big" disabled={busy}>
            {busy ? 'Opening camera…' : back ? 'Take a ping' : 'Start'}
          </button>
          {busy && <p className="va-small va-starting" role="status">Camera first, then the face model. If this takes over 8 seconds, it is a one-time download.</p>}
          <p className="va-small">60 seconds. Vire will ask for your camera and microphone. Earbuds help, but are not needed.</p>
          <p className="va-small va-honest">{HONEST}</p>
        </div>
      </div>
    </form>
  )
}

export function VisitEnd({
  id,
  echo,
  demo,
  waiting,
  busy,
  error,
  onTune,
  onAgain,
  onKeep,
  onDemo,
  onHold,
  slow,
  onRetry,
}: {
  id: Identity
  /** the echo they just made, when there is one */
  echo: Echo | null
  /** the readings came from the script (camera refused), not from this person */
  demo?: boolean
  /** pings not sent yet */
  waiting: number
  busy: boolean
  error: string | null
  onTune(): void
  onAgain(): void
  onKeep(): void
  onDemo(): void
  onHold(): void
  slow?: boolean
  onRetry?(): void
}) {
  const tuned = !!loadModel()
  return (
    <div className="va-page va-visit-end">
      <header className="va-bar">
        <Wordmark onHold={onHold} />
      </header>
      <div className="va-visit-end-body" data-fig={!!echo}>
        {echo && (
          <div className="va-visit-end-fig" aria-hidden="true">
            {echo.status === 'calibrating' ? <PlainReadings echo={echo} /> : <EchoFigure echo={echo} tone="paper" bare />}
          </div>
        )}
        <h1 className="va-h1">{echo?.hallGuest != null ? `You are person ${echo.hallGuest} today.` : 'Thank you for trying Vire today.'}</h1>
        {demo ? (
          <>
            <p className="va-lede">Demo signals: a script made these readings, not you. This is what the clinic would see.</p>
            <p className="va-small">With the camera allowed, the same minute reads your own face.</p>
          </>
        ) : (
          <>
            <p className="va-lede">This is what the clinic saw. {echo?.hallCount != null ? `${echo.hallCount} people have tried Vire on their own faces today.` : echo ? 'Your readings are above.' : ''}</p>
            <p className="va-small">Your heart reading comes from one slow breath. Keep it on this phone to do the full daily minute as yourself.</p>
          </>
        )}
        {id.local || waiting > 0 ? (
          <p className="va-note">
            No network just now. Your ping is kept on this phone and goes up to the wall when the network is back.
          </p>
        ) : (
          <>
            <a className="va-btn va-btn-primary va-btn-big" href={`#/wall?u=${encodeURIComponent(id.userId)}`}>
              See yourself on the wall
            </a>
            {echo?.wallCounted === false && <p className="va-small va-visit-as">{demo ? 'The scripted ping is saved and kept out of the hall wall.' : 'Your ping is saved. Test traffic is kept out of the hall wall.'}</p>}
          </>
        )}
      </div>
      {error && <Trouble error={error} onDemo={onDemo} onRetry={onRetry} />}
      {slow && !error && <div className="va-note" role="status"><p>Still waiting for the camera or connection.</p>{onRetry && <button type="button" className="va-link" onClick={onRetry}>Try again</button>}</div>}
      <div className="va-visit-more">
        <h2 className="va-h2">While you’re here</h2>
        <button className="va-row" onClick={onTune} disabled={busy}>
          <span>
            <b>{tuned ? 'Teach Vire your face again' : 'Teach Vire your face'}</b>
            <span className="va-small">Two faces, about 15 seconds. You can teach three more (about 25 seconds) later.</span>
          </span>
          <IconArrow />
        </button>
        <button className="va-row" onClick={onAgain} disabled={busy}>
          <span>
            <b>{busy ? 'Starting…' : 'Take another ping'}</b>
            <span className="va-small">60 seconds, the same five steps.</span>
          </span>
          <IconArrow />
        </button>
        <button className="va-row" onClick={onKeep} disabled={busy}>
          <span><b>Keep it on this phone</b><span className="va-small">Do the full daily minute as yourself.</span></span>
          <IconArrow />
        </button>
        <p className="va-small va-honest">{HONEST}</p>
      </div>
    </div>
  )
}

const CHECK_QUESTIONS = ['Little interest or pleasure in doing things', 'Feeling down, depressed, or hopeless'] as const
const CHECK_CHOICES = [['Not at all', 0], ['Several days', 1], ['More than half the days', 2], ['Nearly every day', 3]] as const

export function PHQ2({ onDone, onSkip, onHelp }: { onDone(items: [number, number]): void; onSkip(): void; onHelp(): void }) {
  const [step, setStep] = useState(0)
  const [items, setItems] = useState<[number, number]>([0, 0])
  const pick = (value: number) => {
    const next: [number, number] = [...items] as [number, number]
    next[step] = value
    if (step === 1) onDone(next)
    else {
      setItems(next)
      setStep(1)
    }
  }
  return (
    <div className="va-page va-check-screen">
      <header className="va-bar">
        <Wordmark />
        <button className="va-link" onClick={onSkip}>Not this week</button>
      </header>
      <main className="va-check-body">
        <p className="va-check-count">{step + 1} of 2</p>
        <h1 className="va-h1">Over the last 2 weeks, how often have you been bothered by any of the following problems?</h1>
        {step === 0 && <p className="va-small va-check-note">Two questions your clinic knows (PHQ-2). They go to your clinic with your echo.</p>}
        <h2 className="va-check-question">{CHECK_QUESTIONS[step]}</h2>
        <div className="va-check-options">
          {CHECK_CHOICES.map(([label, value]) => <button key={label} className="va-btn va-btn-primary va-btn-big" onClick={() => pick(value)}>{label}</button>)}
        </div>
        <button className="va-link va-check-skip" onClick={onSkip}>Not this week</button>
        <button className="va-link va-help-link" onClick={onHelp}>Need help now?</button>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------- home

function greeting(name: string) {
  const h = new Date().getHours()
  const part = h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const shown = displayName(name)
  return shown ? `${part}, ${shown}.` : `${part}.`
}

function History({ echoes }: { echoes: Echo[] }) {
  const days = byDay(echoes, 14)
  const n = days.filter(Boolean).length
  return (
    <section className="va-history" aria-label={`Your last 14 days: ${n} ${n === 1 ? 'ping' : 'pings'}`}>
      <svg viewBox="0 0 292 48" aria-hidden="true">
        <line className="va-history-mid" x1="4" y1="24" x2="288" y2="24" />
        {days.map((e, i) => {
          const x = 16 + i * 20
          if (!e) return <circle key={i} className="va-history-none" cx={x} cy="24" r="1.6" />
          const y = 24 - Math.max(-19, Math.min(19, (e.strength - 50) * 0.5))
          return (
            <g key={i} className="va-history-day" data-today={i === days.length - 1}>
              <line x1={x} y1="24" x2={x} y2={y} />
              <circle cx={x} cy={y} r="3.6" />
            </g>
          )
        })}
      </svg>
      <div className="va-history-cap">
        <span>two weeks ago</span>
        <span>the line is your usual</span>
        <span>today</span>
      </div>
    </section>
  )
}

function PlainReadings({ echo }: { echo: Echo }) {
  return <div className="va-plain-readings" aria-label="Measured readings while your usual is being learned">
    {echo.components.map((c) => <span key={String(c.channel)}><b>{readingLabel(String(c.channel))}</b> {c.value == null && c.channel === 'heart' ? heartMissingText() : readingText(c)}</span>)}
    <small>Your usual appears after three pings ({Math.max(1, 3 - (echo.pingsSoFar ?? 1))} to go).</small>
  </div>
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

/** An echo with no usual yet has nothing to stand against, so the four readings themselves are the picture. */
function ReadingTiles({ echo, why, visitor = false }: { echo: Echo; why?: Partial<Record<Channel, string>>; visitor?: boolean }) {
  const by = new Map(echo.components.map((c) => [String(c.channel), c]))
  const left = Math.max(1, 3 - (echo.pingsSoFar ?? 1))
  const read = CHANNELS.filter((ch) => { const c = by.get(ch); return !!c && readingFigure(c) != null })
  const unread = CHANNELS.filter((ch) => by.has(ch) && !read.includes(ch))
  // the label already says which reading is missing, so the reason starts at the reason
  const reason = (ch: Channel) => (why?.[ch] ?? (ch === 'heart' ? heartMissingText() : by.get(ch)?.note ?? 'Not read this time.')).replace(/^I couldn[’']t read your \w+ today\.\s*/, '')
  return (
    <div className="va-tiles-wrap">
      {read.length > 0 && (
        <div className="va-tiles" data-odd={read.length % 2 === 1} aria-label="Today’s readings, as measured">
          {read.map((ch) => {
            const c = by.get(ch)!
            const fig = readingFigure(c)!
            return (
              <div key={ch} className="va-tile" data-ch={ch} data-echo-value={String(c.value)}>
                <span className="va-tile-ch"><i aria-hidden="true" />{readingLabel(ch)}</span>
                <p className="va-tile-n"><b>{fig.n}</b> {fig.unit}</p>
                <p className="va-tile-sub">{fig.sub}</p>
              </div>
            )
          })}
        </div>
      )}
      {unread.length > 0 && (
        <ul className="va-unread">
          {unread.map((ch) => (
            <li key={ch} data-ch={ch} data-echo-value="null">
              <i aria-hidden="true" />
              <p><b>{cap(readingLabel(ch))} not read.</b> {reason(ch)}</p>
            </li>
          ))}
        </ul>
      )}
      {!visitor && <p className="va-tiles-usual">Your usual appears after three pings. <b>{left} to go.</b></p>}
    </div>
  )
}

function LovedLaughCard() {
  const [recording, setRecording] = useState(false)
  const [saved, setSaved] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const put = async (blob: Blob) => {
    if (blob.size < 1000) return
    await saveLovedLaugh(blob)
    setSaved(true)
  }
  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await put(file)
    e.currentTarget.value = ''
  }
  const record = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: BlobPart[] = []
      const r = new MediaRecorder(s)
      stream.current = s
      recorder.current = r
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop())
        stream.current = null
        void put(new Blob(chunks, { type: r.mimeType || 'audio/webm' }))
      }
      r.start()
      setRecording(true)
      timer.current = window.setTimeout(() => r.stop(), 8000)
    } catch {
      setRecording(false)
    }
  }
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    recorder.current?.stop()
    recorder.current = null
    setRecording(false)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); stream.current?.getTracks().forEach((t) => t.stop()) }, [])
  return (
    <section className="va-loved">
      <div>
        <h2 className="va-h2">A laugh you love</h2>
        <p className="va-small">{saved ? 'Saved on this phone. It never leaves your phone.' : 'Add a 5–8 second laugh from a file or your microphone. Vire will use it on some days.'}</p>
      </div>
      <div className="va-loved-actions">
        <label className="va-btn va-btn-quiet">
          Choose a file
          <input type="file" accept="audio/*" onChange={(e) => void pickFile(e)} hidden />
        </label>
        <button className="va-btn va-btn-ghost" onClick={recording ? stop : () => void record()}>{recording ? 'Stop recording' : 'Record 8 seconds'}</button>
      </div>
    </section>
  )
}

function ReminderCard({ hour, onChange }: { hour: number | null; onChange(hour: number): void }) {
  const h = hour ?? new Date().getHours()
  const [open, setOpen] = useState(false)
  const hourText = (value: number) => value === 0 ? 'Midnight' : value === 12 ? 'Noon' : `${value % 12}:00 ${value < 5 ? 'at night' : value < 12 ? 'in the morning' : value < 18 ? 'in the afternoon' : value < 22 ? 'in the evening' : 'at night'}`
  const addCalendar = () => {
    const url = window.location.href.split('#')[0] + '#/minute'
    const first = new Date(); first.setHours(h, 0, 0, 0); if (first.getTime() < Date.now()) first.setDate(first.getDate() + 1)
    const stamp = first.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vire//Daily ping//EN', 'BEGIN:VEVENT', `UID:vire-daily-${h}@vire`, `DTSTART:${stamp}`, 'RRULE:FREQ=DAILY', 'SUMMARY:Vire daily ping', `DESCRIPTION:Open Vire for your daily ping: ${url}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
    a.download = 'vire-daily-ping.ics'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const notify = async () => {
    if (typeof Notification === 'undefined') return
    const p = await Notification.requestPermission()
    if (p === 'granted') new Notification('Vire reminders are on', { body: `We’ll remind you at ${String(h).padStart(2, '0')}:00.` })
  }
  return (
    <section className="va-reminder">
      <h2 className="va-h2">Daily reminder</h2>
      <button type="button" className="va-row va-reminder-row" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <span><b>Your hour</b><span className="va-small">{hourText(h)}</span></span><IconArrow />
      </button>
      {open && <div className="va-hour-list" role="listbox" aria-label="Reminder hour">
        {Array.from({ length: 24 }, (_, i) => <button type="button" role="option" aria-selected={i === h} key={i} className={`va-hour ${i === h ? 'is-selected' : ''}`} onClick={() => { onChange(i); setOpen(false) }}>{hourText(i)}</button>)}
      </div>}
      <div className="va-reminder-actions"><button className="va-btn va-btn-quiet" onClick={addCalendar}>Add to calendar</button><button className="va-btn va-btn-ghost" onClick={() => void notify()}>Allow app reminder</button></div>
      <p className="va-small">The app can remind you while it is open. A web app cannot wake a closed phone; the calendar reminder can.</p>
    </section>
  )
}

export function Home({
  id,
  today,
  todayMeta,
  reminderHour,
  echoes,
  suggestion,
  notice,
  busy,
  error,
  offline,
  waiting,
  air,
  onPing,
  onDemo,
  onEcho,
  onDose,
  onSettings,
  onReminder,
  onHelp,
  onHold,
  slow,
  onRetry,
}: {
  id: Identity
  today: Echo | null
  todayMeta?: PingMeta | null
  reminderHour: number | null
  echoes: Echo[]
  suggestion: DoseSuggestion | null
  notice: Notice | null
  busy: boolean
  error: string | null
  offline: boolean
  /** pings and doses not sent yet */
  waiting: number
  air: Air | null
  onHold(): void
  onPing(): void
  onDemo(): void
  onEcho(): void
  onDose(d: DoseKind, reason?: string): void
  onSettings(): void
  onReminder(hour: number): void
  onHelp(): void
  slow?: boolean
  onRetry?(): void
}) {
  // the fresh one first: the one inside today's echo was written before any dose taken since
  const sug = suggestion ?? today?.suggestion
  const others = DOSES.filter((d) => d !== sug?.dose)
  const headline = today ? echoHeadline(today) : ''
  return (
    <div className="va-page va-home">
      <header className="va-bar">
        <Wordmark onHold={onHold} />
        <button className="va-icon-btn" onClick={onSettings} aria-label="Settings">
          <IconSettings />
        </button>
      </header>

      <h1 className="va-h1 va-greet">{greeting(id.name)}</h1>

      {notice?.booster && (
        <section className="va-notice">
          <h2>Your clinic would like to check in</h2>
          <p>{notice.message ?? 'Nothing is wrong. They’ll be in touch to find a time that suits you.'}</p>
        </section>
      )}

      {error && <Trouble error={error} onDemo={onDemo} onRetry={onRetry} />}
      {slow && !error && <div className="va-note" role="status"><p>Still waiting for the camera or connection.</p>{onRetry && <button type="button" className="va-link" onClick={onRetry}>Try again</button>}</div>}

      {!today ? (
        <button className="va-portal" onClick={onPing} disabled={busy}>
          <EchoCanvas mode="idle" className="va-portal-canvas" />
          <span className="va-portal-text">
            <strong>{busy ? 'Starting…' : 'Take today’s ping'}</strong>
            <span>60 seconds · earbuds in, if you have them</span>
          </span>
        </button>
      ) : (
        <>
          <button className="va-today" onClick={onEcho}>
            {today.status === 'calibrating' ? <PlainReadings echo={today} /> : <EchoFigure echo={today} tone="paper" bare />}
            <span className="va-today-text">
              {todayMeta?.demo && <span className="va-small">Demo signals</span>}
              <span className={`va-today-msg${long(headline)}`}>{headline}</span>
              <span className="va-today-more">
                Today’s echo <IconArrow />
              </span>
            </span>
          </button>

          {sug && (
            <section className="va-suggest">
              <div className="va-suggest-head">
                <span className="va-suggest-icon">
                  <DoseIcon dose={sug.dose} />
                </span>
                <div>
                <h2>{doseInfo(sug.dose).title}</h2>
                <p className="va-small">{doseInfo(sug.dose).time}</p>
                </div>
              </div>
              <p className="va-suggest-why">{sug.reason}</p>
              <button className="va-btn va-btn-primary" onClick={() => onDose(sug.dose, sug.reason)}>
                Try it now
              </button>
            </section>
          )}
        </>
      )}

      {air && (air.shell || air.motion) && (
        <p className="va-air" data-on={air.motion}>
          <i aria-hidden="true" />
          {air.motion
            ? air.hr
              ? 'AirPods connected. Head movement and heart rate come from them.'
              : 'AirPods connected. Head movement comes from them; heart rate too, once it arrives.'
            : 'Put your AirPods in for head movement and heart rate. Without them the camera reads both.'}
        </p>
      )}

      {echoes.length > 0 && <History echoes={echoes} />}
      <ReminderCard hour={reminderHour} onChange={onReminder} />
      {echoes.length >= 3 && <LovedLaughCard />}

      <section className="va-doses">
        <h2 className="va-h2">{sug && today ? 'Or something else' : 'Something small, any time'}</h2>
        <div className="va-dose-row">
          {(sug && today ? others : DOSES).map((d) => (
            <button key={d} className="va-chip" onClick={() => onDose(d)}>
              <DoseIcon dose={d} size={22} />
              <span>{doseInfo(d).short}</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="va-foot">
        {today && (
          <button className="va-link" onClick={onPing} disabled={busy}>
            {busy ? 'Starting…' : 'Take another ping'}
          </button>
        )}
        <p className="va-small va-honest">{HONEST}</p>
        {(offline || waiting > 0) && <p className="va-room">{offline ? 'Kept on this phone for now' : ''}{waiting > 0 ? `${offline ? ' · ' : ''}${waiting} waiting to be sent` : ''}</p>}
        <button className="va-link va-help-link" onClick={onHelp}>Need help now?</button>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------- echo

/** the laugh step waits this long before the laughter plays (PingStage, mockSense) */
const LAUGH_LEAD_MS = 1000
const dateLine = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
function TraceProof({ traces, smileStartS, smileSeen, heartRead }: { traces: PingTraces; /** seconds from the laugh to the smile, as the echo states it */ smileStartS: number | null; /** the echo counted a smile: with no start time, it was already there when the laughter began */ smileSeen: boolean; /** false when the echo left the heart out: scraps of a pulse are not drawn as a reading */ heartRead: boolean }) {
  const n = traces.t.length
  if (!n) return null
  const end = traces.t[n - 1] ?? 60000
  const x = (t: number) => 18 + (t / Math.max(1, end)) * 324
  const path = (ys: (number | null)[], lo: number, hi: number, y0: number, h: number) => {
    const out: string[] = []
    let pen = false
    ys.forEach((v, i) => {
      // a sample that was not read lifts the pen: a missing stretch is never drawn as a line
      if (v == null) { pen = false; return }
      const y = y0 + h - ((v - lo) / Math.max(0.001, hi - lo)) * h
      out.push((pen ? 'L' : 'M') + x(traces.t[i] ?? 0).toFixed(1) + ',' + y.toFixed(1))
      pen = true
    })
    return out.join(' ')
  }
  const phase = (key: string) => traces.phases.find((p) => p.key === key)?.at ?? null
  const laughAt = phase('laugh')
  const laughIdx = traces.phases.findIndex((p) => p.key === 'laugh')
  const laughEnd = (laughIdx < 0 ? null : traces.phases[laughIdx + 1]?.at) ?? (laughAt == null ? null : laughAt + 12000)
  const breathAt = phase('breathe')
  const breathEnd = breathAt == null ? null : end
  // the smile is timed from the laughter itself, which starts one second into the step
  const mark = laughAt == null || smileStartS == null ? null : laughAt + LAUGH_LEAD_MS + smileStartS * 1000
  const markRight = mark != null && x(mark) > 200
  const smileHi = Math.max(0.6, ...traces.smile, ...traces.cheek)
  const bpm = traces.bpm.filter((v): v is number => v != null)
  const bpmLo = bpm.length ? Math.min(...bpm) - 4 : 50
  const bpmHi = bpm.length ? Math.max(...bpm) + 4 : 90
  return (
    <section className="va-trace-proof" aria-label="Your answer, second by second">
      <h2 className="va-h2">Your answer, second by second</h2>
      <div className="va-trace-legend" aria-label="Trace legend"><span><i className="is-smile" /> Smile</span><span><i className="is-heart" /> Heart</span></div>
      <svg viewBox="0 0 360 178" role="img" aria-label="Smile trace through the laughter and heart trace through the two slow breaths">
        {laughAt != null && laughEnd != null && <rect x={x(laughAt)} y="10" width={Math.max(0, x(laughEnd) - x(laughAt))} height="70" rx="3" className="va-trace-window va-trace-smile-window" />}
        {breathAt != null && breathEnd != null && <rect x={x(breathAt)} y="94" width={Math.max(0, x(breathEnd) - x(breathAt))} height="60" rx="3" className="va-trace-window va-trace-heart-window" />}
        <line x1="18" x2="342" y1="80" y2="80" className="va-trace-axis" />
        <line x1="18" x2="342" y1="154" y2="154" className="va-trace-axis" />
        <path d={path(traces.smile, 0, smileHi, 10, 70)} className="va-trace-line va-trace-smile" />
        {heartRead && <path d={path(traces.bpm, bpmLo, bpmHi, 94, 60)} className="va-trace-line va-trace-heart" />}
        <text x="18" y="22" className="va-trace-label">smile</text>
        <text x="18" y="106" className="va-trace-label">heart</text>
        {mark != null && <line x1={x(mark)} x2={x(mark)} y1="10" y2="84" className="va-trace-mark" />}
        {mark != null && smileStartS != null && <text x={markRight ? x(mark) - 4 : x(mark) + 4} y="91" textAnchor={markRight ? 'end' : 'start'} className="va-trace-note">smile began {smileStartS.toFixed(1)} s after the laugh</text>}
        {mark == null && laughAt != null && <text x="342" y="91" textAnchor="end" className="va-trace-note">{smileSeen ? 'already smiling when the laughter began' : 'no clear start to a smile this time'}</text>}
        {(!heartRead || traces.bpm.every((v) => v == null)) && <text x="180" y="128" textAnchor="middle" className="va-trace-note">heart left out this time</text>}
        <text x="18" y="174" className="va-trace-time">0 s</text>
        <text x="342" y="174" textAnchor="end" className="va-trace-time">{(end / 1000).toFixed(0)} s</text>
      </svg>
      <p className="va-small">The tinted windows show what Vire asked for. A missing line stays missing.</p>
    </section>
  )
}

export function EchoView({
  echo,
  meta,
  fresh,
  visitor,
  checkDue: checkIsDue,
  onCheck,
  onSkipCheck,
  onDose,
  onClose,
}: {
  echo: Echo
  /** where the signals came from and what could not be read; known for pings taken on this phone */
  meta: PingMeta | null
  fresh: boolean
  /** a hall guest: no dose is offered, the next screen says what to do tomorrow */
  visitor?: boolean
  checkDue?: boolean
  onCheck?(): void
  onSkipCheck?(): void
  onDose(d: DoseKind, reason?: string): void
  onClose(): void
}) {
  const calibrating = !['steady', 'dipping', 'low'].includes(String(echo.status))
  const by = new Map(echo.components.map((c) => [c.channel, c]))
  const sug = echo.suggestion
  const otherDoses = sug ? DOSES.filter((d) => d !== sug.dose) : []
  const headline = echoHeadline(echo, visitor)
  const startSaid = /starting ([\d.]+) s after/.exec(by.get('smile')?.reading ?? '')?.[1]
  const smileStartS = startSaid == null ? null : Number(startSaid)
  const missing: Channel[] = CHANNELS.filter((ch) => by.get(ch)?.value == null)
  const unread = unreadLine(missing)
  return (
    <div className="va-page va-echo">
      <header className="va-bar">
        <span className="va-bar-date">{dateLine(echo.at)}</span>
        {sug ? (
          <button className="va-link-stage" onClick={onClose}>Skip today</button>
        ) : (
          <button className="va-icon-btn va-on-stage" onClick={onClose} aria-label="Back to home">
            <IconClose />
          </button>
        )}
      </header>

      <div className="va-echo-fig">
        {calibrating ? <ReadingTiles echo={echo} why={meta?.why} visitor={visitor} /> : <EchoFigure echo={echo} tone="stage" animate={fresh} />}
        {!calibrating && <p className="va-echo-key">The dashed ring is your usual. A petal past it answered more today; one inside it, less.</p>}
      </div>
      {meta?.demo && <p className="va-small va-demo-label">Demo signals (scripted)</p>}
      {!calibrating && <p className="va-echo-overall"><b>Overall echo {Math.round(echo.strength)} / 100</b> · 50 is your usual</p>}

      <h1 className={`va-h1 va-echo-msg${long(headline)}`}>{headline}</h1>
      {echo.stim && <p className="va-small va-probe-name">{stimLine(echo.stim)}</p>}
      {unread && !calibrating && <p className="va-echo-unread">{unread}</p>}
      {meta?.traces && <TraceProof traces={meta.traces} smileStartS={smileStartS} smileSeen={!!by.get('smile')?.value} heartRead={by.get('heart')?.value != null} />}

      {checkIsDue && !visitor && (
        <section className="va-check-offer">
          <h2 className="va-h2">Two questions for this week</h2>
          <p className="va-small">Two questions your clinic knows (PHQ-2). They go to your clinic with your echo.</p>
          <button className="va-btn va-btn-primary" onClick={onCheck}>Answer now</button>
          <button className="va-link" onClick={onSkipCheck}>Not this week</button>
        </section>
      )}

      {!calibrating && <ul className="va-notes">
        {CHANNELS.map((ch) => {
          const c = by.get(ch)
          if (!c) return null
          return (
            <li key={ch} data-ch={ch} data-echo-value={c.value == null ? 'null' : String(c.value)} {...(!calibrating ? { 'data-echo-strength': String(Math.round(c.strength)) } : {})}>
              <i aria-hidden="true" />
              <p>
                <b>{readingLabel(ch)}</b> {c.value == null && ch === 'heart' ? meta?.why.heart ?? heartMissingText() : readingText(c)}
                {c.value != null && <span>{c.note && ' '}{c.note}</span>}
              </p>
            </li>
          )
        })}
      </ul>}

      {meta && <p className="va-echo-src">{sourceLine(meta.head, missing.includes('heart') ? 'none' : meta.heart)}</p>}

      {sug ? (
        <section className="va-offer">
          <div className="va-suggest-head">
            <span className="va-suggest-icon">
              <DoseIcon dose={sug.dose} />
            </span>
            <div>
              <h2>{doseInfo(sug.dose).title}</h2>
              <p className="va-small">{doseInfo(sug.dose).time} · then a 20-second listen</p>
            </div>
          </div>
          <p className="va-suggest-why">{sug.reason}</p>
          <button className="va-btn va-btn-primary" onClick={() => onDose(sug.dose, sug.reason)}>
            Try Vire’s pick
          </button>
          <div className="va-offer-other" aria-label="Other small choices">
            {otherDoses.map((d) => (
              <button key={d} className="va-chip" onClick={() => onDose(d)}>
                <DoseIcon dose={d} size={20} />
                <span>{doseInfo(d).short}</span>
              </button>
            ))}
          </div>
          <button className="va-btn va-btn-ghost" onClick={onClose}>Skip today</button>
        </section>
      ) : (
        <button className="va-btn va-btn-primary va-echo-next" onClick={onClose}>
          {visitor ? 'Next' : 'Done'}
        </button>
      )}

      <p className="va-small va-honest">{HONEST}</p>
    </div>
  )
}

// ---------------------------------------------------------------- dose intro

export function DoseIntro({
  dose,
  reason,
  busy,
  onBegin,
  onBack,
}: {
  dose: DoseKind
  reason?: string
  busy: boolean
  onBegin(): void
  onBack(): void
}) {
  const info = doseInfo(dose)
  return (
    <div className="va-page va-intro">
      <header className="va-bar">
        <span />
        <button className="va-icon-btn va-on-stage" onClick={onBack} aria-label="Back">
          <IconClose />
        </button>
      </header>
      <div className="va-intro-body">
        <span className="va-intro-icon">
          <DoseIcon dose={dose} size={34} />
        </span>
        <h1 className="va-h1">{info.title}</h1>
        <p className="va-intro-line">{info.line}</p>
        {reason && <p className="va-intro-why">{reason}</p>}
      </div>
      <div className="va-intro-go">
        <p className="va-small">
          {info.time} · {info.needs} Afterwards, a 20-second listen shows how your echo answered.
        </p>
        <button className="va-btn va-btn-primary va-btn-big" onClick={onBegin} disabled={busy}>
          {busy ? 'Starting…' : 'Begin'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- how do you feel

export function Feel({ busy, onPick }: { busy: boolean; onPick(v: -1 | 0 | 1 | null): void }) {
  return (
    <div className="va-page va-feel">
      <div className="va-feel-body">
        <h1 className="va-h1">One tap, if you like</h1>
        <p className="va-intro-line">Better, same, worse. This is optional and helps Vire learn what suits you.</p>
      </div>
      <div className="va-feel-opts">
        <button className="va-btn va-btn-stage va-btn-big" disabled={busy} onClick={() => onPick(1)}>
          A bit better
        </button>
        <button className="va-btn va-btn-stage va-btn-big" disabled={busy} onClick={() => onPick(0)}>
          About the same
        </button>
        <button className="va-btn va-btn-stage va-btn-big" disabled={busy} onClick={() => onPick(-1)}>
          A bit worse
        </button>
        <button className="va-btn va-btn-ghost" disabled={busy} onClick={() => onPick(null)}>
          {busy ? 'One moment…' : 'Skip'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- what Vire learned

const PART: Record<Channel, string> = { smile: 'smile', voice: 'voice', heart: 'heart', move: 'nod' }

export function Learned({
  dose,
  result,
  pre,
  post,
  felt,
  line = '',
  metrics = {},
  onDone,
}: {
  dose: DoseKind
  result: DoseResult
  /** the ping before the dose and the short listen after it, as they were shown */
  pre: Echo | null
  post: Echo | null
  felt: -1 | 0 | 1 | null
  /** what the dose itself read, in the sentence it ended on */
  line?: string
  metrics?: Record<string, number>
  onDone(): void
}) {
  // today's result: one number, taken from the two figures drawn here, so the sentence and the picture agree
  const learning = pre?.status === 'calibrating' || post?.status === 'calibrating'
  const localChange = learning ? null : measuredChange(pre, post)
  const m = localChange && result.change != null ? { ...localChange, after: localChange.before + Math.round(result.change), change: Math.round(result.change) } : localChange
  const withinWobble = !!m && pre?.wobble != null && Math.abs(m.change) <= pre.wobble
  const headline = learning ? 'Before and after your minute.' : withinWobble ? 'About the same as before: within your usual day-to-day spread.' : doseHeadline(dose, m ? m.change : null, felt)
  const said = felt == null ? null : felt > 0 ? 'a bit better' : felt < 0 ? 'a bit worse' : 'about the same'
  // no usual yet: the two readings side by side, each in its own unit, and no points
  const readingRows = learning && pre && post ? CHANNELS.flatMap((ch) => {
    const a = pre.components.find((x) => x.channel === ch)
    const b = post.components.find((x) => x.channel === ch)
    const fa = a ? readingFigure(a) : null
    const fb = b ? readingFigure(b) : null
    return fa && fb ? [{ ch, fa, fb }] : []
  }) : []
  const measured = learning
    ? readingRows.length ? 'Your usual appears after three pings. Until then Vire compares the readings themselves.' : 'Vire could not take the same reading twice this time.'
    : withinWobble
    ? 'About the same as before: within your usual day-to-day spread.'
    : m
    ? m.change >= 2
      ? `Your echo was ${m.change} points fuller this time.`
      : m.change <= -2
        ? `Your echo was ${Math.abs(m.change)} points quieter this time.`
        : 'Your echo stayed about the same this time.'
    : 'Vire could not measure a second echo this time.'
  const tag = withinWobble ? null : todayTag(m ? m.change : null, felt)
  const beliefs = [...result.beliefs].sort((a, b) => (b.n > 0 ? b.mean : -99) - (a.n > 0 ? a.mean : -99))
  const lo = Math.min(-4, ...beliefs.map((b) => b.mean - b.sd))
  const hi = Math.max(10, ...beliefs.map((b) => b.mean + b.sd))
  const pct = (v: number) => `${(((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100).toFixed(1)}%`
  // before and after are drawn with the same petals: the ones both pings read
  const only = (e: Echo): Echo => ({
    ...e,
    components: e.components.map((c) => (m && m.channels.includes(c.channel) ? c : { ...c, value: null })),
  })
  return (
    <div className="va-page va-learned">
      <div className="va-learned-top">
        {m && pre && post && (
          <>
            <div className="va-ba" aria-label={`Your echo before, ${m.before}, and after, ${m.after}`}>
              <figure>
                <EchoFigure echo={only(pre)} tone="stage" bare />
                <figcaption>
                  before <b>{m.before}</b>
                </figcaption>
              </figure>
              <IconArrow />
              <figure>
                <EchoFigure echo={only(post)} tone="stage" bare animate />
                <figcaption>
                  after <b>{m.after}</b>
                </figcaption>
              </figure>
            </div>
            <p className="va-ba-key">
              Read on your {m.channels.map((c) => PART[c]).join(' and ')}{pre.status === 'calibrating' ? '. Your usual appears after three pings.' : `. 50 is your usual${pre.wobble ? `; your usual wobble is about ${Math.round(pre.wobble)} points` : ''}.`}
            </p>
          </>
        )}
        <h1 className={`va-h1${long(headline)}`}>{headline}</h1>
        {line && <p className="va-learned-dose">{line}</p>}
        {dose === 'breathe' && (metrics.pacesRead ?? 0) >= 2 && (
          <ul className="va-learned-paces" aria-label="Your heart at each pace">
            {[1, 2, 3].map((i) => {
              const pace = metrics[`pace${i}`]
              const swing = metrics[`swing${i}`]
              if (pace == null) return null
              return (
                <li key={i} data-best={swing != null && pace === metrics.swingPace ? 'true' : undefined}>
                  <b>{pace.toFixed(1)}</b>
                  <span>{swing != null ? `${Math.round(swing)} ${Math.round(swing) === 1 ? 'beat' : 'beats'}` : 'not read'}</span>
                </li>
              )
            })}
          </ul>
        )}
        {readingRows.length > 0 && (
          <ul className="va-change" aria-label="Your readings before and after the minute">
            {readingRows.map(({ ch, fa, fb }) => (
              <li key={ch} data-ch={ch}>
                <span className="va-change-ch"><i aria-hidden="true" />{readingLabel(ch)}</span>
                <span className="va-change-n">
                  <span>{fa.n}</span>
                  <IconArrow />
                  <b>{fb.n}</b>
                  <small>{fb.unit}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="va-feel-report">
          {said ? <>You said <b>{said}</b>. {measured}{learning ? '' : ' Vire keeps both.'}</> : measured}
        </p>
      </div>

      <section className="va-beliefs">
        <h2 className="va-h2">{learning ? 'What you have tried' : 'Vire’s guess for next time'}</h2>
        <ul>
          {beliefs.map((b) => (
            <li key={b.dose} data-current={b.dose === dose} data-untried={b.n === 0}>
              <div className="va-belief-head">
                <DoseIcon dose={b.dose} size={20} />
                <b>{doseInfo(b.dose).short}</b>
                <span>{learning ? (b.n === 0 ? 'not tried yet' : b.n === 1 ? 'tried once' : `tried ${b.n} times`) : beliefWords(b)}</span>
                {b.dose === dose && tag && <em className="va-belief-today">{tag}</em>}
              </div>
              {!learning && <div className="va-belief-track" aria-hidden="true">
                <i className="va-belief-zero" style={{ left: pct(0) }} />
                {b.n > 0 && (
                  <>
                    <i className="va-belief-range" style={{ left: pct(b.mean - b.sd), right: `calc(100% - ${pct(b.mean + b.sd)})` }} />
                    <i className="va-belief-dot" style={{ left: pct(b.mean) }} />
                  </>
                )}
              </div>}
            </li>
          ))}
        </ul>
        {!learning && <details className="va-how-guess">
          <summary>How Vire guesses</summary>
          <p className="va-small">Vire learns from the measured change and what you said together. The band shows how unsure it is; your own tries count more each time.</p>
        </details>}
      </section>

      <button className="va-btn va-btn-primary va-btn-big" onClick={onDone}>
        Done
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- settings

export function Settings({
  id,
  setting,
  onSetting,
  onTune,
  onReset,
  onClose,
  onHelp,
  reminderHour,
  onReminder,
}: {
  id: Identity
  setting: PingSetting
  onSetting(s: PingSetting): void
  /** open the tune step (asks for the camera inside this tap) */
  onTune(): void
  onReset(): void
  onClose(): void
  onHelp(): void
  reminderHour: number | null
  onReminder(hour: number): void
}) {
  const [confirm, setConfirm] = useState(false)
  const model = loadModel()
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    sheet.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const clinic = setting === 'clinic'
  return (
    <div className="va-sheet-wrap" onClick={onClose}>
      <div
        className="va-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={sheet}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="va-bar">
          <h2 className="va-h2 va-sheet-title">Settings</h2>
          <button className="va-icon-btn" onClick={onClose} aria-label="Close settings">
            <IconClose />
          </button>
        </header>

        <button
          className="va-switch-row"
          role="switch"
          aria-checked={clinic}
          onClick={() => onSetting(clinic ? 'home' : 'clinic')}
        >
          <span>
            <b>I’m at the clinic</b>
            <span className="va-small">
              Pings taken during your TMS course teach Vire what your echo looks like when you are well.
            </span>
          </span>
          <i className="va-switch" aria-hidden="true" />
        </button>

        <button className="va-row" onClick={onTune}>
          <span>
            <b>{model ? 'Tune again' : 'Teach Vire your face'}</b>
            <span className="va-small">
              {model
                ? `Two faces, about 15 seconds. Tuned ${new Date(model.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}; teach three more (about 25 seconds) later if you like.`
                : 'Two faces, about 15 seconds. Teach three more (about 25 seconds) later if you like.'}
            </span>
          </span>
          <IconArrow />
        </button>
        <LovedLaughCard />
        <ReminderCard hour={reminderHour} onChange={onReminder} />

        <button className="va-row" onClick={onHelp}>
          <span>
            <b>Need help now?</b>
            <span className="va-small">Emergency and crisis support numbers.</span>
          </span>
          <IconArrow />
        </button>

        {confirm ? (
          <div className="va-row va-row-confirm">
            <span>
              <b>Start over on this phone?</b>
              <span className="va-small">
                Vire forgets who you are here, and what it learned about your face. Your clinic keeps what it already has.
              </span>
            </span>
            <span className="va-row-btns">
              <button className="va-btn va-btn-quiet" onClick={() => setConfirm(false)}>
                Keep
              </button>
              <button className="va-btn va-btn-ink" onClick={onReset}>
                Start over
              </button>
            </span>
          </div>
        ) : (
          <button className="va-row" onClick={() => setConfirm(true)}>
            <span>
              <b>Start over</b>
              <span className="va-small">
                {id.name ? `Signed in as ${displayName(id.name)}. ` : ''}Room {roomCode(id.userId)}.
              </span>
            </span>
            <IconArrow />
          </button>
        )}

        <p className="va-small va-sheet-foot">
          Vire measures how you answer and compares it with your own usual. Only numbers leave this phone. {HONEST}
        </p>
      </div>
    </div>
  )
}

export function HelpSheet({ onClose }: { onClose(): void }) {
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    sheet.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !sheet.current) return
      const els = [...sheet.current.querySelectorAll<HTMLElement>('a,button,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'))
      if (!els.length) return
      const first = els[0]!, last = els[els.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="va-sheet-wrap" onClick={onClose}>
      <div className="va-sheet va-help-sheet" role="dialog" aria-modal="true" aria-label="Need help now" tabIndex={-1} ref={sheet} onClick={(e) => e.stopPropagation()}>
        <header className="va-bar">
          <h2 className="va-h2 va-sheet-title">Need help now?</h2>
          <button className="va-icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </header>
        <p className="va-lede">If you might hurt yourself or someone else, call emergency help now.</p>
        <a className="va-btn va-btn-primary va-btn-big" href="tel:112">Call 112</a>
        <a className="va-row" href="tel:0925250111">
          <span><b>MIELI crisis line</b><span className="va-small">09 2525 0111 · Finland</span></span>
          <IconArrow />
        </a>
        <p className="va-small va-sheet-foot">Vire is not watched by anyone in real time.</p>
      </div>
    </div>
  )
}
