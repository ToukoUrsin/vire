// What the ping resolves into: the echo, drawn as the same four-petal figure the phone shows. When a dose was
// followed by a second measure and the phone sends that echo too, the first one stays as a dashed outline.
import type { Channel, DoseKind, Echo, PhaseKey, StepReading } from '@shared/types'
import { CH_LABEL } from '../data'
import { DOSE_INFO } from '../../app/doses/shared'
import { readingFigure, readingLabel, readingText, stepReadingText, heartMissingText } from '../../app/echoText'
import { stimName } from '../../app/personal'
import { measuredChange } from '../../app/fallback'

const ANGLE: Record<Channel, number> = { smile: -90, voice: 0, heart: 90, move: 180 }
const ORDER: Channel[] = ['smile', 'voice', 'heart', 'move']
const USUAL = 72
const reach = (strength: number) => USUAL * (0.4 + 0.012 * Math.max(0, Math.min(100, strength)))
function petal(r: number): string {
  const wide = 24 + r * 0.2
  return `M0 0 C ${r * 0.28} ${-wide}, ${r * 0.8} ${-wide * 0.86}, ${r} 0 C ${r * 0.8} ${wide * 0.86}, ${r * 0.28} ${wide}, 0 0 Z`
}
const doseInfo = (dose: unknown) => (typeof dose === 'string' && Object.prototype.hasOwnProperty.call(DOSE_INFO, dose) ? DOSE_INFO[dose as DoseKind] : { title: String(dose ?? 'unknown dose'), time: 'one minute' })

function Figure({ echo, ghost }: { echo: Echo; ghost?: Echo | null }) {
  const by = new Map(echo.components.map((c) => [c.channel, c]))
  const was = ghost ? new Map(ghost.components.map((c) => [c.channel, c])) : null
  const calibrating = echo.status === 'calibrating' || !['steady', 'dipping', 'low'].includes(String(echo.status))
  return (
    <svg className="sg-fig" viewBox="-126 -126 252 252" role="img" aria-label={calibrating ? 'Measured channels, personal usual not ready' : `Echo compared with this person's usual`}>
      <circle className="sg-fig-usual" r={USUAL} />
      {ORDER.map((ch) => (
        <path key={`g-${ch}`} className="sg-fig-ghost" d={petal(USUAL)} transform={`rotate(${ANGLE[ch]})`} />
      ))}
      {was &&
        ORDER.map((ch) => {
          const c = was.get(ch)
          return c && c.value !== null ? <path key={`w-${ch}`} className="sg-fig-was" d={petal(calibrating ? USUAL : reach(c.strength))} transform={`rotate(${ANGLE[ch]})`} /> : null
        })}
      {ORDER.map((ch, i) => {
        const c = by.get(ch)
        const missing = !c || c.value === null
        return (
          <g key={ch} transform={`rotate(${ANGLE[ch]})`}>
            <path className="sg-fig-petal" data-missing={missing} d={petal(missing || calibrating ? USUAL : reach(c.strength))} style={{ ['--c' as string]: `var(--ch-${ch})`, animationDelay: `${250 + i * 160}ms` }} />
          </g>
        )
      })}
      <circle className="sg-fig-core" r="4" />
      {ORDER.map((ch) => {
        const c = by.get(ch)
        const r = Math.max(reach(calibrating ? 50 : c && c.value !== null ? c.strength : 50), USUAL) + 13
        const a = (ANGLE[ch] * Math.PI) / 180
        return (
          <text key={`t-${ch}`} className="sg-fig-label" x={Math.cos(a) * r} y={Math.sin(a) * r + (ch === 'smile' ? -2 : ch === 'heart' ? 9 : 3.5)} textAnchor={ch === 'voice' ? 'start' : ch === 'move' ? 'end' : 'middle'}>
            {CH_LABEL[ch]}
          </text>
        )
      })}
      <text className="sg-fig-usual-label" x={USUAL * 0.74 + 5} y={-USUAL * 0.74 - 5}>
        {calibrating ? 'measured readings' : 'the usual'}
      </text>
    </svg>
  )
}

/** No usual yet: the four readings are the picture, each in its own unit. After a dose the reading before it stays under the new one. */
function Tiles({ echo, was }: { echo: Echo; was?: Echo | null }) {
  const by = new Map(echo.components.map((c) => [c.channel, c]))
  const before = was ? new Map(was.components.map((c) => [c.channel, c])) : null
  return (
    <div className="sg-tiles" aria-label="The readings, as measured">
      {ORDER.map((ch, i) => {
        const c = by.get(ch)
        if (!c) return null
        const fig = readingFigure(c)
        const old = before?.get(ch)
        const oldFig = old ? readingFigure(old) : null
        return (
          <div key={ch} className="sg-tile" data-ch={ch} data-missing={fig ? undefined : 'true'} data-echo-value={c.value === null ? 'null' : String(c.value)} style={{ animationDelay: `${200 + i * 140}ms`, ['--c' as string]: `var(--ch-${ch})` }}>
            <span className="sg-tile-ch"><i aria-hidden="true" />{readingLabel(ch)}</span>
            {fig ? <p className="sg-tile-n"><b>{fig.n}</b> {fig.unit}</p> : <p className="sg-tile-n sg-tile-none">Not read</p>}
            <p className="sg-tile-sub">{fig ? (oldFig ? `before the dose: ${oldFig.n}` : fig.sub) : ch === 'heart' ? heartMissingText() : (c.note ?? '').replace(/^I couldn[’']t read your \w+ today\.\s*/, '')}</p>
          </div>
        )
      })}
    </div>
  )
}

const PHASE_FOR_CHANNEL: Record<string, PhaseKey> = { smile: 'laugh', voice: 'speak', heart: 'breathe', move: 'nod' }

export function EchoPanel({ echo, before, name, whose, phoneReadings = {} }: { echo: Echo; before: Echo | null; name: string; whose: string; phoneReadings?: Partial<Record<PhaseKey, StepReading>> }) {
  const by = new Map(echo.components.map((c) => [c.channel, c]))
  const s = echo.suggestion
  const calibrating = echo.status === 'calibrating' || !['steady', 'dipping', 'low'].includes(String(echo.status))
  const change = !calibrating && before ? measuredChange(before, echo) : null
  const withinWobble = !!change && before?.wobble != null && Math.abs(change.change) <= before.wobble
  return (
    <section className="sg-echo" key={echo.pingId} aria-live="polite" data-calibrating={calibrating}>
      {calibrating ? <Tiles echo={echo} was={before} /> : <Figure echo={echo} ghost={before} />}
      <div className="sg-echo-text">
        <h1>{before ? 'After the dose' : name ? `${name}’s echo` : 'The echo'}</h1>
        <p className="sg-echo-score">
          {before && !calibrating && (
            <>
              <b className="is-was">{Math.round(before.strength)}</b>
              <i aria-hidden="true" />
            </>
          )}
          {calibrating ? <span>Your usual appears after three pings. {Math.max(1, 3 - (echo.pingsSoFar ?? 1))} to go.</span> : <><b>{Math.round(echo.strength)}</b><span>50 is {whose} own usual.</span></>}
        </p>
        {!calibrating && echo.message && <p className="sg-echo-msg">{echo.message}</p>}
        {calibrating && <p className="sg-echo-msg">{before ? 'The same two readings, taken again after the minute.' : 'Today’s readings, as measured. From the third ping they are drawn against this person’s own usual.'}</p>}
        {change && <p className="sg-echo-change">{withinWobble ? 'About the same as before: within your usual day-to-day spread.' : change.change >= 2 ? `Your echo rose ${change.change} points after the dose.` : change.change <= -2 ? `Your echo was ${Math.abs(change.change)} points quieter after the dose.` : 'Your echo stayed about the same after the dose.'}</p>}
        {!calibrating && (
          <ul className="sg-notes">
            {ORDER.map((ch, i) => {
              const c = by.get(ch)
              if (!c) return null
              return (
                <li key={ch} data-ch={ch} data-echo-value={c.value === null ? 'null' : String(c.value)} data-echo-strength={String(Math.round(c.strength))} style={{ animationDelay: `${500 + i * 150}ms`, ['--c' as string]: `var(--ch-${ch})` }}>
                  <i />
                  <b>{readingLabel(CH_LABEL[ch])}</b>
                  <span>{c.value === null ? stepReadingText(PHASE_FOR_CHANNEL[ch]!, phoneReadings[PHASE_FOR_CHANNEL[ch]!], 'not read') : readingText(c)}</span>
                  <em>{c.value === null ? 'not read' : Math.round(c.strength)}</em>
                </li>
              )
            })}
          </ul>
        )}
        {s && !before && (
          <div className="sg-pick">
            <span className="sg-pick-k">Vire’s pick</span>
            <p className="sg-pick-t">{doseInfo(s.dose).title}, {doseInfo(s.dose).time}</p>
            <p className="sg-pick-why">{s.reason} Then it measures again.</p>
          </div>
        )}
        {echo.stim && <p className="sg-echo-stim">Today’s laugh: {stimName(echo.stim)}.</p>}
        <p className="sg-foot">A measured loop, not a diagnosis.</p>
      </div>
    </section>
  )
}
