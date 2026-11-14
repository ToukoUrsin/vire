import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WallChannel, WallState } from '@shared/types'
import { Qr } from './Qr'
import { Legend, Strips } from './Strips'
import { CH, CHANNELS, HONEST, NUMBERS_ONLY, TABLE, ago, bare, fmt, headline, pct, signed, visitUrl } from './lib'
import type { WallFeed } from './lib'
import { displayName } from '../shared/name'

const W = 1920
const H = 1080

/** The hall wall. On a big screen it is a fixed 1920x1080 stage scaled to fit; on a phone it stacks. */
export function Big({ feed }: { feed: WallFeed }) {
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const on = () => setView({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const { wall, stale } = feed
  const wide = view.w >= 1000 && view.w / view.h >= 1.15
  // a wall should not fall asleep: ask the browser to keep the screen on (it may refuse, and that is fine)
  useEffect(() => {
    if (!wide) return
    let lock: WakeLockSentinel | null = null
    const ask = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => {})
    }
    ask()
    document.addEventListener('visibilitychange', ask)
    return () => {
      document.removeEventListener('visibilitychange', ask)
      void lock?.release().catch(() => {})
    }
  }, [wide])
  if (!wide) return <Narrow feed={feed} />

  const s = Math.min(view.w / W, view.h / H)
  const rowH = 136
  return (
    <div className="wl wl-big">
      <div className="wl-stage" style={{ transform: `translate(${(view.w - W * s) / 2}px, ${(view.h - H * s) / 2}px) scale(${s})` }}>
        <header className="wl-head">
          <div>
            <Headline wall={wall} />
            <p className="wl-sub">Sixty seconds on your own phone: a nod, a laugh, one sentence, two slow breaths. Then find your dot here.</p>
          </div>
          <div className="wl-brand">
            <b>Vire</b>
            <span>{TABLE}</span>
            {wall?.simulated && <i className="wl-sim">Simulated data, layout check</i>}
            {stale && <i className="wl-stale">Reconnecting</i>}
          </div>
        </header>

        <aside className="wl-scan">
          <Qr text={visitUrl()} className="wl-qr" />
          <p className="wl-scan-go">Scan to ping.</p>
          <p className="wl-scan-how">One minute. No app, no sign-up.</p>
          <p className="wl-scan-url">{bare(visitUrl())}</p>
          <p className="wl-fine">
            {HONEST} {NUMBERS_ONLY}
          </p>
        </aside>

        <main className="wl-hall">
          <Counts wall={wall} />
          {!wall && <HallLoading rowH={rowH} />}
          {wall && (
            <>
              <div className="wl-rows" style={{ ['--row' as string]: `${rowH}px` }}>
                <div className="wl-names">
                  {wall.channels.map((c) => (
                    <Name key={c.channel} c={c} />
                  ))}
                </div>
                <Strips wall={wall} freshAfter={feed.freshAfter} width={640} rowH={rowH} />
                <Back wall={wall} />
              </div>
              <Legend wall={wall} />
              <JustIn wall={wall} max={5} />
              <Reads wall={wall} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function Headline({ wall }: { wall: WallState | null }) {
  const text = headline(wall)
  const m = text.match(/^(.*?, )(.+)(\?)$/)
  return (
    <h1 className="wl-h1">
      {m ? (
        <>
          {m[1]}
          <em>{m[2]}</em>
          {m[3]}
        </>
      ) : (
        text
      )}
    </h1>
  )
}

function Counts({ wall }: { wall: WallState | null }) {
  if (!wall)
    return (
      <p className="wl-counts wl-counts--loading" aria-busy="true">
        <i className="skeleton" />
      </p>
    )
  if (!wall.visitors) return <p className="wl-counts">No pings yet. Yours would be the first dot on this wall.</p>
  return (
    <p className="wl-counts">
      <b>{wall.visitors}</b> {wall.visitors === 1 ? 'person has' : 'people have'} pinged so far.
      {wall.returning > 0 && (
        <>
          {' '}
          <b>{wall.returning}</b> came back hours later.
        </>
      )}
    </p>
  )
}

/** Before the server's first answer, on the big screen: the four rows the wall always has, their strips still to come. */
function HallLoading({ rowH }: { rowH: number }) {
  return (
    <div className="wl-rows wl-rows--loading" style={{ ['--row' as string]: `${rowH}px` }} aria-busy="true">
      <div className="wl-names">
        {CHANNELS.map((ch) => (
          <div key={ch} className="wl-name" style={{ ['--c' as string]: CH[ch].color }}>
            <h2>
              <i />
              {CH[ch].name}
            </h2>
            <p>{CH[ch].what}</p>
          </div>
        ))}
      </div>
      <div className="wl-skel-strips" aria-hidden="true">
        {CHANNELS.map((ch) => (
          <i key={ch} className="skeleton" />
        ))}
      </div>
    </div>
  )
}

/** The same on a phone: four named strips, stacked, still empty. */
export function StackLoading() {
  return (
    <div className="wl-skel-stack" aria-busy="true">
      {CHANNELS.map((ch) => (
        <div key={ch} style={{ ['--c' as string]: CH[ch].color }}>
          <b>
            <i />
            {CH[ch].name}
          </b>
          <i className="skeleton" />
        </div>
      ))}
    </div>
  )
}

function Name({ c }: { c: WallChannel }) {
  const k = CH[c.channel]
  return (
    <div className="wl-name" style={{ ['--c' as string]: k.color }}>
      <h2>
        <i />
        {k.name}
      </h2>
      <p>{k.what}</p>
      {c.now.n >= 3 && c.now.median != null ? (
        <p className="wl-name-mid">
          hall median <b>{fmt(c.now.median, c.channel)}</b> {k.unit}
        </p>
      ) : (
        c.now.n > 0 && <p className="wl-name-mid">too few yet for a hall median</p>
      )}
    </div>
  )
}

/** Those who came back: how each channel moved between a person's first and latest ping. */
function Back({ wall }: { wall: WallState }) {
  const enough = wall.channels.some((c) => c.change.n >= 3)
  return (
    <div className="wl-back">
      <h2 className="wl-back-h">{wall.returning > 0 ? `How those ${wall.returning} moved` : 'Those who come back'}</h2>
      {wall.returning === 0 ? (
        <p className="wl-back-none">Nobody has come back yet. Ping now, ping again after {wall.minGapH} hours, and this column shows how the weekend moved you.</p>
      ) : !enough ? (
        <p className="wl-back-none">
          {wall.returning} came back so far. From 3 on, this column shows how the weekend moved them.
        </p>
      ) : (
        wall.channels.map((c) => <Moved key={c.channel} c={c} />)
      )}
      {enough && (
        <p className="wl-back-axis">
          <span>less</span>
          <span>no change</span>
          <span>more</span>
        </p>
      )}
    </div>
  )
}

function Moved({ c }: { c: WallChannel }) {
  const k = CH[c.channel]
  const ch = c.change
  if (ch.n < 3 || ch.median == null || ch.q1 == null || ch.q3 == null) {
    return (
      <div className="wl-moved is-thin" style={{ ['--c' as string]: k.color }}>
        <p className="wl-moved-say">{ch.n === 0 ? 'Not read both times yet' : `${ch.n} back so far: too few to say`}</p>
      </div>
    )
  }
  const say = ch.down > ch.up ? `${ch.down} of ${ch.n} ${k.fell}` : ch.up > ch.down ? `${ch.up} of ${ch.n} ${k.rose}` : `${ch.n} back, split evenly`
  // zero in the middle; the bar is the middle half of the changes, the dot their median
  const reach = Math.max(Math.abs(ch.q1), Math.abs(ch.q3), Math.abs(ch.median)) * 1.25 || 1
  const at = (v: number) => 50 + (Math.max(-reach, Math.min(reach, v)) / reach) * 50
  return (
    <div className="wl-moved" style={{ ['--c' as string]: k.color }}>
      <p className="wl-moved-say">{say}</p>
      <div className="wl-moved-bar" role="img" aria-label={`Middle half of the changes: ${signed(ch.q1, c.channel)} to ${signed(ch.q3, c.channel)} ${k.unit}, median ${signed(ch.median, c.channel)}`}>
        <i className="wl-moved-zero" />
        <i className="wl-moved-mid" style={{ left: `${at(ch.q1)}%`, width: `${Math.max(1.5, at(ch.q3) - at(ch.q1))}%` }} />
        <i className="wl-moved-dot" style={{ left: `${at(ch.median)}%` }} />
      </div>
      <p className="wl-moved-by">
        median {signed(ch.median, c.channel)} {k.unit}
      </p>
    </div>
  )
}

/** The newest echoes: a nickname or "guest 14", never more. */
export function JustIn({ wall, max }: { wall: WallState; max: number }) {
  const now = Date.parse(wall.generatedAt)
  const list = wall.latest.slice(0, max)
  return (
    <div className="wl-in">
      <h2>Just in</h2>
      {list.length ? (
        <ul>
          {list.map((d) => (
            <li key={`${d.key}${d.at}`}>
              <b>{displayName(d.label)}</b>
              <span>
                {d.returning ? 'came back' : d.nth > 1 ? 'again' : 'first ping'}, {ago(d.at, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>The newest dots show up here, by nickname only.</p>
      )}
    </div>
  )
}

/** How often phones could read each channel: what the hall teaches us about the sensors. */
function Reads({ wall }: { wall: WallState }) {
  if (wall.pings < 5) return null
  const devices = wall.devices.filter((d) => d.pings > 0).sort((a, b) => b.pings - a.pings)
  return (
    <p className="wl-reads">
      Phones could read {CHANNELS.map((ch) => `${CH[ch].name.toLowerCase()} in ${pct(wall.readRates[ch]) ?? 'no'}`).join(', ')} of {wall.pings} pings
      {devices.length > 0 && `: ${devices.slice(0, 3).map((d) => `${d.pings} ${d.label}`).join(', ')}`}.
    </p>
  )
}

/** The same wall on a phone or a narrow window: stacked, with a button where the QR was. */
function Narrow({ feed }: { feed: WallFeed }) {
  const { wall, stale } = feed
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
  }, [])
  return (
    <div className="wl wl-phone">
      <header className="wl-p-top">
        <b>Vire</b>
        <span>{TABLE}</span>
      </header>
      {wall?.simulated && <p className="wl-sim">Simulated data, layout check</p>}
      {stale && <p className="wl-stale">Reconnecting</p>}
      <Headline wall={wall} />
      <Counts wall={wall} />
      <a className="wl-btn" href={visitUrl()}>
        Do the 60-second ping
      </a>
      <div ref={box} className="wl-p-chart">
        {wall ? <Strips wall={wall} freshAfter={feed.freshAfter} width={w} rowH={104} compact labels /> : <StackLoading />}
      </div>
      {wall && <Legend wall={wall} />}
      {wall && wall.channels.some((c) => c.change.n >= 3) && (
        <section className="wl-p-back">
          <h2>How those {wall.returning} moved</h2>
          {wall.channels.map((c) => (
            <Moved key={c.channel} c={c} />
          ))}
          <p className="wl-back-axis">
            <span>less</span>
            <span>no change</span>
            <span>more</span>
          </p>
        </section>
      )}
      {wall && <JustIn wall={wall} max={4} />}
      <p className="wl-fine">
        {HONEST} {NUMBERS_ONLY}
      </p>
    </div>
  )
}
