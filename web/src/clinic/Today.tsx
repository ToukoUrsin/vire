import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PatientRow } from '@shared/types'
import { Spark } from './charts/Spark'
import { STATUS_LABEL, STATUS_ORDER, fmtDay, fmtSlot, fmtTime, groupOf, isMock, roomCode, signed, silentDays, useCalled, usePatients, viewStatus, words } from './data'
import type { Group, ViewStatus } from './data'
import { displayName } from '../shared/name'
import { whole } from '../shared/whole'

/** keep `?mock=1` on in-app links so a reload stays on the mock */
export const href = (path: string) => (isMock() ? `${path}?mock=1` : path)

/** status glyph: shape carries the state, colour only on the two states that ask for attention */
export function StatusMark({ status }: { status: ViewStatus }) {
  return (
    <svg className={`cl-mark cl-mark--${status}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {status === 'low' && <circle cx="6" cy="6" r="5" />}
      {status === 'dipping' && <path d="M1 2.5h10L6 11z" />}
      {status === 'quiet' && <circle cx="6" cy="6" r="4.2" fill="none" strokeWidth="1.6" strokeDasharray="2.2 2.2" />}
      {status === 'steady' && <circle cx="6" cy="6" r="2.2" />}
      {status === 'calibrating' && <circle cx="6" cy="6" r="4.2" fill="none" strokeWidth="1.4" />}
    </svg>
  )
}

export function statusDetail(row: Pick<PatientRow, 'status' | 'lastPingAt' | 'drift' | 'outer' | 'synthetic'>, vs: ViewStatus): string {
  const s = silentDays(row.lastPingAt)
  const days = row.outer?.driftDays ?? 0
  if (vs === 'quiet') return s === null ? words(row.synthetic).none : row.synthetic ? `${s} days without AirPods` : `${s} days silent`
  if (vs === 'low' || vs === 'dipping') return `${signed(row.drift)} SD${days > 0 ? `, ${days} ${days === 1 ? 'day' : 'days'}` : ''}${s !== null && s >= 3 ? `, ${s} d silent` : ''}`
  return ''
}

const GROUPS: { key: Group; title: string; empty?: string; note?: string }[] = [
  {
    key: 'escalated',
    title: 'Below their usual in spite of the practices',
    note: 'Five days or more below their own usual, with three or more practices done. A booster is your decision; open the person to book one.',
  },
  { key: 'call', title: 'Worth a call today', empty: 'Nobody needs a call today. Everyone is inside their usual or still being watched below.' },
  { key: 'watch', title: 'Keep an eye on', note: 'Not opening Vire is a signal too. Quiet people are listed here.' },
  { key: 'after', title: 'After a booster', note: 'The line after the booster, against their usual.' },
  { key: 'new', title: 'Still calibrating, no usual to compare against yet' },
  { key: 'calm', title: 'Inside their usual' },
  {
    key: 'camera',
    title: 'Tried the one-minute camera check on their own phone',
    note: 'Real people at the event who did the earlier one-minute check: the phone camera read their smile, nod and pulse, the microphone their voice. These are not AirPods days and have no practices, so they sit outside the loop above.',
  },
]

export default function Today() {
  const { rows, source, stale, at } = usePatients()
  const [only, setOnly] = useState<ViewStatus | null>(null)
  const called = useCalled()

  const model = useMemo(() => {
    const list = (rows ?? []).map((row) => ({ row, vs: viewStatus(row), group: groupOf(row) }))
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ViewStatus, number>
    for (const r of list) counts[r.vs]++
    return { list, counts, nCall: list.filter((r) => r.group === 'call' || r.group === 'escalated').length, nSim: list.filter((r) => r.row.synthetic).length, nCam: list.filter((r) => r.group === 'camera').length }
  }, [rows])

  const total = model.list.length
  const shown = only ? model.list.filter((r) => r.vs === only) : model.list
  const stillToCall = model.list.filter((r) => (r.group === 'call' || r.group === 'escalated') && !called.calledAt(r.row.id)).length
  const [focusCall, setFocusCall] = useState(true)
  useEffect(() => {
    if (!rows) return
    const id = window.setTimeout(() => setFocusCall(false), 4500)
    return () => window.clearTimeout(id)
  }, [rows])

  return (
    <main className="cl-page">
      {rows && stale && (
        <p className="cl-offline" role="status">
          <b>The server is not answering.</b> This list is from {at ? fmtTime(at) : 'earlier'}; it refreshes by itself.
        </p>
      )}
      {rows && !stale && source === 'mock' && !isMock() && (
        <p className="cl-offline" role="status">
          <b>The server is not answering.</b> These are built-in sample people, not your clinic's list. The real list comes back by itself.
        </p>
      )}
      <header className="cl-head">
        <h1>Who needs a call today</h1>
        {rows && (
          <p className="cl-lede">
            {total === 0 ? (
              <>Nobody here yet. People show up after their first day with AirPods in.</>
            ) : model.nCall === 0 ? (
              <>Nobody needs a call today. {total === 1 ? 'The one person here is' : `All ${total} people are`} inside their usual or still calibrating.</>
            ) : (
              <>
                <b>
                  {model.nCall} of {total}
                </b>{' '}
                people. The other {total - model.nCall} are inside their usual, {model.nCam > 0 ? 'being watched, still calibrating or tried the camera check' : 'being watched, or still calibrating'}.
                {stillToCall < model.nCall && <span className="cl-lede-done"> {model.nCall - stillToCall} called so far.</span>}
              </>
            )}
          </p>
        )}
      </header>

      {rows && total > 0 && (
        <section className="cl-strip" aria-label="People by status">
          <div className="cl-seg" aria-hidden="true">
            {STATUS_ORDER.filter((s) => model.counts[s] > 0).map((s) => (
              <i key={s} className={`cl-seg-part cl-seg-part--${s}${only && only !== s ? ' is-dim' : ''}`} style={{ flexGrow: model.counts[s] }} />
            ))}
          </div>
          <div className="cl-counts">
            {STATUS_ORDER.map((s) => (
              <button key={s} type="button" className="cl-count" aria-pressed={only === s} disabled={model.counts[s] === 0} onClick={() => setOnly(only === s ? null : s)}>
                <StatusMark status={s} />
                <b>{model.counts[s]}</b>
                <span>{STATUS_LABEL[s].toLowerCase()}</span>
              </button>
            ))}
            {only && (
              <button type="button" className="cl-count cl-count--reset" onClick={() => setOnly(null)}>
                Show everyone
              </button>
            )}
          </div>
          {/* why a person at -2.0 can be Dipping while one at -1.9 is Low: Low is about how long, not how far */}
          <p className="cl-key">
            Dipping: the running average of their days is more than 0.75 SD below their usual. Low: it has stayed more than 1.5 SD below for three days in a row or longer. Quiet: nothing from their AirPods for three
            days or more.
          </p>
        </section>
      )}

      {!rows && (
        <div className="cl-skel" aria-busy="true" aria-label="Loading people">
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      )}

      {rows && total === 0 && (
        <p className="cl-empty">
          No one is enrolled yet. People appear here after their first day with AirPods in; enrol someone by opening the Vire app on their phone during a TMS session.
        </p>
      )}

      {rows && total > 0 && (
        <div className="cl-table">
          <div className="cl-cols" aria-hidden="true">
            <span>Person</span>
            <span>Since course</span>
            <span>28 days against their usual</span>
            <span>Now</span>
            <span>What&apos;s working</span>
            <span>Why here</span>
            <span />
          </div>
          {GROUPS.map((g) => {
            const items = shown.filter((r) => r.group === g.key)
            if (!items.length && (only || !g.empty)) return null
            // people who are on their phone right now come first among the newcomers
            if (g.key === 'new') items.sort((a, b) => Number(b.row.live) - Number(a.row.live) || (b.row.lastPingAt ?? '').localeCompare(a.row.lastPingAt ?? ''))
            const look: Group = g.key === 'new' || g.key === 'camera' ? 'calm' : g.key === 'escalated' ? 'call' : g.key === 'after' ? 'watch' : g.key
            return (
              <section key={g.key} className={`cl-group cl-group--${look} cl-group--is-${g.key}`}>
                <h2>
                  {g.title}
                  <span>{items.length}</span>
                </h2>
                {g.note && <p className="cl-group-note">{g.note}</p>}
                {items.length === 0 ? (
                  <p className="cl-empty cl-empty--inline">{g.empty}</p>
                ) : (
                  <ul>
                    {items.map(({ row, vs }) => (
                      <Row key={row.id} row={row} vs={vs} group={look} calledAt={called.calledAt(row.id)} focus={focusCall && (g.key === 'escalated' || (g.key === 'call' && !model.list.some((r) => r.group === 'escalated'))) && items[0]?.row.id === row.id} onCalled={() => called.toggle(row.id)} />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <section className="cl-care-window cl-care-window--after" aria-labelledby="cl-care-window-title">
        <div className="cl-care-window-copy">
          <h2 id="cl-care-window-title">Watch the months after TMS. Call when the response fades.</h2>
          <p>Senova 2019 found 66.5% still responding at 3 months, 52.9% at 6, and 46.3% at 12. Each person below is placed by days since their course ended.</p>
          <p className="cl-care-note">If a clinician&apos;s rating is worse for two weeks running, Janicak 2010 found that bringing TMS back restored benefit in 32 of 38 people who worsened. It was open label, with no control.</p>
          <p className="cl-care-note">A scheduled session every month for everyone was not shown to beat watching and re-treating (Philip 2016). No validated marker of response loss exists; Vire does not claim to be one (Dine 2026).</p>
        </div>
        <div className="cl-care-curve" aria-label="Response retained after a TMS course: 66.5 percent at 3 months, 52.9 percent at 6 months, 46.3 percent at 12 months">
          <svg viewBox="0 0 520 138" role="img">
            <path d="M38 28 C142 34 190 59 282 75 S411 91 486 102" className="cl-care-line" />
            <line x1="38" x2="486" y1="112" y2="112" className="cl-care-axis" />
            {[0, 3, 6, 12].map((m) => {
              const x = 38 + (448 * m) / 12
              return <g key={m}><line x1={x} x2={x} y1="108" y2="116" className="cl-care-axis" /><text x={x} y="132" textAnchor="middle" className="cl-care-label">{m === 0 ? 'course end' : `${m} mo`}</text></g>
            })}
            {[{ m: 3, n: '66.5%' }, { m: 6, n: '52.9%' }, { m: 12, n: '46.3%' }].map(({ m, n }) => {
              const x = 38 + (448 * m) / 12
              const y = m === 3 ? 42 : m === 6 ? 75 : 102
              return <g key={m}><circle cx={x} cy={y} r="5" className="cl-care-dot" /><text x={x} y={y - 12} textAnchor="middle" className="cl-care-number">{n}</text></g>
            })}
            {(rows ?? []).filter((r) => r.daysSinceCourse !== null && r.daysSinceCourse >= 0 && r.daysSinceCourse <= 365).slice(0, 24).map((r, i) => {
              const x = 38 + (448 * Math.min(12, (r.daysSinceCourse ?? 0) / 30.44)) / 12
              return <circle key={`${r.id}-${i}`} cx={x} cy={119 - (i % 3) * 3} r="2.5" className="cl-person-dot" aria-hidden="true" />
            })}
          </svg>
          <small>Senova et al. 2019 · 19 studies; 12-month estimate from 9 studies</small>
        </div>
      </section>

      {rows && (
        <footer className="cl-foot">
          {model.nSim > 0 && (
            <span>
              Simulated cohort: {model.nSim} of {total} people are simulated days with AirPods in, and so are their practices, bookings and boosters{source === 'mock' ? ', served from the built-in mock' : ''}. No patient has used Vire yet.
            </span>
          )}
          <span>Vire compares each person with their own usual. A signal for the clinic, not a diagnosis.</span>
          <span>Demo clinic, open to anyone with the link. A real one sits behind the clinic&apos;s own sign-in.</span>
        <details className="cl-sources">
          <summary>Sources</summary>
          <p>Senova et al. 2019, <i>Brain Stimul</i> 12(1):119–128. doi:10.1016/j.brs.2018.10.001</p>
          <p>Janicak et al. 2010, <i>Brain Stimul</i> 3(4):187–199. doi:10.1016/j.brs.2010.07.003</p>
          <p>Philip et al. 2016, <i>Brain Stimul</i> 9(2):251–257. doi:10.1016/j.brs.2015.11.007</p>
          <p>Dine et al. 2026, <i>JMIR Res Protoc</i> 15:e89466. doi:10.2196/89466</p>
        </details>
        </footer>
      )}
    </main>
  )
}

function Row({ row, vs, group, calledAt, focus, onCalled }: { row: PatientRow; vs: ViewStatus; group: Group; calledAt: string | null; focus?: boolean; onCalled: () => void }) {
  const detail = statusDetail(row, vs)
  const o = row.outer
  const booked = o?.booster && Date.parse(o.booster.at) > Date.now() ? o.booster : null
  return (
    <li className={`cl-row cl-row--${group} is-${vs}${calledAt ? ' is-called' : ''}${focus ? ' is-focus' : ''}`}>
      <div className="cl-c-name">
        <Link to={href(`/clinic/p/${row.id}`)} className="cl-name">
          {displayName(row.name)}
        </Link>
        <span className="cl-origin">
          {row.live ? (
            <>
              <i className="cl-livedot" />
              Live now
            </>
          ) : row.synthetic ? (
            'Simulated'
          ) : (
            'Real phone, camera check'
          )}
        </span>
        {row.joinedAt && <small className="cl-joined">Joined {fmtDay(row.joinedAt)}</small>}
      </div>
      <div className="cl-c-since">
        {row.daysSinceCourse === null ? (
          <span>no course</span>
        ) : (
          <>
            <span>day</span> <b>{row.daysSinceCourse}</b>
          </>
        )}
      </div>
      <div className="cl-c-spark">
        <Spark values={row.spark} status={vs} />
      </div>
      <div className="cl-c-status">
        <StatusMark status={vs} />
        <b>{STATUS_LABEL[vs]}</b>
        {detail && <span>{detail}</span>}
      </div>
      <div className={`cl-c-work is-${o?.working.said ?? 'none'}`}>
        {o ? <WorkingText text={o.working.text} /> : <span>No practices yet</span>}
      </div>
      <div className="cl-c-reason" title={row.reason}>
        {o && (o.state === 'escalated' || o.state === 'booked' || o.state === 'after' || o.state === 'answered' || o.state === 'drifting') && o.note ? (
          <>
            <b className="cl-outer-note">{o.note}</b>
            {o.state === 'after' && o.after?.simulated && <span className="cl-tag cl-tag--sim">Simulated booster and response</span>}
            {booked && <span className="cl-tag">Booster {fmtSlot(booked.at)}{booked.by === 'simulated' ? ', simulated booking' : ''}</span>}
            <span className="cl-reason-sub">{whole(row.reason)}</span>
          </>
        ) : (
          <>
            <PlainReason text={row.reason} lead={group === 'call'} />
            {row.boosterRequested && <span className="cl-tag">Booster requested</span>}
          </>
        )}
      </div>
      <div className="cl-c-act">
        <span className="cl-action-state">{calledAt ? `Called ${fmtDay(calledAt)}` : booked ? 'Booster booked' : o?.state === 'escalated' ? 'No booster booked' : row.boosterRequested ? 'Booster requested' : 'Not called'}</span>
        {row.live ? (
          <Link to={href(`/clinic/live/${roomCode(row.id)}`)} className="cl-btn cl-btn--small">
            Watch live
          </Link>
        ) : group === 'call' ? (
          <button type="button" className={`cl-btn cl-btn--small${calledAt ? ' is-done' : ''}`} onClick={onCalled} aria-pressed={!!calledAt}>
            {calledAt ? (
              <>
                <Check /> Called {fmtTime(calledAt)} · Undo
              </>
            ) : (
              'Mark called'
            )}
          </button>
        ) : (
          <svg className="cl-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {o?.sentence && (o.state === 'escalated' || o.state === 'booked') && (
        <p className="cl-say">
          <span>On the phone</span>
          &ldquo;{o.sentence}&rdquo;
        </p>
      )}
    </li>
  )
}

/** "Breathing: 9 of 12 sessions settled": the practice in bold, the counts plain */
/** A call row with no headline of its own: the first clause of its reason is set as the headline and the rest under it,
 *  so every call row reads the same way. The words and their order are the server's, untouched. */
function PlainReason({ text, lead }: { text: string; lead: boolean }) {
  if (!lead) return <>{whole(text)}</>
  const cut = text.indexOf('; ')
  return (
    <>
      <b className="cl-outer-note">{whole(cut > 0 ? text.slice(0, cut) : text)}</b>
      {cut > 0 && <span className="cl-reason-sub cl-reason-sub--rest">{whole(text.slice(cut + 2))}</span>}
    </>
  )
}

function WorkingText({ text }: { text: string }) {
  const i = text.indexOf(': ')
  if (i < 0) return <span>{text}</span>
  return (
    <span>
      <b>{text.slice(0, i)}</b>
      <br />
      {text.slice(i + 2)}
    </span>
  )
}

export function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.5 5.5 10.5 11.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
