// Care: the conversation with the clinic (Meru's therapist tab), the weekly check-in as a stepper,
// and what the clinic sees. Everything here is a sample: no clinic uses Vire yet, nothing is sent or booked.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { back } from '../router'
import { CHAT, CHECKIN, NURSE } from '../data/sample'
import { I } from '../ui/icons'
import { Badge, Btn, Chip, Head, Research, Row, SampleNote, Screen, Section, Sheet } from '../ui/kit'
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
  /** written in this visit, so it arrives with a small move */
  live?: boolean
}
const SAMPLE: Msg[] = CHAT.map((m, i) => ({ ...m, id: `s${i}` }))
/** what you wrote and booked, kept while the app is open: a reload starts clean */
const mem: { extra: Msg[]; slot: number | null; booked: boolean; replies: number } = { extra: [], slot: null, booked: false, replies: 0 }
const REPLIES = ['Thanks, got it. I read messages in the morning and will write back then.', 'Got this one too. I’ll read it all in the morning.', 'It’s all here. I’ll read it in the morning.']
const SLOTS = [
  { day: 'Tomorrow', time: '09:15' },
  { day: 'Tomorrow', time: '14:40' },
  { day: 'Monday', time: '08:30' },
]

export function Care() {
  const [sent] = useState(() => load().sent)
  const [extra, setExtra] = useState<Msg[]>(() => mem.extra.map((m) => ({ ...m, live: false })))
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [slot, setSlot] = useState<number | null>(mem.slot)
  const [pinned, setPinned] = useState(false)
  const [grow, setGrow] = useState(0)
  const top = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const bar = useRef<HTMLFormElement>(null)
  const base = useRef(0)
  const owed = useRef(false)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const scroller = () => top.current?.closest<HTMLElement>('.screen') ?? null

  // the small bar with her name arrives once the header has scrolled away
  useEffect(() => {
    const el = scroller()
    if (!el) return
    const on = () => setPinned(el.scrollTop > 76)
    on()
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    mem.extra = extra
    mem.slot = slot
  }, [extra, slot])
  // leaving before she has answered: the answer is there when you come back
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      if (owed.current) mem.extra = [...mem.extra, { id: `n${mem.extra.length}`, from: 'nurse', text: REPLIES[mem.replies++ % REPLIES.length] }]
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
    if (!base.current) base.current = form.offsetHeight
    setGrow(Math.max(0, form.offsetHeight - base.current))
  }, [draft])

  // a new bubble, or her writing, comes into view
  useEffect(() => {
    if (!extra.length && !typing) return
    const el = scroller()
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [extra.length, typing])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setExtra((x) => [...x, { id: `y${x.length}`, from: 'you', text, live: true }])
    setDraft('')
    // one reply for a burst of messages
    timers.current.forEach(clearTimeout)
    owed.current = true
    timers.current = [
      setTimeout(() => setTyping(true), 450),
      setTimeout(() => {
        owed.current = false
        setTyping(false)
        setExtra((x) => [...x, { id: `n${x.length}`, from: 'nurse', text: REPLIES[mem.replies++ % REPLIES.length], live: true }])
      }, 1650),
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

  return (
    <>
      <header className={`navbar care-bar ${pinned ? 'is-solid' : ''}`} aria-hidden={!pinned} inert={!pinned || undefined}>
        <span />
        <div className="navbar-title care-bar-who">
          <span className="care-avatar is-s">{NURSE.name[0]}</span>
          {NURSE.name}
        </div>
        <div className="navbar-right">
          <button className="care-bar-call" onClick={() => setSheet(true)} aria-label="Book a call">
            <I.call size={20} />
          </button>
        </div>
      </header>

      <Screen className="care">
        <div ref={top} className="pad rise care-head" style={rise(0)}>
          <span className="care-avatar">{NURSE.name[0]}</span>
          <div className="care-who">
            <h1 className="title-xl">{NURSE.name}</h1>
            <p className="care-role">{NURSE.role}</p>
          </div>
          <button className={`care-call ${picked ? 'is-booked' : ''}`} onClick={() => setSheet(true)}>
            {picked ? <I.check size={16} /> : <I.call size={16} />}
            {picked ? 'Call booked' : 'Book a call'}
          </button>
        </div>

        <div className="pad rise care-rows" style={rise(1)}>
          <div className="group">
            <Row
              lead={
                <span className="badge is-ember">
                  <FormIcon size={21} />
                </span>
              }
              title="Weekly check-in"
              sub={sent ? `Sent to ${NURSE.name}` : '4 questions, 2 min'}
              right={sent ? <I.check size={18} className="care-ok" /> : <Chip tone="ember">Open</Chip>}
              to="/care/checkin"
            />
            <Row icon="clinic" title="What your clinic sees" sub="Your week in a few lines" to="/care/clinic" />
            {picked && <Row icon="call" tone="voice" title={`Call with ${NURSE.name}`} sub={<span className="num">{`${picked.day} ${picked.time}, 15 min`}</span>} right="Change" chevron={false} onClick={() => setSheet(true)} />}
          </div>
        </div>

        <p className="small care-hours rise" style={rise(2)}>
          {NURSE.name} reads messages in the morning. If it cannot wait, call 112.
        </p>

        <div className="chat rise" style={rise(3)} role="log" aria-label={`Messages with ${NURSE.name}`}>
          {all.map((m, i) => {
            const prev = all[i - 1]
            const first = !prev || prev.from !== m.from || !!m.day || i === firstNew || (sent && i === SAMPLE.length)
            return (
              <Fragment key={m.id}>
                {m.day && <div className="chat-day">{m.day}</div>}
                {i === firstNew && (
                  <div className="chat-new" role="separator">
                    New
                  </div>
                )}
                <div className={`bubble is-${m.from} ${first ? 'is-first' : ''} ${m.live ? 'is-live' : ''}`}>
                  <span className="vh">{m.from === 'you' ? 'You: ' : `${NURSE.name}: `}</span>
                  {m.text}
                </div>
                {sent && i === SAMPLE.length - 1 && (
                  <div className="chat-note">
                    <I.check size={14} />
                    You sent your weekly check-in
                  </div>
                )}
              </Fragment>
            )
          })}
          {typing && (
            <div className="bubble is-nurse is-first is-live is-typing" aria-label={`${NURSE.name} is writing`}>
              <i />
              <i />
              <i />
            </div>
          )}
        </div>

        <SampleNote>A sample conversation. No clinic uses Vire yet.</SampleNote>
        <div style={{ height: grow }} />
      </Screen>

      <form ref={bar} className="composer" onSubmit={onSubmit}>
        <div className="composer-field">
          <textarea
            ref={field}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => window.scrollTo(0, 0)}
            placeholder={`Message ${NURSE.name}`}
            aria-label={`Message ${NURSE.name}`}
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
  // a check-in that was left half way starts over: it is four taps
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
      <Screen nav="Check-in" flow backTo="/care" className="ci" right={step < N ? <span className="ci-count num">{`${step + 1} of ${N}`}</span> : null}>
        <div key={step} ref={pane} className={`ci-step is-${dir} ${out ? 'is-out' : ''}`}>
          {step < N ? (
            <>
              <div className="pad">
                <p className="ci-lead">{CHECKIN.lead}</p>
                <h1 className="title-xl ci-q">{CHECKIN.items[step]}</h1>
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
                    <p className="small">Four questions from the PHQ-9, the form clinics use.</p>
                  )}
                </div>
              </div>
            </>
          ) : step === SUMMARY ? (
            <>
              <div className="pad">
                <h1 className="title-xl">Here is what you said</h1>
                <p className="lede ci-sub">{NURSE.name} reads it as you gave it, next to this week’s signals. Tap a line to change it.</p>
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
                <Btn wide icon="send" onClick={sendIt}>
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
                <div className="pad">
                  <svg className="ci-tick" width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                    <circle cx="32" cy="32" r="30.500" />
                    <path d="M21 33.500l7.500 7.500L43.500 24.500" pathLength={1} />
                  </svg>
                  <h1 className="title-xl">Sent to {NURSE.name}</h1>
                  <p className="lede ci-sub">Here is what happens next.</p>
                  <div className="group ci-next">
                    <Row icon="signals" title={`${NURSE.name} reads it`} sub="Together with this week’s signals" />
                    <Row icon="care" title="She writes back" sub="In Care, usually the next morning" />
                    <Row icon="calendar" title="The next one" sub="Opens in a week" />
                  </div>
                </div>
                <SampleNote>This is a sample. Nothing was sent.</SampleNote>
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
const BOOSTER = 'Friday 10:30'
const LIST = [
  { title: 'Drift that stayed', sub: 'Top of the list, with what was tried' },
  { title: 'Came back after a practice', sub: 'Lower on the list' },
  { title: 'Inside your own usual', sub: 'Not on the list' },
]

export function Clinic() {
  const [sent] = useState(() => load().sent)
  const [booked, setBooked] = useState(mem.booked)
  useEffect(() => {
    mem.booked = booked
  }, [booked])
  return (
    <Screen nav="Your clinic" backTo="/care">
      <Head title="Your clinic" sub="It sees the week in a few lines, not your day." />

      <Section title="This week" i={1}>
        <div className="group">
          <Row icon="move" tone="move" title="Two quieter afternoons" sub="Tuesday and Wednesday: you moved and talked less than your usual." />
          <Row icon="breath" tone="ember" title="Three practices offered" sub="You were calmer after two: heart rate down, head stiller." />
          {sent ? (
            <Row
              lead={
                <span className="badge">
                  <FormIcon size={21} />
                </span>
              }
              title="Your check-in"
              sub="Your four answers, as you gave them."
              right={<I.check size={18} className="care-ok" />}
            />
          ) : (
            <Row
              lead={
                <span className="badge">
                  <FormIcon size={21} />
                </span>
              }
              title="Your check-in"
              sub="Not sent yet this week. 2 min."
              to="/care/checkin"
            />
          )}
        </div>
        <p className="small clinic-under">That is all of it. No audio, no video, nothing hour by hour.</p>
      </Section>

      <Section title="How the list works" i={2}>
        <p className="body-2">Drift the practices do not fix goes to the top of your clinic’s list, with what was tried.</p>
        <div className="group clinic-list">
          {LIST.map((l, i) => (
            <Row key={l.title} lead={<span className={`clinic-rank num ${i === 0 ? 'is-top' : ''}`}>{i + 1}</span>} title={l.title} sub={l.sub} />
          ))}
        </div>
      </Section>

      <Section title="A booster session" i={3}>
        <div className={`card booster ${booked ? 'is-booked' : ''}`}>
          <div className="booster-head">
            <Badge icon={booked ? 'check' : 'calendar'} tone="ember" size={46} />
            <div>
              <div className="row-sub booster-say">{booked ? 'Booked with your clinic' : 'On offer from your clinic'}</div>
              <div className="title-l num">{BOOSTER}</div>
            </div>
          </div>
          <p className="body-2 booster-why">Your clinic can bring TMS back when you start to slip, not on a fixed schedule.</p>
          {booked ? (
            <Btn kind="quiet" wide onClick={() => setBooked(false)}>
              Cancel
            </Btn>
          ) : (
            <Btn wide onClick={() => setBooked(true)}>
              Book it
            </Btn>
          )}
        </div>
      </Section>

      <Section i={4}>
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

      <Research topic="tms" i={5} />
      <Research topic="loop" i={6} />

      <SampleNote>The week, the list and the booster are a sample. No clinic uses Vire yet, so nothing gets booked.</SampleNote>
    </Screen>
  )
}
