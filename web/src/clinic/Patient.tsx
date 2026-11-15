import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChannelMultiples } from './charts/ChannelMultiples'
import { EchoChart, EchoLegend, timeDomain } from './charts/EchoChart'
import { OuterChart, OuterLegend, PracticeMark, practiceState } from './charts/OuterChart'
import { TraceStrip } from './charts/TraceStrip'
import { PRACTICE_LABEL, STATUS_LABEL, ago, chLabel, echoNow, words, fetchTraces, fmtDay, fmtDayYear, fmtSlot, fmtTime, fmtWeekday, isMock, practiceWords, roomCode, setBooster, signed, silentDays, useCalled, usePatient, viewStatus } from './data'
import type { OuterRow, PingTraces, PracticeKind, PracticeRec } from '@shared/types'
import { synthTraces } from './dev/synth'
import { Check, StatusMark, href, statusDetail } from './Today'
import { displayName } from '../shared/name'

export default function Patient() {
  const { id } = useParams()
  const { detail, source, loading, stale, reload, setDetail } = usePatient(id)
  const [hover, setHover] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const called = useCalled()

  const domain = useMemo(() => (detail ? timeDomain(detail) : ([0, 1] as [number, number])), [detail])
  const lastFull = useMemo(() => (detail ? [...detail.timeline].reverse().find((p) => p.kind === 'full') ?? null : null), [detail])
  // the strip shows the latest ping, or the one picked on the main chart
  const [sel, setSel] = useState<number | null>(null)
  const [picked, setPicked] = useState<{ pingId: string; data: PingTraces | null } | null>(null)
  const selPing = detail && sel !== null ? detail.timeline[sel] ?? null : null
  const selId = selPing?.pingId ?? null
  useEffect(() => {
    if (!selId) return
    let dead = false
    void fetchTraces(selId, source).then((data) => !dead && setPicked({ pingId: selId, data }))
    return () => {
      dead = true
    }
  }, [selId, source])
  useEffect(() => setSel(null), [id])
  const shownPing = selPing ?? lastFull
  const traces = useMemo(() => {
    if (!detail || !shownPing) return null
    const illustrative = () => ({ data: synthTraces(Math.min(1.2, Math.max(0.35, 1 + ((shownPing.strength - 50) / 15) * 0.27)), 3), real: false })
    if (selPing) {
      if (picked && picked.pingId === selPing.pingId && picked.data) return { data: picked.data, real: true }
      return source === 'mock' || (picked && picked.pingId === selPing.pingId) ? illustrative() : null
    }
    if (detail.traces && detail.traces.t?.length) return { data: detail.traces, real: true }
    return illustrative()
  }, [detail, shownPing, selPing, picked, source])

  if (!detail) {
    return (
      <main className="cl-page">
        <Link to={href('/clinic')} className="cl-back">
          <Back /> Call list
        </Link>
        {loading ? (
          <>
            {stale && (
              <p className="cl-offline" role="status">
                <b>The server is not answering.</b> Trying again every few seconds.
              </p>
            )}
            <div className="cl-skel cl-skel--person" aria-busy="true" aria-label="Loading this person">
              {Array.from({ length: 4 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
          </>
        ) : (
          <section className="cl-none">
            <h1>Nobody here with that id</h1>
            <p>This link does not match anyone in the clinic. Open the person from the call list.</p>
            <Link to={href('/clinic')} className="cl-btn cl-btn--primary">
              Back to the call list
            </Link>
          </section>
        )}
      </main>
    )
  }

  const vs = viewStatus(detail)
  // a simulated person is simulated days with AirPods in; a real phone did the one-minute camera check
  const air = detail.synthetic
  const W = words(air)
  const sd = statusDetail(detail, vs)
  const calledAt = called.calledAt(detail.id)
  const course = detail.course
  const ongoing = course ? Date.parse(course.end) > Date.now() : false
  const o = detail.outer ?? null
  const booking = o?.booster ?? null
  const upcoming = booking && Date.parse(booking.at) > Date.now() ? booking : null
  const slots = detail.boosterSlots ?? []
  const chosen = slot && slots.includes(slot) ? slot : slots[0] ?? null
  const fullPings = detail.timeline.filter((p) => p.kind === 'full')
  const latestPHQ = detail.phq2?.at(-1) ?? null
  const echo = echoNow(detail)
  const quiet = vs === 'quiet'
  const outerAction = o?.state === 'escalated' ? 'Talk about a booster session' : o?.state === 'booked' ? 'Booster booked' : o?.state === 'after' ? 'Follow the line after the booster' : null
  const action = outerAction ?? (detail.status === 'calibrating' ? 'Ask them back for a rating' : quiet || vs === 'low' || vs === 'dipping' ? 'Call this week' : latestPHQ && latestPHQ.total >= 3 ? 'Ask them back for a rating' : 'Keep watching')
  const actionFacts = o && (o.state === 'escalated' || o.state === 'booked' || o.state === 'after')
    ? outerFacts(o)
    : detail.status === 'calibrating'
    ? [`${fullPings.length} of 3 ${W.many} so far`, 'No usual of their own yet', 'A rating gives the clinic another view']
    : [echo == null ? `${W.last} not read` : `${W.last} ${echo}/100, 50 is their usual`, quiet ? cap(W.silent(Math.max(1, silentDays(detail.lastPingAt) ?? 1))) : latestPHQ && latestPHQ.total >= 3 ? `PHQ-2 self-report: ${latestPHQ.total} of 6, at or over its cut-off of 3` : `PHQ-2 self-report: ${latestPHQ ? `${latestPHQ.total} of 6, under its cut-off of 3` : 'not answered recently'}`, detail.boosterRequested ? 'Booster requested' : 'No booster request']

  const toggleBooster = async () => {
    const on = !detail.boosterRequested
    setBusy(true)
    setError(null)
    setDetail({ ...detail, boosterRequested: on })
    try {
      await setBooster(detail.id, on, source)
      await reload()
    } catch {
      setDetail({ ...detail, boosterRequested: !on })
      setError('The request did not reach the server. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  /** book the chosen slot (or the next free one), or cancel the booking */
  const book = async (on: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await setBooster(detail.id, on, source, on ? chosen ?? undefined : undefined)
      await reload()
    } catch {
      setError(on ? 'The booking did not reach the server. Check the connection and try again.' : 'The cancellation did not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const triedCard = (
    <section className="cl-card">
      <div className="cl-card-head">
        <div>
          <h2>What we tried</h2>
          <p>
            Each practice is scored as the phone scores it: how much stiller the head sat in the short check after it than before. Settled means at least 10% stiller. That check asks the person to sit still, so it reads restlessness. It is not the head movement above, which is how much they move through a day: there, moving less than their usual is the change to watch.
          </p>
        </div>
      </div>
      <Practices practices={detail.practices ?? []} working={o?.working ?? null} />
    </section>
  )

  return (
    <main className="cl-page cl-patient">
      <Link to={href('/clinic')} className="cl-back">
        <Back /> Call list
      </Link>
      {stale && (
        <p className="cl-offline" role="status">
          <b>The server is not answering.</b> This is the last page it sent; it refreshes by itself.
        </p>
      )}
      {!stale && source === 'mock' && !isMock() && (
        <p className="cl-offline" role="status">
          <b>The server is not answering.</b> This is a built-in sample person, not your clinic’s patient.
        </p>
      )}

      <header className="cl-phead">
        <div className="cl-phead-main">
          <div className="cl-phead-title">
            <h1 title={detail.name}>{displayName(detail.name)}</h1>
            {detail.synthetic && <p className="cl-phead-source">Simulated person: every number on this page is generated</p>}
            <span className={`cl-status is-${vs}`}>
              <StatusMark status={vs} />
              <b>{STATUS_LABEL[vs]}</b>
              {sd && <span>{sd}</span>}
            </span>
          </div>
          <dl className="cl-facts">
            {course && (
              <div>
                <dt>TMS course</dt>
                <dd>
                  {fmtDay(course.start)} to {fmtDayYear(course.end)}, {course.sessions} sessions{ongoing ? ' (in progress)' : ''}
                </dd>
              </div>
            )}
            {detail.daysSinceCourse !== null && (
              <div>
                <dt>Since course</dt>
                <dd>day {detail.daysSinceCourse}</dd>
              </div>
            )}
            <div>
              <dt>{W.last}</dt>
              <dd>{echo == null ? 'not read' : `${echo}/100`}</dd>
            </div>
            <div>
              <dt>{W.lastIn}</dt>
              <dd>{ago(detail.lastPingAt)}</dd>
            </div>
            <div>
              <dt>Last 7 days</dt>
              <dd>{W.count(detail.adherence7)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {detail.live ? (
                  <Link to={href(`/clinic/live/${roomCode(detail.id)}`)} className="cl-inline-link">
                    <i className="cl-livedot" />
                    Live now, watch
                  </Link>
                ) : detail.synthetic ? (
                  'Simulated AirPods days'
                ) : (
                  'Real phone, one-minute camera check'
                )}
              </dd>
            </div>
          </dl>
          <p className="cl-summary">{practiceWords(detail.summary)}</p>
        </div>

        <div className="cl-actions">
          {upcoming ? (
            <div className="cl-done">
              <span>
                <Check /> Booster booked
              </span>
              <b className="cl-slot-booked">{fmtSlot(upcoming.at)}</b>
              <small>{upcoming.by === 'simulated' ? 'A simulated booking, part of this simulated person’s story.' : `Booked ${fmtDay(upcoming.bookedAt)}. ${detail.synthetic ? 'A real person’s phone would show a check-in notice now; this person is simulated, and a booking made here clears itself after 20 minutes.' : 'Their app shows a check-in notice.'}`}</small>
              <button type="button" className="cl-link" onClick={() => book(false)} disabled={busy}>
                Cancel booking
              </button>
            </div>
          ) : booking ? (
            <div className="cl-done">
              <span>Booster session {fmtDay(booking.at)}</span>
              <small>{booking.by === 'simulated' ? 'Simulated: this person and their booster are made up.' : 'Booked on this screen.'}</small>
            </div>
          ) : o && slots.length > 0 ? (
            <div className="cl-book">
              <button type="button" className="cl-btn cl-btn--primary" onClick={() => book(true)} disabled={busy || !chosen}>
                Book a booster session
              </button>
              <div className="cl-slots" role="radiogroup" aria-label="Free slots">
                {slots.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={s === chosen} className={`cl-slot${s === chosen ? ' is-on' : ''}`} onClick={() => setSlot(s)}>
                    {fmtSlot(s)}
                  </button>
                ))}
              </div>
              <small>The next free slots. Booking is the clinician’s decision.</small>
            </div>
          ) : detail.boosterRequested ? (
            <div className="cl-done">
              <span>
                <Check /> Booster session requested
              </span>
              <small>{detail.synthetic ? 'A real person’s phone would show a check-in notice now; this person is simulated.' : 'Their app now shows a check-in notice.'}</small>
              <button type="button" className="cl-link" onClick={toggleBooster} disabled={busy}>
                Withdraw request
              </button>
            </div>
          ) : (
            <button type="button" className="cl-btn cl-btn--primary" onClick={toggleBooster} disabled={busy}>
              Request booster session
            </button>
          )}
          <button type="button" className={`cl-btn${calledAt ? ' is-done' : ''}`} onClick={() => called.toggle(detail.id)} aria-pressed={!!calledAt}>
            {calledAt ? (
              <>
                <Check /> Called today {fmtTime(calledAt)} · Undo
              </>
            ) : (
              'Mark called'
            )}
          </button>
          {error && (
            <p className="cl-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </header>

      <section className="cl-next" aria-labelledby="cl-next-title">
        <div className="cl-next-head">
          <h2 id="cl-next-title">{action}</h2>
          <p>A suggested next step. Vire does not diagnose. It tells you who to look at.</p>
        </div>
        <ul className="cl-next-facts">{actionFacts.slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}</ul>
        {o?.sentence && (o.state === 'escalated' || o.state === 'booked') ? (
          <div className="cl-next-path">
            <p className="cl-say cl-say--detail">
              <span>On the phone</span>
              &ldquo;{o.sentence}&rdquo;
            </p>
            <p>Then take the clinic’s own rating. Bringing TMS back when people worsen is backed by open-label studies (Janicak et al. 2010), not by a randomised trial. <span>Suggestion for a clinician, never an instruction.</span></p>
          </div>
        ) : o?.state === 'after' ? (
          <p className="cl-next-path">Keep watching the line after the booster. If their days slip below their usual again and the practices do not bring them back, they come back to the top of the list. <span>Suggestion for a clinician, never an instruction.</span></p>
        ) : (
          <p className="cl-next-path">Call and take the clinic’s own rating. If it is worse two weeks running, Janicak et al. 2010 supports offering TMS reintroduction. Otherwise, keep watching. <span>Suggestion for a clinician, never an instruction.</span></p>
        )}
      </section>

      {o && (
        <section className="cl-card cl-card--outer">
          <div className="cl-card-head">
            <div>
              <h2>Their days against their usual, and the practices</h2>
              <p>One point a day: how far the day sat from this person’s own usual, in SD. The band is their usual. Under it, every practice the phone offered after a day below the band, or that they opened themselves.</p>
            </div>
            <OuterLegend />
          </div>
          <OuterChart detail={detail} />
          {o.after && (
            <p className={`cl-after${o.after.simulated ? ' is-sim' : ''}`}>
              {o.after.simulated && <b>Simulated response to the booster. </b>}
              {o.after.days} {o.after.days === 1 ? 'day' : 'days'} since the booster; the day now sits at {signed(o.after.drift)} SD, {o.after.drift > -0.75 ? 'inside' : 'below'} their usual.
              {o.after.simulated ? ' This person, the booster and the line after it are made up to show the loop. No patient has had a booster through Vire.' : ''}
              {!o.after.simulated && detail.synthetic ? ' This simulated person’s days were made before the booking, so they do not show a response to it.' : ''}
            </p>
          )}
          {upcoming && <p className="cl-note">The line after the booster starts on {fmtDay(upcoming.at)}.</p>}
        </section>
      )}

      <section className="cl-card cl-card--main">
        <div className="cl-card-head">
          <div>
            <h2>{air ? 'Each day with AirPods in, from the first session to today' : 'Each camera check, from the first one to today'}</h2>
            <p>
              {air
                ? detail.status === 'calibrating'
                  ? 'One mark per simulated day with AirPods in, scored 0 to 100. Until three days are in, it is scored against typical values, not yet against this person.'
                  : "One mark per simulated day with AirPods in, scored 0 to 100 against this person’s own usual, set in the last two weeks of the course: 50 is their usual. The line is the smoothed drift. Point at a day to see its four signals."
                : detail.status === 'calibrating'
                  ? 'Each mark is one one-minute camera check, scored 0 to 100. Until three are in, it is scored against typical values, not yet against this person. Click a check to see its traces.'
                  : "Each mark is one one-minute camera check, scored 0 to 100 against this person’s own usual: 50 is their usual. The line is the smoothed drift. Click a check to see its traces."}
            </p>
          </div>
          <EchoLegend calibrating={detail.status === 'calibrating'} air={air} phq2={(detail.phq2?.length ?? 0) > 0} />
        </div>
        {detail.status === 'calibrating' ? (
          <div className="cl-calibrating-readings">
            <b>{air ? 'Their usual appears after three days with AirPods in.' : 'Their usual appears after three camera checks.'}</b>
            <p>{(detail.timeline.at(-1)?.components ?? []).map((c) => `${chLabel(c.channel, air)}: ${c.value == null ? 'not read' : air ? 'read' : c.value}`).join(' · ')}</p>
          </div>
        ) : detail.timeline.length ? (
          <EchoChart detail={detail} domain={domain} hover={hover} onHover={setHover} selected={air ? null : sel} onSelect={air ? undefined : setSel} />
        ) : (
          <p className="cl-empty">{air ? 'No days with AirPods in yet.' : 'No camera checks yet.'} The first one draws the first point here.</p>
        )}
      </section>

      {detail.phq2 && detail.phq2.length > 0 && (
        <p className="cl-note">PHQ-2 is a two-question self-report; 3 or more is its published screening cut-off (Kroenke 2003). Its answers are drawn on the same time axis for context. Vire has not been compared with it.</p>
      )}

      <section className="cl-card">
        <div className="cl-card-head">
          <div>
            <h2>{air ? 'The four signals, against their usual' : 'The four camera readings, raw'}</h2>
            <p>
              {air
                ? detail.status === 'calibrating'
                  ? 'Each simulated signal on the same time axis, in SD from typical values until this person has a usual of their own.'
                  : "Each simulated signal on the same time axis, in SD from this person’s own usual. The band is their usual, set in the last two weeks of the course. Head down and heart rate are drawn up when the head is down longer or the heart rate is higher."
                : detail.status === 'calibrating'
                  ? 'Measured values on the same time axis. The band is a typical range, centre ± spread, until this person has a usual of their own.'
                  : "Measured values on the same time axis. The band is this person’s usual, centre ± spread."}
            </p>
          </div>
        </div>
        <ChannelMultiples detail={detail} domain={domain} hover={hover} onHover={setHover} />
      </section>

      {/* the camera check's traces are camera and microphone readings: only real phones have them */}
      {air ? (
        triedCard
      ) : (
        <div className={(detail.practices?.length ?? 0) > 0 ? 'cl-two' : ''}>
          {(detail.practices?.length ?? 0) > 0 && triedCard}

        <section className="cl-card">
          <div className="cl-card-head">
            <div>
              <h2>{selPing ? 'The picked camera check, second by second' : 'The latest camera check, second by second'}</h2>
              <p>
                {shownPing ? `${fmtWeekday(shownPing.at)} ${fmtTime(shownPing.at)}, ${shownPing.setting === 'clinic' ? 'in the clinic' : 'at home'}, scored ${Math.round(shownPing.strength)}.` : ''} Tinted cells are where each stimulus meets the signal it is meant to move.
              </p>
            </div>
            {selPing && (
              <button type="button" className="cl-link" onClick={() => setSel(null)}>
                Back to the latest check
              </button>
            )}
          </div>
          {traces ? <TraceStrip traces={traces.data} /> : <p className="cl-empty">{shownPing ? 'Loading the traces of this check.' : 'No camera check yet, so no traces.'}</p>}
          {traces && !traces.real && <p className="cl-note">Illustrative trace, scaled to this check’s score. The server did not return stored traces for it.</p>}
          {traces && traces.real && detail.synthetic && <p className="cl-note">Simulated trace.</p>}
        </section>
        </div>
      )}

      <footer className="cl-foot">
        {detail.synthetic && <span>Simulated person: every number on this page is generated{source === 'mock' ? ' by the built-in mock' : ''}.</span>}
        <span>Only numbers leave the phone: no video, no audio. A signal for the clinic, not a diagnosis.</span>
        <span>Demo clinic, open to anyone with the link. A real one sits behind the clinic’s own sign-in.</span>
        <details className="cl-sources">
          <summary>Sources</summary>
          <p>Janicak et al. 2010, <i>Brain Stimul</i> 3(4):187–199. doi:10.1016/j.brs.2010.07.003</p>
          <p>Kroenke, Spitzer &amp; Williams 2003, <i>Med Care</i> 41(11):1284–1292. doi:10.1097/01.MLR.0000093487.78664.3C</p>
        </details>
      </footer>
    </main>
  )
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function Back() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function outerFacts(o: OuterRow): string[] {
  const t = o.inDrift
  if (o.state === 'after' && o.after) {
    return [`Booster ${o.after.days} ${o.after.days === 1 ? 'day' : 'days'} ago`, `Now ${signed(o.after.drift)} SD against their usual`, `${t.done} of ${t.offered} practices done before it, ${t.settled} settled`]
  }
  return [`${o.driftDays} ${o.driftDays === 1 ? 'day' : 'days'} below their usual`, `In those days: ${t.done} of ${t.offered} offered practices done, ${t.settled} settled`, practiceWords(o.working.text)]
}

const WHY: Record<PracticeRec['why'], string> = { drift: 'after a day below usual', asked: 'opened by them' }
const KINDS: PracticeKind[] = ['breathe', 'scan', 'walk']

/** per kind: offered, done, settled, usual change; then every practice, newest first */
function Practices({ practices, working }: { practices: PracticeRec[]; working: OuterRow['working'] | null }) {
  const [all, setAll] = useState(false)
  if (!practices.length) return <p className="cl-empty">No practices yet. The phone offers one after a day below their usual.</p>
  const rows = KINDS.map((k) => {
    const xs = practices.filter((p) => p.kind === k)
    const done = xs.filter((p) => p.done && p.settle != null)
    const mean = done.length ? done.reduce((a, p) => a + (p.settle ?? 0), 0) / done.length : null
    return { k, offered: xs.length, done: done.length, settled: done.filter((p) => (p.settle ?? 0) >= 10).length, mean }
  }).filter((r) => r.offered > 0)
  const list = [...practices].reverse()
  const shown = all ? list : list.slice(0, 8)
  return (
    <>
      <table className="cl-ptable">
        <thead>
          <tr>
            <th>Practice</th>
            <th>Offered</th>
            <th>Done</th>
            <th>Settled</th>
            <th>Usual change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className={working?.best === r.k ? 'is-best' : ''}>
              <td>
                <svg width="14" height="14" aria-hidden="true">
                  <PracticeMark kind={r.k} state="settled" />
                </svg>
                {PRACTICE_LABEL[r.k]}
              </td>
              <td>{r.offered}</td>
              <td>{r.done}</td>
              <td>{r.settled}</td>
              <td>{r.mean == null ? 'not done' : r.mean >= 0 ? `${Math.round(r.mean)}% stiller` : `${Math.round(-r.mean)}% less still`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {working && <p className="cl-plain"><b>{practiceWords(working.text)}.</b> {working.said === 'learned' ? 'The phone offers it first.' : 'The phone keeps comparing.'}</p>}
      <ol className="cl-plist">
        {shown.map((p) => (
          <li key={p.at}>
            <svg width="14" height="14" aria-hidden="true">
              <PracticeMark kind={p.kind} state={practiceState(p)} />
            </svg>
            <span className="cl-plist-day">{fmtDay(p.at)}</span>
            <span>{PRACTICE_LABEL[p.kind]}, {WHY[p.why]}</span>
            <b>{!p.done ? 'not done' : p.settle == null ? 'done, not read' : p.settle >= 0 ? `${Math.round(p.settle)}% stiller` : `${Math.round(-p.settle)}% less still`}</b>
          </li>
        ))}
      </ol>
      {list.length > 8 && (
        <button type="button" className="cl-link" onClick={() => setAll(!all)}>
          {all ? 'Show the latest 8' : `Show all ${list.length}`}
        </button>
      )}
    </>
  )
}
