// "Today, from your AirPods": what the AirPods felt while Vire was open, set against the person's own earlier
// days, what they feel right now, and a short practice when one is offered.
import type { PassiveOffer, PassiveState } from './usePassive'
import { duration, headDownSub, pct, uprightLine, usualLine } from './words'
import './day.css'

export default function DayCard({ state, onPractice }: { state: PassiveState; onPractice?: (offer: PassiveOffer) => void }) {
  const { today, usual, live, offer, drift, sim } = state
  const wornMin = today?.wornMin ?? 0
  const now: string[] = []
  if (live.callMode) now.push('call mode')
  if (live.walking) now.push('walking')
  else if (live.worn && !live.callMode) now.push('sitting or standing')
  if (live.headDown) now.push('head down')
  return (
    <section className="pd" aria-label="Today, from your AirPods" data-worn-min={wornMin} data-sim={sim || undefined}>
      <header className="pd-top">
        <h2>Today, from your AirPods</h2>
        <p className="pd-sub">Counted while your AirPods are in.</p>
      </header>
      {sim && <p className="pd-sim">Stand-in AirPods: a script, not a person. Kept apart from your own days.</p>}

      {!today ? (
        <p className="pd-empty">{live.worn ? 'The first minute is being counted.' : 'Nothing yet today. Put your AirPods in.'}</p>
      ) : (
        <dl className="pd-grid">
          <div>
            <dt>Worn</dt>
            <dd data-worn>{duration(wornMin)}</dd>
          </div>
          <div>
            <dt>Walks</dt>
            <dd>{today.walks}</dd>
            <p className="pd-small">{today.walkMin ? `${duration(today.walkMin)} walking${today.stepsPerMin ? `, ${today.stepsPerMin} steps a minute` : ''}` : 'No walking yet'}</p>
          </div>
          <div>
            <dt>Calls</dt>
            <dd>{duration(today.callMin)}</dd>
          </div>
          <div>
            <dt>Head down</dt>
            <dd>{today.headDown === null ? '–' : pct(today.headDown)}</dd>
            <p className="pd-small">{today.headDown === null ? 'needs a few more minutes' : headDownSub(usual)}</p>
          </div>
          {today.nodsPerHour !== null && (
            <div>
              <dt>Nods</dt>
              <dd>{Math.round(today.nodsPerHour)}</dd>
              <p className="pd-small">an hour worn</p>
            </div>
          )}
          {today.smilesPerHour !== null && (
            <div>
              <dt>Smiles</dt>
              <dd>{Math.round(today.smilesPerHour)}</dd>
              <p className="pd-small">an hour worn</p>
            </div>
          )}
          {today.heart && (
            <div>
              <dt>Heart</dt>
              <dd>{today.heart.bpm}</dd>
              <p className="pd-small">beats a minute, during practice</p>
            </div>
          )}
        </dl>
      )}

      <p className="pd-usual" data-usual-days={state.daysKept}>{usualLine(state)}</p>
      {today && uprightLine(today) && <p className="pd-small">{uprightLine(today)}</p>}
      {drift.length > 0 && (
        <ul className="pd-drift">
          {drift.map((d) => (
            <li key={d.key}>{d.line}</li>
          ))}
        </ul>
      )}

      {/* empty and nothing worn: the line above already asks for the AirPods, so this one stays out */}
      {(today || live.worn) && (
        <div className="pd-now" data-live-worn={live.worn}>
          <span className="pd-dot" data-on={live.worn} aria-hidden="true" />
          {live.worn ? (
            <p>
              Right now: {now.join(', ')}. <span className="pd-hz">{live.hz} samples a second</span>
            </p>
          ) : (
            <p>AirPods not sending right now.</p>
          )}
        </div>
      )}

      {offer && (
        <div className="pd-offer" data-offer={offer.kind}>
          <p className="pd-why">{offer.why}</p>
          <p className="pd-line">{offer.line}</p>
          <div className="pd-btns">
            {onPractice && (
              <button type="button" className="lab-btn primary" onClick={() => onPractice(offer)}>
                Start
              </button>
            )}
            <button type="button" className="pd-later" onClick={state.dismiss}>
              Not now
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
