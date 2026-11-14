// AirPods first, on the big screen: the teaching minute (the camera teaches, the AirPods learn), the Modal search for
// this person's model, and the ping read from AirPods motion alone. Every number here came from the phone or from
// GET /api/ear/jobs/latest; a model made from a script ('sim') is always called demo signals.
import type { EarJob, EarModel2, EarScore } from '@shared/ear'
import { Face } from './Face'
import { Head } from './Head'
import { palette, rgba, useCanvas } from './loop'
import { EAR_TAUGHT } from './store'
import type { EarTaught, Stage, View } from './store'
import type { SearchSeen } from './search'
import { Usual } from '../../tune/usual/Usual'

const LABEL: Record<EarTaught, string> = { smile: 'Smile', nod: 'Nod', shake: 'Head shake' }
const ASK: Record<string, string> = { rest: 'Sit still', relax: 'Let the smile go', smile: 'Smile', nod: 'Nod', shake: 'Shake your head no' }

/** area under the curve as a person would say it */
export const inTen = (auc: number) => Math.round(Math.max(0, Math.min(1, auc)) * 10)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** what was held back for the check, in plain words */
export const heldWords = (held: 'minute' | 'round' | undefined) => (held === 'minute' ? 'on a whole minute it never saw' : 'on a whole round it never saw')

/** the last seconds of what really arrived: the smile level from the camera, the head's turn from the AirPods */
function Trace({ stage, side }: { stage: Stage; side: 'camera' | 'ears' }) {
  const canvas = useCanvas((s, now) => {
    const { ctx, w, h, em } = s
    const p = palette()
    ctx.clearRect(0, 0, w, h)
    const span = 8000
    const pts = stage.frames.filter((f) => now - f.at < span)
    if (pts.length < 2) return
    const y = (f: (typeof pts)[number]) => (side === 'camera' ? h * (0.9 - Math.max(0, Math.min(1, f.smile)) * 0.8) : h * 0.5 - Math.max(-1, Math.min(1, (f.pitch + f.yaw) / 30)) * h * 0.42)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = side === 'camera' ? p.smile : rgba(p.ink, 0.9)
    ctx.lineWidth = Math.max(1.5, em * 0.18)
    ctx.beginPath()
    pts.forEach((f, i) => {
      const x = w - ((now - f.at) / span) * w
      if (i === 0) ctx.moveTo(x, y(f))
      else ctx.lineTo(x, y(f))
    })
    ctx.stroke()
  })
  return <canvas className="sg-signal-canvas" ref={canvas} aria-hidden="true" />
}

function ModelReport({ model }: { model: EarModel2 | null }) {
  if (!model) return <p className="sg-ear-report-note">The phone is still making its model.</p>
  const demo = model.shell === 'sim'
  return (
    <div className="sg-ear-report">
      <p className="sg-ear-report-lede">{demo ? 'Demo signals, not a person.' : `The phone's own model, checked ${heldWords(model.held)}.`}</p>
      <ul>
        {EAR_TAUGHT.map((event) => {
          const score = model.events[event]?.score
          return (
            <li key={event} data-event={event}>
              <b>{LABEL[event]}</b>
              <span>{!score ? 'not checked' : score.ok ? `right ${inTen(score.auc)} times in 10` : 'not yet, the camera keeps this one'}</span>
              <small>{score ? `luck: ${inTen(score.chance)} in 10` : ''}</small>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function Teaching({ stage, view }: { stage: Stage; view: View }) {
  const teach = view.teach
  const ask = teach?.say || (teach?.ask ? (ASK[teach.ask] ?? teach.ask) : 'Sit still')
  const done = teach?.state === 'done'
  const training = teach?.state === 'training'
  const demo = teach?.model?.shell === 'sim'
  return (
    <section className="sg-ear-scene sg-teaching" aria-live="polite">
      <header className="sg-ear-title">
        <h1>{done ? (demo ? 'Demo signals are ready.' : teach?.model ? 'The AirPods learned this person.' : 'The teaching minute is done.') : training ? 'The phone is making a model.' : ask}</h1>
        <p>{done ? (demo ? 'A script, not a person. The camera teaches, the AirPods follow.' : 'Next, every minute of this person goes to Modal to find a better model.') : training ? 'It learns from the AirPods and checks itself on a whole round it never saw.' : 'The camera teaches. The AirPods learn.'}</p>
        {!done && !training && teach && teach.of > 0 && <small>Step {Math.min(teach.index + 1, teach.of)} of {teach.of}</small>}
      </header>
      <div className="sg-teach-columns">
        <article className="sg-ear-actor">
          <div className="sg-ear-actor-head"><Face stage={stage} /></div>
          <b>Camera</b>
          <span>teacher: the smile it sees</span>
          <Trace stage={stage} side="camera" />
        </article>
        <div className="sg-teach-arrow" aria-hidden="true">→</div>
        <article className="sg-ear-actor sg-ear-actor-air">
          <div className="sg-ear-actor-head"><Head stage={stage} source="airpods" dim={false} /></div>
          <b>AirPods</b>
          <span>student: how the head turns</span>
          <Trace stage={stage} side="ears" />
        </article>
      </div>
      {done && <ModelReport model={teach?.model ?? null} />}
    </section>
  )
}

// ---- the Modal search, live ----

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? plural(s, 'second') : plural(Math.round(s / 60), 'minute')
}

/** the search's own score: the mean over what it checked, as the phone says it ("held-out score 0.97") */
export function heldOut(model: EarModel2 | null | undefined): string {
  const got = EAR_TAUGHT.map((e) => model?.events[e]?.score).filter((x): x is EarScore => !!x && x.windows > 0)
  return got.length ? `, held-out score ${(got.reduce((a, b) => a + b.auc, 0) / got.length).toFixed(2)}` : ''
}

/** a script made the minute, not a person: said from the moment the search is waiting, not only when it is done */
const isDemo = (job: EarJob) => !!job.demo || job.model?.shell === 'sim'

/** the search's names for what it tried, with the sensor words said plainly */
export const plainName = (name: string) =>
  name
    .replace(', attitude', ', angles')
    .replace(', posture', ', angle shifts')
    .replace(', rotation', ', turn rate')
    .replace(', motion', ', angles and acceleration')

function searchCopy(job: EarJob, now: number): { tag: string; h: string; p: string } {
  const m = job.model?.minutes ?? job.minutes ?? 1
  const on = plural(m, 'minute')
  const held = heldWords(m >= 2 ? 'minute' : 'round')
  const demo = isDemo(job)
  switch (job.state) {
    case 'queued':
      return { tag: demo ? 'Demo signals' : 'Waiting', h: 'Waiting for a Modal sandbox', p: job.at ? `The minute arrived ${ago(now - job.at)} ago. Nothing has been tried yet.` : 'Nothing has been tried yet.' }
    case 'running':
      return { tag: demo ? 'Demo signals' : 'Searching', h: `Modal is trying models on ${on}`, p: `Each one is checked ${held}. Best on top.` }
    case 'failed':
      return { tag: 'Failed', h: 'The search failed', p: 'The phone keeps its own model.' }
    case 'done':
      // the newest thing is the day's minute, done with the camera off: it started no search
      if (job.dailyAt && job.dailyAt > (job.landedAt ?? 0))
        return { tag: demo ? 'Demo signals' : 'Camera off', h: 'Today’s minute, from the AirPods alone', p: `It arrived ${ago(now - job.dailyAt)} ago. The camera stayed off, so nothing was learned from it: it is read against their own usual. The model is the one Modal found on ${on}${heldOut(job.model)}.` }
      if (job.landedAt) return { tag: demo ? 'Demo signals' : 'On the phone', h: 'The model is on the phone now', p: `Modal tried ${plural(job.model?.tried ?? job.tried, 'model')} on ${on}${heldOut(job.model)}. The phone took the best one ${ago(now - job.landedAt)} ago.` }
      return { tag: demo ? 'Demo signals' : 'Found', h: 'The best model is found', p: `Modal tried ${plural(job.model?.tried ?? job.tried, 'model')} on ${on}${heldOut(job.model)}. On its way to the phone.` }
  }
}

function Scores({ model }: { model: EarModel2 }) {
  return (
    <ul className="sg-sr-scores">
      {EAR_TAUGHT.map((event) => {
        const score: EarScore | undefined = model.events[event]?.score
        return (
          <li key={event} data-event={event} className={score?.ok ? 'is-ok' : ''}>
            <b>{LABEL[event]}</b>
            {score ? (
              <>
                <span className="sg-sr-big">
                  {inTen(score.auc)}
                  <small> in 10</small>
                </span>
                <span className="sg-sr-why">{score.ok ? `right ${heldWords(score.held ?? model.held)}` : 'not good enough yet: the camera keeps this one'}</span>
              </>
            ) : (
              <span className="sg-sr-why">not checked</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** held-out score as more minutes are learned from: one step line per thing, drawn only from model.curve */
function Curve({ curve }: { curve: NonNullable<EarModel2['curve']> }) {
  const pts = [...curve].sort((a, b) => a.minutes - b.minutes)
  const W = 760
  const H = 230
  const L = 44
  const R = 200
  const T = 16
  const B = 44
  const xs = (i: number) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - R))
  const ys = (auc: number) => T + (1 - (Math.max(0.5, Math.min(1, auc)) - 0.5) / 0.5) * (H - T - B)
  const series = EAR_TAUGHT.map((event, k) => {
    const v = pts.map((p, i) => ({ i, a: p.auc[event] })).filter((p): p is { i: number; a: number } => typeof p.a === 'number')
    return v.length ? { event, k, v, end: v[v.length - 1] } : null
  }).filter((x) => x !== null)
  // end labels never sit on top of each other, even when the lines do
  const labelY = new Map<EarTaught, number>()
  let floor = -Infinity
  for (const s of [...series].sort((a, b) => ys(a.end.a) - ys(b.end.a))) {
    const y = Math.max(ys(s.end.a) + 8, floor + 28)
    labelY.set(s.event, y)
    floor = y
  }
  return (
    <figure className="sg-sr-curve">
      <figcaption>Minutes learned from, and right times in 10 on the next minute it never saw</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMid meet" role="img" aria-label="Right times in 10 by how many minutes the model learned from">
        {[5, 10].map((t) => (
          <g key={t} className="sg-sr-grid">
            <line x1={L} x2={W - R} y1={ys(t / 10)} y2={ys(t / 10)} />
            <text x={L - 12} y={ys(t / 10) + 8} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {pts.map((p, i) => (
          <text key={p.minutes} className="sg-sr-tick" x={xs(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}>
            {plural(p.minutes, 'minute')}
          </text>
        ))}
        {series.map(({ event, k, v, end }) => {
          let d = `M${xs(v[0].i)} ${ys(v[0].a)}`
          for (let j = 1; j < v.length; j++) d += ` H${xs(v[j].i)} V${ys(v[j].a)}`
          return (
            <g key={event} className={`sg-sr-line is-${k}`}>
              <path d={d} />
              <text x={xs(end.i) + 16} y={labelY.get(event)}>
                {LABEL[event]} {inTen(end.a)}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export function SearchBoard({ seen }: { seen: SearchSeen }) {
  const { job } = seen
  const now = Date.now()
  const copy = searchCopy(job, now)
  const model = job.state === 'done' ? job.model : null
  const curve = model?.curve && model.curve.length >= 2 ? model.curve : null
  // what the clinic sees once the search is done: this minute from the AirPods alone, against the person's own usual
  const days = job.state === 'done' && job.days && job.days.length ? job.days : null
  const rows = days ? 5 : 12
  const demo = isDemo(job)
  return (
    <section className="sg-search" data-state={job.state} data-landed={job.landedAt ? '1' : '0'} data-daily={job.dailyAt && job.dailyAt > (job.landedAt ?? 0) ? '1' : '0'} aria-live="polite">
      <div className="sg-sr-side">
        <p className={`sg-sr-tag${demo ? ' is-demo' : ''}`}>
          <span className="sg-sr-dot" aria-hidden="true" />
          {copy.tag}
        </p>
        <h1>{copy.h}</h1>
        <p className="sg-sr-sub">{copy.p}</p>
        {demo && <p className="sg-sr-demo">Demo signals: a script made {(job.minutes ?? 1) === 1 ? 'this minute' : 'these minutes'}, not a person.</p>}
        {job.state === 'failed' && job.error && <p className="sg-sr-err">{job.error}</p>}

        {job.state === 'running' && (
          <dl className="sg-sr-stats">
            <div>
              <dt>models tried</dt>
              <dd data-tried>{job.tried}</dd>
            </div>
            <div>
              <dt>{(job.minutes ?? 1) === 1 ? 'minute' : 'minutes'} learned from</dt>
              <dd>{job.minutes ?? 1}</dd>
            </div>
            <div>
              <dt>seconds in the sandbox</dt>
              <dd>{Math.round(job.seconds)}</dd>
            </div>
          </dl>
        )}

        {model && <Scores model={model} />}
        {curve && <Curve curve={curve} />}
      </div>

      <div className="sg-sr-board">
        <header>
          <b>{job.state === 'done' ? 'The best of what Modal tried' : job.state === 'failed' ? 'What it tried before it stopped' : 'Best so far'}</b>
          <small>held-out score, 1.00 is never wrong</small>
        </header>
        {job.board.length === 0 ? (
          <p className="sg-sr-empty">{job.state === 'failed' ? 'No models were tried.' : 'No models tried yet.'}</p>
        ) : (
          <ol>
            {job.board.slice(0, rows).map((row, i, rows) => (
              <li key={`${row.name}#${rows.slice(0, i).filter((r) => r.name === row.name).length}`} className={i === 0 ? 'is-best' : ''}>
                <span className="sg-sr-rank">{i + 1}</span>
                <span className="sg-sr-name">{plainName(row.name)}</span>
                <span className="sg-sr-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(2, ((row.auc - 0.5) / 0.5) * 100)}%` }} />
                </span>
                <b>{row.auc.toFixed(2)}</b>
              </li>
            ))}
          </ol>
        )}
        {days && <Usual days={days} who="clinic" demo={demo} />}
      </div>
    </section>
  )
}

// ---- a ping with the camera off ----

function EventRow({ event, view, model }: { event: EarTaught; view: View; model: EarModel2 | null }) {
  const score = model?.events[event]?.score
  const count = view.earCounts[event] ?? 0
  if (!score || !score.ok) return <li className="is-muted"><span>{LABEL[event]}</span><small>needs the camera</small></li>
  return (
    <li className={view.earOn.includes(event) ? 'is-on' : ''}>
      <span>{LABEL[event]}</span>
      <b>{count}</b>
      <small>{typeof view.ear[event] === 'number' ? `right ${inTen(score.auc)} times in 10` : 'not read yet'}</small>
    </li>
  )
}

export function AirPodsOnly({ stage, view }: { stage: Stage; view: View }) {
  const model = view.teach?.model ?? null
  return (
    <section className="sg-ear-scene sg-airpods-scene" aria-live="polite">
      <div className="sg-airpods-hero">
        <div className="sg-airpods-head"><Head stage={stage} source="airpods" dim={false} /></div>
        <div>
          <p className="sg-camera-off">Camera off. AirPods only.</p>
          <h1>{view.earOn.length ? view.earOn.map((x) => LABEL[x]).join(', ') : 'Listening between pings.'}</h1>
          <p className="sg-airpods-copy">The head turns with the AirPods.{model && model.hz > 0 ? ` The model reads motion ${Math.round(model.hz)} times a second.` : ''}</p>
          {view.rate !== null && <small className="sg-rate">turning {Math.round(Math.abs(view.rate))}°/s</small>}
        </div>
      </div>
      <div className="sg-airpods-events">
        <header><b>What the AirPods read</b><small>{model?.shell === 'sim' ? 'Demo signals' : model ? 'this person’s check' : ''}</small></header>
        <ul>{EAR_TAUGHT.map((event) => <EventRow key={event} event={event} view={view} model={model} />)}</ul>
      </div>
    </section>
  )
}
