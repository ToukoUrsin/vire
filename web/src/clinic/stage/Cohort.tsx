// The whole clinic re-learns at once, on the big screen: one tile per simulated patient, each searched in a sandbox of
// its own with the network blocked. Every number comes from GET /api/ear/cohort/latest. The patients are made by a
// script and the screen says so, always. Once a patient's box is done, its tile also says which practice helps that
// patient most, learned again in the same box from the patient's (simulated) practice history, as far as the counts allow.
import { useEffect, useState } from 'react'
import type { CohortPatient, CohortRun, CohortWorks } from '@shared/cohort'
import type { CohortSeen } from './retrain'
import { whole } from '../../shared/whole'
import './cohort.css'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const secs = (s: number) => Math.round(s)

const KIND_WORDS: Record<string, string> = { breathe: 'breathing', scan: 'body scan', walk: 'walking' }
const kindWord = (k: string | null) => (k && KIND_WORDS[k]) || 'a practice'

/** what the tile says the patient's practices showed, in plain words: the practice, how far it is said, the count */
export function worksWords(w: CohortWorks): { head: string; how: string; count: string } {
  const count = plural(w.total, 'practice')
  if (w.said === 'learned') return { head: kindWord(w.best), how: 'helps most', count }
  if (w.said === 'leaning') return { head: kindWord(w.best), how: 'so far', count }
  return { head: 'too early', how: '', count }
}

/** where the boxes were: said exactly, so a test run on the worker's own machine is never called Modal */
function boxWords(run: CohortRun): string {
  return run.where === 'local' ? 'each in its own search on the worker’s machine (a test run, not Modal)' : 'each in its own network-blocked Modal Sandbox'
}

function copy(run: CohortRun): { tag: string; h: string; p: string } {
  const n = run.patients.length
  const done = run.patients.filter((p) => p.state === 'done').length
  switch (run.state) {
    case 'queued':
      return { tag: 'Waiting', h: 'The whole clinic is about to re-learn', p: `${plural(n, 'simulated patient')}, one locked box each. Waiting for the worker to start the sandboxes.` }
    case 'running':
      return { tag: 'Re-learning', h: 'The whole clinic is re-learning', p: `${plural(n, 'simulated patient')}, ${boxWords(run)}. Each box holds one patient’s data and nothing else.` }
    case 'failed':
      return { tag: 'Stopped', h: 'The re-training stopped', p: done ? `${done} of ${n} simulated patients had re-learned before it stopped.` : 'No patient had re-learned before it stopped.' }
    case 'done':
      return {
        tag: 'Done',
        h: done === n ? `${plural(n, 'patient')} re-learned in ${plural(secs(run.seconds), 'second')}` : `${done} of ${n} patients re-learned in ${plural(secs(run.seconds), 'second')}`,
        p: `${boxWords(run)[0]!.toUpperCase()}${boxWords(run).slice(1)}.${done < n ? ` ${n - done} could not finish.` : ''}`,
      }
  }
}


function Tile({ p }: { p: CohortPatient }) {
  const label = p.name && p.id ? <a className="ch-n" href={`#/clinic/p/${p.id}`}>{p.name}</a> : <span className="ch-n">{String(p.n).padStart(2, '0')}</span>
  return (
    <li className="ch-tile" data-state={p.state} data-n={p.n}>
      {label}
      {p.state === 'done' && p.auc !== null ? (
        <>
          {/* the name has its own line; the score sits at the end of its bar, so neither can run into the other */}
          <span className="ch-top">
            <span className="ch-bar" aria-hidden="true">
              <i style={{ width: `${Math.max(2, ((p.auc - 0.5) / 0.5) * 100)}%` }} />
            </span>
            <b className="ch-auc">{p.auc.toFixed(2)}</b>
          </span>
          {p.works && <Works w={p.works} />}
        </>
      ) : p.state === 'running' ? (
        <>
          <b className="ch-count">{p.tried || ''}</b>
          <span className="ch-word">
            <span className="ch-pulse" aria-hidden="true" />
            {p.tried ? 'tried' : 'starting'}
          </span>
        </>
      ) : (
        <span className="ch-word">{p.state === 'failed' ? (p.error || 'failed') : 'waiting'}</span>
      )}
    </li>
  )
}

function Works({ w }: { w: CohortWorks }) {
  const words = worksWords(w)
  return (
    <span className="ch-works" data-said={w.said} data-best={w.said === 'early' ? '' : (w.best ?? '')}>
      <b>{words.head}</b>
      {words.how && <small>{words.how}</small>}
      <small>{words.count}</small>
    </span>
  )
}

/** how many done patients have a practice learned, leaning, too early; and which practices were learned */
export function worksTally(patients: CohortPatient[]) {
  const ws = patients.filter((p) => p.state === 'done' && p.works).map((p) => p.works!)
  const of = (said: CohortWorks['said']) => ws.filter((w) => w.said === said)
  const learned = of('learned')
  return { all: ws.length, learned: learned.length, leaning: of('leaning').length, early: of('early').length }
}

/** columns for n tiles: a wide grid for a full clinic, one row for a handful */
const columns = (n: number) => (n <= 10 ? n : n <= 24 ? 6 : n <= 40 ? 8 : 10)

export function CohortBoard({ seen }: { seen: CohortSeen }) {
  const { run } = seen
  const c = copy(run)
  const n = run.patients.length
  const scores = run.patients.map((p) => p.auc).filter((x): x is number => x !== null)
  const lo = scores.length ? Math.min(...scores) : null
  const hi = scores.length ? Math.max(...scores) : null
  const over = run.state === 'done' || run.state === 'failed'
  const tally = worksTally(run.patients)
  return (
    <section className="ch" data-state={run.state} data-where={run.where ?? ''} aria-live="polite">
      <div className="ch-side">
        <p className="ch-tag">
          <span className="ch-dot" aria-hidden="true" />
          Simulated patients · {c.tag}
        </p>
        <h1>{whole(c.h)}</h1>
        <p className="ch-sub">{c.p}</p>
        <p className="ch-demo">Simulated patients: a script made every minute and practice here, not people. Demo signals.</p>
        {run.state === 'failed' && run.error && <p className="ch-err">{run.error}</p>}

        <dl className="ch-stats">
          <div>
            <dt>{over ? 'peak sandboxes at once' : 'sandboxes running now'}</dt>
            <dd data-sandboxes>{over ? run.peak : run.sandboxes}</dd>
          </div>
          <div>
            <dt>models tried, as many as fit in each search</dt>
            <dd data-tried>{run.tried.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>seconds</dt>
            <dd data-seconds>{secs(run.seconds)}</dd>
          </div>
        </dl>
        {lo !== null && hi !== null && (
          <p className="ch-range">
            Held-out scores {over ? '' : 'so far '}from <b>{lo.toFixed(2)}</b> to <b>{hi.toFixed(2)}</b>: each patient’s model is checked on a whole minute it never saw.
          </p>
        )}
      </div>

      <div className="ch-board">
        <header>
          <b>{plural(n, 'simulated patient')}, one sandbox each</b>
          <small>held-out score (1.00 is never wrong), then what helps most</small>
        </header>
        <ol className="ch-grid" style={{ ['--cols' as string]: columns(n), ['--rows' as string]: Math.ceil(n / columns(n)) }}>
          {run.patients.map((p) => (
            <Tile key={p.n} p={p} />
          ))}
        </ol>
        {tally.all > 0 && (
          <footer className="ch-works-sum" data-works>
            <span>What helps most, re-learned in each box from the patient’s simulated practices:</span>
            <span className="ch-works-n">
              <span data-said="learned">
                <b>{tally.learned}</b> learned
              </span>
              <span data-said="leaning">
                <b>{tally.leaning}</b> leaning
              </span>
              <span data-said="early">
                <b>{tally.early}</b> too early
              </span>
            </span>
          </footer>
        )}
      </div>
    </section>
  )
}

/** the small corner button that starts a run; the server's refusal is shown in its own words */
export function CohortButton({ start, going, here = false }: { start: () => Promise<string | null>; going: boolean; here?: boolean }) {
  const [say, setSay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!say) return
    const id = setTimeout(() => setSay(null), 9000)
    return () => clearTimeout(id)
  }, [say])
  return (
    <div className={here ? 'ch-start ch-start--here' : 'ch-start'}>
      {say && (
        <p className="ch-start-say" role="status">
          {say}
        </p>
      )}
      <button
        type="button"
        disabled={busy || going}
        onClick={async () => {
          setBusy(true)
          setSay(await start())
          setBusy(false)
        }}
      >
        {going ? 'The clinic is re-learning' : 'Re-train the whole clinic'}
      </button>
    </div>
  )
}
