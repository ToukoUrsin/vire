import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Channel, WallChannel, WallMe, WallState } from '@shared/types'
import { StackLoading } from './Big'
import { Strips } from './Strips'
import { CH, CHANNELS, HONEST, NUMBERS_ONLY, TABLE, ago, fmt, focus, hoursWord, sits, tickLabel, visitUrl } from './lib'
import type { WallFeed } from './lib'

/** `#/wall?u=<userId>` on the visitor's own phone: their dot, where it sits in the hall, how it moved since last time. */
export function Me({ feed }: { feed: WallFeed }) {
  const { wall, stale } = feed
  const me = wall?.me ?? null
  // under three other people there is no "where you sit" to speak of: say so once, not once per channel
  const few = me != null && CHANNELS.every((ch) => me.pct[ch] == null)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(358)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const on = () => setW(Math.max(280, Math.round(el.clientWidth)))
    on()
    const ro = new ResizeObserver(on)
    ro.observe(el)
    return () => ro.disconnect()
  }, [me != null])

  return (
    <div className="wl wl-phone wl-me">
      <header className="wl-p-top">
        <b>Vire</b>
        <span>{TABLE}</span>
      </header>
      {wall?.simulated && <p className="wl-sim">Simulated data, layout check</p>}
      {stale && <p className="wl-stale">Reconnecting</p>}

      {!wall ? (
        <>
          <h1 className="wl-h1 wl-me-wait">Finding your dot.</h1>
          <StackLoading />
        </>
      ) : !me ? (
        <>
          <h1 className="wl-h1">We can't find that ping on the wall.</h1>
          <p className="wl-me-lede">If your phone was offline, it shows up here once the ping has been sent. Otherwise, do one now: it takes a minute.</p>
          <a className="wl-btn" href={visitUrl()}>
            Do the 60-second ping
          </a>
          <a className="wl-link-out" href="#/wall">
            See the whole hall
          </a>
        </>
      ) : (
        <>
          <h1 className="wl-h1">{me.counted ? `You are on the wall, ${me.label}.` : `Your ping is saved, ${me.label}.`}</h1>
          <p className="wl-me-lede">
            Pinged {ago(me.at, Date.parse(wall.generatedAt))}.{' '}
            {!me.counted
              ? 'It came from a test device, so it stays out of the hall numbers.'
              : wall.visitors <= 1
                ? 'Yours is the first dot here.'
                : `One of ${wall.visitors} people so far.`}{' '}
            {me.first && me.hoursBetween != null ? `You came back after ${hoursWord(me.hoursBetween)}: this is how you moved.` : `Come back in ${wall.minGapH} hours or more and this page shows how you moved.`}
            {few && ' Too few people yet to say where you sit in the hall: that fills in as others ping.'}
          </p>

          {wall.channels.map((c) => (
            <Row key={c.channel} c={c} me={me} wall={wall} few={few} />
          ))}
          <p className="wl-me-key">
            <span>
              <i className="wl-key-you" />
              you now
            </span>
            {me.first && (
              <span>
                <i className="wl-key-first" />
                your first ping
              </span>
            )}
            <span>
              <i className="wl-key-other" />
              everyone else
            </span>
            <span>
              <i className="wl-key-mid" />
              hall median
            </span>
          </p>

          <section className="wl-me-week">
            <h2>Your {me.trail.length > 1 ? 'dots' : 'dot'} on the weekend</h2>
            <div ref={box} className="wl-p-chart">
              <Strips wall={wall} freshAfter={Infinity} width={w} rowH={100} compact labels trail={me.trail} />
            </div>
          </section>

          <a className="wl-btn" href={visitUrl()}>
            Ping again
          </a>
          <a className="wl-link-out" href="#/wall">
            See the whole hall
          </a>
        </>
      )}
      <p className="wl-fine">
        {HONEST} {NUMBERS_ONLY}
      </p>
    </div>
  )
}

const SW = 358
const SH = 64

function Row({ c, me, wall, few }: { c: WallChannel; me: WallMe; wall: WallState; few: boolean }) {
  const ch = c.channel
  const k = CH[ch]
  const v = me.values[ch]
  const first = me.first?.values[ch] ?? null
  const hall = useMemo(() => latestPerPerson(wall, ch), [wall, ch])
  const f = useMemo(() => focus(hall, c.domain, [v, first]), [hall, c.domain, v, first])
  const x = (val: number) => 10 + ((Math.min(f.hi, Math.max(f.lo, val)) - f.lo) / (f.hi - f.lo)) * (SW - 20)
  const mid = 30
  const p = me.pct[ch]

  return (
    <section className="wl-me-ch" style={{ ['--c' as string]: k.color }}>
      <header>
        <h2>
          <i />
          {k.name}
        </h2>
        <p>
          {v == null ? (
            'not read'
          ) : (
            <>
              <b>{fmt(v, ch)}</b> {k.unit}
            </>
          )}
        </p>
      </header>
      <svg viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={`${k.name}: ${v == null ? 'not read this time' : `you at ${fmt(v, ch)} ${k.unit}`}, among ${hall.length} people in the hall`}>
        <line className="wl-base" x1={10} x2={SW - 10} y1={mid + 20} y2={mid + 20} />
        {c.now.n >= 3 && c.now.q1 != null && c.now.q3 != null && <rect className="wl-s-mid" x={x(c.now.q1)} width={Math.max(2, x(c.now.q3) - x(c.now.q1))} y={mid - 17} height={34} rx={6} />}
        {hall.map((val, i) => (
          <circle key={i} className={`wl-dot${hall.length > 120 ? ' is-many' : ''}`} cx={x(val)} cy={mid + (((i * 0.6180339) % 1) - 0.5) * 26} r={3.4} />
        ))}
        {c.now.n >= 3 && c.now.median != null && <line className="wl-s-med" x1={x(c.now.median)} x2={x(c.now.median)} y1={mid - 21} y2={mid + 21} />}
        {first != null && v != null && <line className="wl-s-path" x1={x(first)} x2={x(v)} y1={mid} y2={mid} />}
        {first != null && <circle className="wl-s-first" cx={x(first)} cy={mid} r={6} />}
        {v != null && (
          <g className="wl-s-you">
            <circle className="wl-ring" cx={x(v)} cy={mid} r={8} />
            <circle cx={x(v)} cy={mid} r={8} />
          </g>
        )}
        <text className="wl-ytick" x={10} y={SH - 1}>
          {tickLabel(f.lo)}
        </text>
        <text className="wl-ytick" x={SW - 10} y={SH - 1} textAnchor="end">
          {tickLabel(f.hi)}
        </text>
      </svg>
      {(v == null || !few) && <p className="wl-me-sit">{v == null ? "Your phone couldn't read this one this time." : p == null ? 'Too few people yet to say where you sit.' : sits(ch, p)}</p>}
      {v != null && first != null && <p className="wl-me-move">{moved(c, first, v)}</p>}
    </section>
  )
}

/** each person's latest readable value: the hall as it stands */
function latestPerPerson(wall: WallState, ch: Channel): number[] {
  const last = new Map<number, number>()
  wall.points.values[ch].forEach((v, i) => {
    if (v != null) last.set(wall.points.who[i], v)
  })
  return [...last.values()]
}

/** "From 1.90 to 1.42 since your first ping. 41 of the 61 who came back smiled less too." */
function moved(c: WallChannel, first: number, now: number): string {
  const k = CH[c.channel]
  const d = now - first
  const steady = Math.abs(d) < (c.domain[1] || 1) * 0.04
  const own = steady ? `Held steady at ${fmt(now, c.channel)} since your first ping.` : `From ${fmt(first, c.channel)} to ${fmt(now, c.channel)} since your first ping.`
  const g = c.change
  if (g.n < 3 || g.up === g.down) return own
  const down = g.down > g.up
  const most = `${down ? g.down : g.up} of the ${g.n} who came back ${down ? k.fell : k.rose}`
  if (steady) return `${own} ${most}.`
  return d < 0 === down ? `${own} ${most} too.` : `${own} Most went the other way: ${most}.`
}
