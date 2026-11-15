// The big screen when a practice arrives from someone's AirPods: what Vire tried, what the AirPods measured
// before and after it, and what has been learned for this person so far, with the counts. Only what was measured
// is said; a check with too few samples says so.
import type { SessionKind } from '@shared/earsession'
import type { PracticeSeen } from './practice'
import './practice.css'

const NAME: Record<SessionKind, string> = { breathe: 'Slow breathing', scan: 'Body scan', walk: 'A short walk' }
const SHORT: Record<SessionKind, string> = { breathe: 'slow breathing', scan: 'the body scan', walk: 'the walk' }
const WHY = { 'not tried yet': 'not tried yet', 'helped most so far': 'it has helped most so far', 'still comparing': 'still comparing' } as const
const times = (n: number) => (n === 1 ? 'once' : `${n} times`)
const num = (v: number | null, digits = 0) => (v === null ? '–' : v.toFixed(digits))

/** calmer after than before, said to the clinic: only from what was measured in the two still checks.
 *  "Calmer" needs the heart rate to have come down: a head that only sat stiller is "Stiller after". */
export function practiceVerdict(seen: PracticeSeen): { h: string; p: string } {
  const r = seen.read
  if (!r.happened) return { h: 'The walk was not felt.', p: 'The AirPods felt too few steps, so this practice is not counted towards what helps this person.' }
  const parts: string[] = []
  const heart = r.heartChange
  const still = r.settle
  if (heart !== null) parts.push(heart <= -1 ? `the heart rate came down ${Math.abs(Math.round(heart))} beats a minute` : heart >= 1 ? `the heart rate went up ${Math.round(heart)} beats a minute` : 'the heart rate stayed where it was')
  if (still !== null) parts.push(still >= 5 ? `the head sat ${still}% stiller` : still <= -5 ? `the head moved ${Math.abs(still)}% more` : 'the head moved as much as before')
  if (!parts.length) return { h: 'Done, but not scored.', p: 'The checks before and after had too few AirPods samples to compare.' }
  const good = (heart !== null && heart <= -1 ? 1 : 0) + (still !== null && still >= 5 ? 1 : 0)
  const bad = (heart !== null && heart >= 1 ? 1 : 0) + (still !== null && still <= -5 ? 1 : 0)
  const h = good && !bad ? (heart !== null && heart <= -1 ? 'Calmer after.' : 'Stiller after.') : bad && !good ? 'Not calmer after.' : good && bad ? 'Mixed today.' : 'No change today.'
  return { h, p: `After the practice ${parts.join(' and ')}, against the same check just before it.` }
}

export function PracticeBoard({ seen }: { seen: PracticeSeen }) {
  const r = seen.read
  const l = seen.learned
  const demo = seen.shell === 'sim'
  const v = practiceVerdict(seen)
  const tried = l.kinds.filter((k) => k.n > 0)
  const top = Math.max(10, ...tried.map((k) => Math.abs(k.mean ?? 0)))
  const learned =
    l.said === 'learned' && l.best
      ? `Vire learned: for this person, ${SHORT[l.best]} helps most.`
      : l.said === 'leaning' && l.best
        ? `So far ${SHORT[l.best]} has helped this person most. Still comparing.`
        : 'Too early to say what helps this person most.'
  const heardBy = r.heartFrom === 'airpods' ? (r.heartSources.length ? r.heartSources.join(', ') : 'the iPhone’s workout session') : r.heartFrom === 'camera' ? 'the camera' : null
  return (
    <section className="sg-search sg-practice" data-state="done" data-landed={demo ? '0' : '1'} data-kind={r.kind} data-practice={seen.id} aria-live="polite">
      <div className="sg-sr-side">
        <p className={`sg-sr-tag${demo ? ' is-demo' : ''}`}>
          <span className="sg-sr-dot" aria-hidden="true" />
          {demo ? 'A practice, demo signals' : 'A practice, from the AirPods'}
        </p>
        <h1>
          {NAME[r.kind]}
          {r.day ? `, day\u00a0${r.day}` : ''}. <span className="sg-pr-verdict">{v.h}</span>
        </h1>
        <p className="sg-sr-sub">{v.p}</p>
        {demo && <p className="sg-sr-demo">Demo signals: a script made this practice, not a person.</p>}

        <dl className="sg-sr-stats sg-pr-stats">
          <div data-stat="heart">
            <dt>{heardBy ? `heart rate before and after, from ${heardBy}` : 'heart rate: nothing measured it'}</dt>
            <dd>
              {num(r.before.heartBpm)} <i aria-hidden="true">→</i> {num(r.after.heartBpm)}
            </dd>
          </div>
          <div data-stat="still">
            <dt>head movement before and after, degrees a second</dt>
            <dd>
              {num(r.before.moveDegS, 1)} <i aria-hidden="true">→</i> {num(r.after.moveDegS, 1)}
            </dd>
          </div>
        </dl>

        <ul className="sg-pr-notes">
          {r.kind === 'breathe' && r.paceFirst !== null && r.paceLast !== null && (
            <li data-note="pace">
              The sound led the breath from {num(r.paceFirst, r.paceFirst % 1 ? 1 : 0)} to {num(r.paceLast, r.paceLast % 1 ? 1 : 0)} a minute
              {r.paceSlowest !== null && r.paceSlowest <= 6 && typeof r.slowestAtS === 'number' ? `, at 6 after ${r.slowestAtS} s` : ''}.{' '}
              {r.checks === 0
                ? 'The pace was not checked.'
                : r.followed > 0
                  ? `${demo ? 'The script’s breath was read' : 'The AirPods read the breath'} following in ${r.followed} of ${r.checks} checks.`
                  : r.byStillness > 0
                    ? `No breath could be read from the head, so the pace went by stillness (${r.byStillness} of ${r.checks} checks).`
                    : `The breath was not read following in any of ${r.checks} checks.`}
            </li>
          )}
          {r.kind === 'breathe' && r.heartFrom === 'airpods' && (
            <li data-note="swing">
              {r.heartSwing !== null
                ? `The heart rate swung ${r.heartSwing} beats with each breath at the slowest pace.`
                : `A heart-rate sample every ${num(r.heartEveryS, 1)} s: enough to see it settle, no swing with each breath is claimed.`}
            </li>
          )}
          {r.walk && (
            <li data-note="walk">
              Steps felt for {Math.round(r.walk.walkedS)} of {Math.round(r.walk.ofS)} seconds{r.walk.stepsPerMin ? `, ${Math.round(r.walk.stepsPerMin)} steps a minute` : ''}.
            </li>
          )}
          {seen.pieces.set + seen.pieces.live > 0 && (
            <li data-note="sound">
              Sound: this practice played {seen.pieces.set + seen.pieces.live} {seen.pieces.set + seen.pieces.live === 1 ? 'piece' : 'pieces'} made on a Modal GPU
              {seen.pieces.live ? `, ${seen.pieces.live} of them during the practice from what the ${demo ? 'stand-in' : 'AirPods'} read` : ''}.
            </li>
          )}
          <li data-note="why">{r.offered ? `Offered by Vire: ${r.offered.why}${r.offered.byDefault ? ' (a starting threshold, not yet this person’s own band)' : ''}` : 'Part of the daily five minutes, not offered after a drift.'}</li>
          <li data-note="hz">Camera off. {r.hz} {demo ? 'stand-in' : 'AirPods'} samples a second.</li>
        </ul>
      </div>

      <div className="sg-sr-board">
        <header>
          <b>What works for this person</b>
          <small>head stiller after than before, percent</small>
        </header>
        {tried.length === 0 ? (
          <p className="sg-sr-empty">No practice could be scored yet.</p>
        ) : (
          <ol>
            {l.kinds.map((k) => (
              <li key={k.kind} className={k.kind === l.best && l.said !== 'early' ? 'is-best' : ''} data-kind={k.kind}>
                <span className="sg-sr-rank">{k.n ? times(k.n) : 'not yet'}</span>
                <span className="sg-sr-name">{NAME[k.kind]}</span>
                <span className="sg-sr-bar" aria-hidden="true">
                  {k.mean !== null && k.mean > 0 && <i style={{ width: `${Math.max(2, (k.mean / top) * 100)}%` }} />}
                </span>
                <b>{k.mean === null ? '–' : `${k.mean > 0 ? '+' : ''}${Math.round(k.mean)}%`}</b>
              </li>
            ))}
          </ol>
        )}
        <p className="sg-pr-learned" data-said={l.said}>
          {learned}
        </p>
        <p className="sg-pr-next" data-next={l.next}>
          Next: {SHORT[l.next]} ({WHY[l.why]}).
        </p>
        <p className="sg-pr-fine">
          {seen.practices} {seen.practices === 1 ? 'practice' : 'practices'} {demo ? 'from the script' : 'from this device'}, {l.total} scored. Each is scored by how much stiller the head sat when asked to sit still, after it against before it. That is restlessness, not the head
          movement through a day that the clinic list follows. No comparison without a practice yet. A signal for the clinic, not a diagnosis.
        </p>
      </div>
    </section>
  )
}
