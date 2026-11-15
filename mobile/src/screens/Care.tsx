// Care: the conversation with the clinic (the therapist tab of a guided programme), the weekly check-in as a stepper,
// and what the clinic sees. Everything here is a sample: no clinic uses Vire yet, nothing is sent or booked.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { back, go } from '../router'
import { CHAT, CHECKIN, DAYS, HEAD_DOWN_WEEK, NIGHT_WEEK, NURSE, RING, STEPS_WEEK, week } from '../data/sample'
import { BandBars, Spark } from '../ui/charts'
import { I } from '../ui/icons'
import { Badge, Btn, Chip, Delta, Research, Row, SampleNote, Screen, Section, Sheet, Stat } from '../ui/kit'
import './care.css'

const rise = (i: number) => ({ '--i': i }) as CSSProperties

/** a form with two ticked lines, in the set's own hand (24 px, 1.6 stroke, round caps) */
function FormIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3.800" width="14" height="16.400" rx="2.600" />
      <path d="M8.400 9.300l1.200 1.200 2-2.200M14 9.600h1.800M8.400 14.900l1.200 1.200 2-2.200M14 15.200h1.800" />
    </svg>
  )
}

// ---------- the check-in, kept on this phone ----------
const KEY = 'vire.app.checkin'
interface Saved {
  answers: Array<number | null>
  sent: boolean
  at?: string
}
const blank = (): Saved => ({ answers: CHECKIN.items.map(() => null), sent: false })
function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return blank()
    const s = JSON.parse(raw) as Partial<Saved>
    const answers = CHECKIN.items.map((_, i) => {
      const v = s.answers?.[i]
      return typeof v === 'number' && v >= 0 && v < CHECKIN.options.length ? v : null
    })
    return { answers, sent: !!s.sent && answers.every((a) => a != null), at: typeof s.at === 'string' ? s.at : undefined }
  } catch {
    return blank()
  }
}
function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode: the answers live for this visit only */
  }
}

// ---------- Care: the conversation ----------
interface Msg {
  id: string
  from: 'nurse' | 'you'
  text: string
  day?: string
  fresh?: boolean
  /** the time under the last bubble of a group */
  at?: string
  /** written in this visit, so it arrives with a small move */
  live?: boolean
  /** the answer to anything typed here: this is a sample, nobody reads it, and where help is */
  auto?: boolean
}
/** sample times for the sample messages, in their order: Wednesday's after that afternoon, today's after the 15:40
 *  breathing and the 16:20 call they are about */
const AT = ['17:12', '17:40', '17:44', '16:45', '16:46']
const SAMPLE: Msg[] = CHAT.map((m, i) => ({ ...m, id: `s${i}`, at: AT[i] }))
const now = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
/** the sample message a shared reading hangs under: "Today looks better after the breathing" */
const READING_AFTER = 3
/** what you wrote and booked, kept while the app is open: a reload starts clean */
const mem: { extra: Msg[]; slot: number | null; booked: boolean } = { extra: [], slot: null, booked: false }
/** where help is, said the same way wherever someone might write something real */
function HelpNow() {
  return (
    <>
      If you need help now, call <a href="tel:112">112</a> or the MIELI crisis line, <a href="tel:+358925250111">09 2525 0111</a>.
    </>
  )
}
/** no nurse is here, so nothing typed gets a nurse's answer: it gets this */
const SAMPLE_REPLY = 'This is a sample chat. Nobody reads what you write here, and nobody will answer.'
const autoReply = (n: number, live: boolean): Msg => ({ id: `n${n}`, from: 'nurse', text: SAMPLE_REPLY, at: now(), auto: true, live })
const SLOTS = [
  { day: 'Tomorrow', time: '09:15' },
  { day: 'Tomorrow', time: '14:40' },
  { day: 'Monday', time: '08:30' },
]

export function Care() {
  const [sent] = useState(() => load().sent)
  const [extra, setExtra] = useState<Msg[]>(() => mem.extra.map((m) => ({ ...m, live: false })))
  const [draft, setDraft] = useState('')
  const [sheet, setSheet] = useState(false)
  const [slot, setSlot] = useState<number | null>(mem.slot)
  const [grow, setGrow] = useState(0)
  const top = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const bar = useRef<HTMLFormElement>(null)
  const owed = useRef(false)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const scroller = () => top.current?.closest<HTMLElement>('.screen') ?? null

  useEffect(() => {
    mem.extra = extra
    mem.slot = slot
  }, [extra, slot])
  // leaving before the answer came: it is there when you come back
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      if (owed.current) mem.extra = [...mem.extra, autoReply(mem.extra.length, false)]
    },
    [],
  )

  // the field grows with what you write, and the chat keeps clear of it
  useLayoutEffect(() => {
    const ta = field.current
    const form = bar.current
    if (!ta || !form) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 118)}px`
    // care.css leaves room for a field of one line (50 px and the form's own 22 px of padding); the standing line
    // above it and any more lines of writing push the chat up
    setGrow(Math.max(0, form.offsetHeight - 72))
  }, [draft])

  // the chat opens at its newest message, without a move; the two tiles are a pull away at the top
  useLayoutEffect(() => {
    const el = scroller()
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // a new bubble comes into view
  useEffect(() => {
    if (!extra.length) return
    const el = scroller()
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [extra.length])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setExtra((x) => [...x, { id: `y${x.length}`, from: 'you', text, at: now(), live: true }])
    setDraft('')
    // one answer for a burst of messages, and no show of someone writing: nobody is
    timers.current.forEach(clearTimeout)
    owed.current = true
    timers.current = [
      setTimeout(() => {
        owed.current = false
        setExtra((x) => [...x, autoReply(x.length, true)])
      }, 700),
    ]
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    send()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const all = [...SAMPLE, ...extra]
  // the "New" line goes once you have answered
  const firstNew = extra.length ? -1 : all.findIndex((m) => m.fresh)
  const picked = slot == null ? null : SLOTS[slot]
  const heart = RING.heart.today

  return (
    <>
      <header className="care-top">
        <span className="cr-avatar">{NURSE.name[0]}</span>
        <div className="care-who">
          <h1 className="care-name">{NURSE.name}</h1>
          <p className="care-role">{NURSE.role}</p>
        </div>
        <Chip>Sample chat</Chip>
        <button className={`care-callbtn ${picked ? 'is-booked' : ''}`} onClick={() => setSheet(true)} aria-label={picked ? 'Call booked. Change it' : 'Book a call'}>
          {picked ? <I.check size={20} /> : <I.call size={20} />}
        </button>
      </header>

      <Screen className="care" glow="voice">
        <div ref={top} className="pad rise care-tiles" style={rise(0)}>
          <button className="care-tile" onClick={() => go('/care/checkin')}>
            <span className="badge is-ember">
              <FormIcon size={21} />
            </span>
            <span className="care-tile-t">Weekly check-in</span>
            <span className="care-tile-s">{sent ? `Sent to ${NURSE.name}` : '2 questions, two taps'}</span>
            <span className="care-tile-mark">{sent ? <I.check size={18} className="care-ok" /> : <Delta tone="off">Open</Delta>}</span>
          </button>
          <button className="care-tile" onClick={() => go('/care/clinic')}>
            <Badge icon="clinic" />
            <span className="care-tile-t">Clinic view</span>
            <span className="care-tile-s">What {NURSE.name} sees</span>
            <span className="care-tile-mark">
              <I.right size={18} />
            </span>
          </button>
        </div>

        <p className="small care-hours rise" style={rise(1)}>
          This is a sample chat. Nobody reads what you write here.
        </p>

        <div className="chat rise" style={rise(2)} role="log" aria-label={`Messages with ${NURSE.name}`}>
          {all.map((m, i) => {
            const prev = all[i - 1]
            const next = all[i + 1]
            const first = !prev || prev.from !== m.from || !!m.day || i === firstNew || (sent && i === SAMPLE.length)
            const last = !next || next.from !== m.from || !!next.day || i + 1 === firstNew || (sent && i === SAMPLE.length - 1)
            const endOfSample = i === SAMPLE.length - 1
            return (
              <Fragment key={m.id}>
                {m.day && <div className="chat-day">{m.day}</div>}
                {i === firstNew && (
                  <div className="chat-new" role="separator">
                    <span>New</span>
                  </div>
                )}
                <div className={`msg is-${m.from} ${first ? 'is-first' : ''} ${last ? 'is-last' : ''}`}>
                  {m.from === 'nurse' && <span className="msg-av">{last && !m.auto && <span className="cr-avatar is-xs">{NURSE.name[0]}</span>}</span>}
                  <div className={`bubble ${m.live ? 'is-live' : ''}`}>
                    <span className="vh">{m.from === 'you' ? 'You: ' : m.auto ? 'Vire: ' : `${NURSE.name}: `}</span>
                    {m.text}
                    {m.auto && (
                      <>
                        {' '}
                        <HelpNow />
                      </>
                    )}
                  </div>
                </div>

                {i === READING_AFTER && (
                  <button className="chat-card" onClick={() => go('/practice/breathing')}>
                    <span className="stat-top">
                      <Badge icon="breath" tone="ember" size={26} />
                      Slow breathing
                      <span className="chat-card-when num">15:40</span>
                    </span>
                    <span className="chat-read">
                      <span className="chat-read-v num">
                        79
                        <I.right size={18} />
                        71<small>bpm</small>
                      </span>
                      <Spark values={heart} tone="heart" w={96} h={38} />
                    </span>
                    <span className="pills">
                      <span className="pill num">
                        <I.heart size={14} /> 8 lower
                      </span>
                      <span className="pill num">
                        <I.move size={14} /> 38% stiller
                      </span>
                    </span>
                  </button>
                )}

                {endOfSample && (
                  <div className="chat-card">
                    <span className="chat-card-row">
                      <span className="badge is-ember">
                        <FormIcon size={21} />
                      </span>
                      <span>
                        <span className="row-title">Weekly check-in</span>
                        <span className="row-sub">{sent ? 'Your two answers' : '2 questions, two taps'}</span>
                      </span>
                    </span>
                    <Btn kind={sent ? 'quiet' : 'ember'} small wide to="/care/checkin">
                      {sent ? 'See your answers' : 'Start'}
                    </Btn>
                  </div>
                )}
                {endOfSample && picked && (
                  <button className="chat-card" onClick={() => setSheet(true)}>
                    <span className="chat-card-row">
                      <Badge icon="call" tone="voice" />
                      <span>
                        <span className="row-title">15 min call booked</span>
                        <span className="row-sub num">{`${picked.day} ${picked.time}`}</span>
                      </span>
                      <span className="chat-card-act">Change</span>
                    </span>
                  </button>
                )}

                {last && m.at && <div className={`msg-time is-${m.from} num`}>{m.at}</div>}
                {sent && endOfSample && (
                  <div className="chat-note">
                    <I.check size={14} />
                    You sent your weekly check-in
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>

        <SampleNote>A sample conversation. No clinic uses Vire yet, so nobody reads what you write.</SampleNote>
        <div style={{ height: grow }} />
      </Screen>

      <form ref={bar} className="composer" onSubmit={onSubmit}>
        <p className="composer-note">
          Sample chat. Nobody reads this. <HelpNow />
        </p>
        <div className="composer-field">
          <textarea
            ref={field}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => window.scrollTo(0, 0)}
            placeholder="Write a sample message"
            aria-label="Write a sample message. Nobody reads it"
            enterKeyHint="send"
            autoComplete="off"
          />
          <button type="submit" className="composer-send" disabled={!draft.trim()} aria-label="Send" onMouseDown={(e) => e.preventDefault()}>
            <I.send size={19} />
          </button>
        </div>
      </form>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={`A call with ${NURSE.name}`}>
        <p className="body-2">15 minutes on the phone. Pick a time.</p>
        <div className="group care-slots">
          {SLOTS.map((s, i) => (
            <button key={s.day + s.time} className="row" aria-pressed={slot === i} onClick={() => setSlot(slot === i ? null : i)}>
              <Badge icon="calendar" tone={slot === i ? 'ember' : 'plain'} />
              <span className="row-title num">
                {s.day} {s.time}
              </span>
              <span className="row-right">{slot === i && <I.check size={18} className="care-ok" />}</span>
            </button>
          ))}
        </div>
        <p className="small care-slots-note">Sample times. No clinic uses Vire yet, so nothing gets booked.</p>
      </Sheet>
    </>
  )
}

// ---------- the weekly check-in: one question a step ----------
const N = CHECKIN.items.length
const SUMMARY = N
const DONE = N + 1

export function CheckIn() {
  // a check-in that was left half way starts over: it is two taps
  const [saved, setSaved] = useState<Saved>(() => {
    const s = load()
    return s.sent ? s : blank()
  })
  const [step, setStep] = useState(() => (saved.sent ? DONE : 0))
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')
  const [out, setOut] = useState(false)
  /** the answer just tapped: it lights up for a beat before the step moves on */
  const [tap, setTap] = useState<number | null>(null)
  /** came from the summary to change one answer: go straight back there */
  const [fixing, setFixing] = useState(false)
  const busy = useRef(false)
  const pane = useRef<HTMLDivElement>(null)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  // every step starts at its top, also on a short phone where a step scrolls
  useLayoutEffect(() => {
    const el = pane.current?.closest<HTMLElement>('.screen')
    if (el) el.scrollTop = 0
  }, [step])
  const later = (f: () => void, ms: number) => void timers.current.push(setTimeout(f, ms))

  const keep = (s: Saved) => {
    setSaved(s)
    save(s)
  }
  const move = (to: number, d: 'fwd' | 'back') => {
    busy.current = true
    setDir(d)
    setOut(true)
    later(() => {
      setStep(to)
      setTap(null)
      setOut(false)
      busy.current = false
    }, 170)
  }
  const answer = (i: number) => {
    if (busy.current) return
    busy.current = true
    const answers = saved.answers.slice()
    answers[step] = i
    keep({ answers, sent: false })
    setTap(i)
    const to = fixing ? SUMMARY : step + 1
    setFixing(false)
    later(() => move(to, 'fwd'), 260)
  }
  const stepBack = () => {
    if (busy.current || step === 0) return
    setFixing(false)
    move(step - 1, 'back')
  }
  const fix = (i: number) => {
    if (busy.current) return
    setFixing(true)
    move(i, 'back')
  }
  const sendIt = () => {
    if (busy.current) return
    keep({ ...saved, sent: true, at: new Date().toISOString() })
    move(DONE, 'fwd')
  }
  const again = () => {
    if (busy.current) return
    keep(blank())
    move(0, 'back')
  }

  const sel = tap ?? (step < N ? saved.answers[step] : null)
  const share = step >= SUMMARY ? 1 : (step + 1) / (N + 1)

  return (
    <>
      <Screen nav="Check-in" flow backTo="/care" className="ci" glow={step === DONE ? 'ember' : 'plain'} right={step < N ? <span className="ci-count num">{`${step + 1} of ${N}`}</span> : null}>
        <div key={step} ref={pane} className={`ci-step is-${dir} ${out ? 'is-out' : ''}`}>
          {step < N ? (
            <>
              <div className="pad">
                <Chip>Sample check-in</Chip>
                <p className="ci-lead">{CHECKIN.lead}</p>
                <h1 className="title-xl voice ci-q">{CHECKIN.items[step]}</h1>
              </div>
              <div className="pad ci-bottom">
                <div className="ci-options" role="radiogroup" aria-label={CHECKIN.items[step]}>
                  {CHECKIN.options.map((o, i) => (
                    <button key={o} role="radio" aria-checked={sel === i} className="ci-option" onClick={() => answer(i)}>
                      <span>{o}</span>
                      <span className="ci-radio">
                        <I.check size={15} />
                      </span>
                    </button>
                  ))}
                </div>
                <div className="ci-foot">
                  {step > 0 ? (
                    <button className="ci-back" onClick={stepBack}>
                      <I.left size={18} />
                      Back
                    </button>
                  ) : (
                    <p className="small">The two PHQ-2 questions clinics use, asked here about one week.</p>
                  )}
                </div>
              </div>
            </>
          ) : step === SUMMARY ? (
            <>
              <div className="pad">
                <Chip>Sample check-in</Chip>
                <h1 className="title-xl voice ci-q">Here is what you said</h1>
                <p className="ci-lead">Tap a line to change it.</p>
                <div className="group ci-sum">
                  {CHECKIN.items.map((q, i) => (
                    <button key={q} className="ci-sum-row" onClick={() => fix(i)}>
                      <span>
                        <span className="ci-sum-q">{q}</span>
                        <span className="ci-sum-a">{CHECKIN.options[saved.answers[i] ?? 0]}</span>
                      </span>
                      <I.right size={18} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="pad ci-bottom">
                <Btn kind="ember" wide icon="send" onClick={sendIt}>
                  Send to {NURSE.name}
                </Btn>
                <div className="ci-foot">
                  <button className="ci-back" onClick={stepBack}>
                    <I.left size={18} />
                    Back
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ci-done">
                <div className="pad ci-done-top">
                  <span className="ci-seal">
                    <svg className="ci-tick" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
                      <path d="M11 23l7.500 7.500L33 14.500" pathLength={1} />
                    </svg>
                  </span>
                  <Chip>Sample: nothing was sent</Chip>
                  <h1 className="title-xl voice ci-done-title">Thank you. That is your week, in your own words.</h1>
                </div>
                <div className="pad">
                  <div className="group ci-next">
                    <Row icon="signals" title={`${NURSE.name} reads it`} sub="Next to this week’s signals" />
                    <Row icon="care" title="She writes back" sub="In Care, usually the next morning" />
                    <Row icon="calendar" title="The next one" sub="Opens in a week" />
                  </div>
                </div>
                <SampleNote>A sample of how it would go. Your answers stay on this phone.</SampleNote>
              </div>
              <div className="pad ci-bottom">
                <Btn wide onClick={() => back('/care')}>
                  Done
                </Btn>
                <div className="ci-foot is-mid">
                  <button className="ci-back" onClick={again}>
                    Answer again
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </Screen>
      <div className={`ci-progress ${step === DONE ? 'is-done' : ''}`} role="progressbar" aria-label="Check-in" aria-valuemin={0} aria-valuemax={N + 1} aria-valuenow={Math.min(step + 1, N + 1)}>
        <i style={{ transform: `scaleX(${share})` }} />
      </div>
    </>
  )
}

// ---------- what the clinic sees, and the booster ----------
const BOOSTER = { day: 'Friday', time: '10:30' }
const LIST = [
  { title: 'Drift that stayed', sub: 'Top of the list, with what was tried' },
  { title: 'Came back after a practice', sub: 'Lower on the list' },
  { title: 'Inside your own usual', sub: 'Not on the list' },
]
const steps = (v: number) => `${v.toLocaleString('en-GB')} steps`

export function Clinic() {
  const [sent] = useState(() => load().sent)
  const [booked, setBooked] = useState(mem.booked)
  useEffect(() => {
    mem.booked = booked
  }, [booked])
  // the days well under the usual band: the two the nurse writes about
  const low = STEPS_WEEK.days.filter((_, i) => STEPS_WEEK.steps[i] < STEPS_WEEK.lo * 0.8)
  // the same seven days as every other week in the app, today last: the numbers here are today's and last night's
  const stepsWeek = week(STEPS_WEEK.steps)
  const downWeek = week(HEAD_DOWN_WEEK.hours)
  const restWeek = week(NIGHT_WEEK.rest)
  const down = downWeek[downWeek.length - 1]
  const rest = restWeek[restWeek.length - 1]
  return (
    <Screen nav="Your clinic" backTo="/care" glow="move">
      <div className="pad rise" style={rise(0)}>
        <div className="clinic-top">
          <Chip>Sample week</Chip>
        </div>
        <h1 className="title-xl">What {NURSE.name} sees</h1>
        <p className="lede clinic-lede">Your week in a few numbers. Not your day.</p>
      </div>

      <div className="pad rise clinic-block" style={rise(1)}>
        <div className="card clinic-hero">
          <div className="clinic-hero-top">
            <span className="stat-top">
              <Badge icon="walk" tone="move" size={26} />
              Steps a day
            </span>
            <Delta tone="off">Low {low.join(' and ')}</Delta>
          </div>
          <BandBars values={stepsWeek} labels={DAYS} lo={STEPS_WEEK.lo} hi={STEPS_WEEK.hi} tone="move" fmt={steps} />
        </div>
      </div>

      <div className="pad rise clinic-block" style={rise(2)}>
        <div className="stat-grid">
          <Stat icon="move" tone="move" label="Head down" value={down.toFixed(1)} unit="h" sub={`Today · usual ${HEAD_DOWN_WEEK.lo} to ${HEAD_DOWN_WEEK.hi.toFixed(0)}`}>
            <Spark values={downWeek} tone="move" w={120} h={30} />
          </Stat>
          <Stat icon="heart" tone="heart" label="Night heart rate" value={rest} unit="bpm" sub={`Last night · usual ${NIGHT_WEEK.lo} to ${NIGHT_WEEK.hi}`}>
            <Spark values={restWeek} tone="heart" w={120} h={30} />
          </Stat>
          <Stat icon="breath" tone="ember" label="Practices" value="3 of 3" sub="Heart rate lower after" />
          {sent ? (
            <Stat label="Check-in" value="Sent" sub="Your two answers" />
          ) : (
            <Stat label="Check-in" value="Open" sub="2 questions, two taps" to="/care/checkin" />
          )}
        </div>
        <div className="pills clinic-not">
          <span className="pill">No audio</span>
          <span className="pill">No video</span>
          <span className="pill">Nothing hour by hour</span>
        </div>
      </div>

      <Section title="A booster session" i={3}>
        <div className={`card booster ${booked ? 'is-booked' : ''}`}>
          <span className="booster-sample">
            <Chip>Sample</Chip>
          </span>
          <div className="booster-head">
            <Badge icon={booked ? 'check' : 'calendar'} tone="ember" size={46} />
            <div>
              <div className="booster-say">{booked ? 'Booked with your clinic' : 'On offer from your clinic'}</div>
              <div className="booster-when num">
                {BOOSTER.day} <span>{BOOSTER.time}</span>
              </div>
            </div>
          </div>
          <p className="body-2 booster-why">TMS comes back when you start to slip, not on a fixed schedule.</p>
          {booked ? (
            <Btn kind="quiet" wide onClick={() => setBooked(false)}>
              Cancel
            </Btn>
          ) : (
            <Btn kind="ember" wide onClick={() => setBooked(true)}>
              Book it
            </Btn>
          )}
          <p className="small booster-note">Sample times. No clinic uses Vire yet, so nothing gets booked.</p>
        </div>
      </Section>

      <Section title="How the list works" i={4}>
        <div className="group">
          {LIST.map((l, i) => (
            <Row key={l.title} lead={<span className={`clinic-rank num ${i === 0 ? 'is-top' : ''}`}>{i + 1}</span>} title={l.title} sub={l.sub} />
          ))}
        </div>
      </Section>

      <Section i={5}>
        <div className="group">
          <a className="row clinic-link" href="/#/clinic">
            <Badge icon="clinic" />
            <span>
              <span className="row-title" style={{ display: 'block' }}>
                See the clinic’s side
              </span>
              <span className="row-sub" style={{ display: 'block' }}>
                The list a nurse works from. Simulated patients.
              </span>
            </span>
            <span className="row-right">
              <I.out size={18} />
            </span>
          </a>
        </div>
      </Section>

      <Research topic="tms" i={6} />
      <Research topic="loop" i={7} />

      <SampleNote>The week, the list and the booster are a sample. No clinic uses Vire yet, so nothing gets booked.</SampleNote>
    </Screen>
  )
}
