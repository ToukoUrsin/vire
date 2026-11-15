// You: this person's own AirPods model (real, read from the model object), privacy, and the way to the rest.
import { useState, type CSSProperties } from 'react'
import type { EarEvent, EarModel2 } from '@shared/ear'
import { ALL } from '../data/refs'
import { inApp, useModel } from '../live/pods'
import { I, type IconName } from '../ui/icons'
import { Badge, Btn, Chip, Row, RunsOn, Screen, Section, Sheet, Stat } from '../ui/kit'
import { PodsChip } from './Today'
import './you.css'

const rise = (i: number) => ({ '--i': i }) as CSSProperties

// ---------- the model ----------
const SHOWN: Array<{ id: EarEvent; name: string; icon: IconName; tone: 'move' | 'face' }> = [
  { id: 'nod', name: 'Nod', icon: 'nod', tone: 'move' },
  { id: 'shake', name: 'Head shake', icon: 'shake', tone: 'move' },
  { id: 'smile', name: 'Smile', icon: 'smile', tone: 'face' },
]
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** a score on the bar: 0.50 (luck) is its left end, 1.00 (never wrong) its right end */
const along = (auc: number) => `${(Math.max(0, Math.min(1, (auc - 0.5) / 0.5)) * 100).toFixed(1)}%`
const when = (iso: string): string | null => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/** everything here is read from the model object: nothing is a sample */
function made(m: EarModel2): string {
  const minutes = plural(m.minutes ?? 1, 'teaching minute')
  const tried = `${plural(m.tried, 'model')} tried`
  const where = m.by === 'sandbox' ? 'in its own Modal Sandbox with the network blocked' : 'on this phone'
  const day = when(m.at)
  return `Learned from ${minutes}${day ? ` on ${day}` : ''}. ${tried}, ${where}.`
}

function ModelCard({ m }: { m: EarModel2 }) {
  const rows = SHOWN.flatMap((e) => {
    const ev = m.events[e.id]
    return ev ? [{ ...e, score: ev.score }] : []
  })
  const alone = rows.filter((r) => r.score.ok)
  const says = alone.length ? `Reads your ${alone.map((r) => (r.id === 'shake' ? 'head shakes' : `${r.id}s`)).join(', ').replace(/, ([^,]*)$/, ' and $1')} from the AirPods alone` : 'Taught, still learning'
  return (
    <div className="card yu-model">
      <div className="yu-model-head">
        <Badge icon="airpods" tone="ember" size={46} />
        <div>
          <div className="title-m">Your AirPods model</div>
          <div className="row-sub">{says}</div>
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="yu-scores">
            {rows.map((r, k) => {
              const checked = r.score.windows > 0
              return (
                <div key={r.id} className={`yu-score ${r.score.ok ? '' : 'is-off'}`}>
                  <span className="yu-score-name">
                    <Badge icon={r.icon} tone={r.score.ok ? r.tone : 'plain'} size={26} />
                    {r.name}
                  </span>
                  <span className="yu-score-num num">{checked ? r.score.auc.toFixed(2) : '–'}</span>
                  {checked && (
                    <span className="yu-score-bar" role="img" aria-label={`${r.name}: ${r.score.auc.toFixed(2)}, where 0.50 is luck and 1.00 is never wrong`}>
                      <i style={{ '--w': along(r.score.auc), '--tone': `var(--${r.tone})`, '--k': k } as CSSProperties} />
                    </span>
                  )}
                  <span className="yu-score-word">{!checked ? 'Not checked yet' : r.score.ok ? 'AirPods alone' : 'Camera keeps it'}</span>
                </div>
              )
            })}
          </div>
          <p className="small yu-axis">
            1.00 is never wrong, 0.50 is luck. Checked on {m.held === 'minute' ? 'a whole minute' : m.held === 'round' ? 'a round' : 'parts'} the model never saw.
          </p>
        </>
      )}

      <div className="yu-model-acts">
        <Btn to="/live">See it live</Btn>
        <Btn kind="quiet" to="/train">
          Teach more
        </Btn>
      </div>

      <div className="yu-model-made">
        <p className="small num">{made(m)}</p>
        {m.shell === 'sim' && <p className="small">This one was made from scripted signals, not from a person.</p>}
        <RunsOn />
      </div>
    </div>
  )
}

function Teach() {
  return (
    <div className="card yu-model yu-teach">
      <Badge icon="airpods" tone="ember" size={52} />
      <h2 className="title-l yu-teach-title">Teach your AirPods</h2>
      <p className="body-2 yu-teach-say">One minute with the camera. Then Vire says what it can read from the AirPods alone.</p>
      <div className="pills yu-teach-pills">
        {SHOWN.map((e) => {
          const C = I[e.icon]
          return (
            <span key={e.id} className="pill">
              <C size={15} /> {e.name}
            </span>
          )
        })}
      </div>
      <Btn kind="ember" wide to="/train">
        Teach them, 65 seconds
      </Btn>
      <div className="yu-model-made">
        <RunsOn />
      </div>
    </div>
  )
}

// ---------- the iPhone app ----------
type Bridge = { webkit?: { messageHandlers?: { vire?: { postMessage(m: unknown): void } } } }
const setUrl = (url: string) => (window as unknown as Bridge).webkit?.messageHandlers?.vire?.postMessage({ cmd: 'setUrl', url })
/** already on the Home Screen: nothing to add */
const standalone = (): boolean => (navigator as unknown as { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches

export function You(_: { id?: string; topic?: string }) {
  const model = useModel()
  const [sheet, setSheet] = useState(false)
  const app = inApp()
  const addHome = !app && !standalone()
  return (
    <Screen glow="ember">
      <div className="pad rise yu-top" style={rise(0)}>
        <h1 className="title-xl">You</h1>
        <PodsChip />
      </div>

      <div className="pad rise yu-hero" style={rise(1)}>
        <div className="yu-real">
          <Chip tone="live" dot>
            Real, on this phone
          </Chip>
        </div>
        {model ? <ModelCard m={model} /> : <Teach />}
      </div>

      <Section title="About Vire" i={2}>
        <div className="group">
          <Row icon="spark" tone="face" title="The evidence" sub={`${ALL.length} studies, each one checked`} to="/research" />
          <Row icon="paper" tone="move" title="The paper" sub="What we built and measured" to="/paper" />
          <Row icon="loop" tone="ember" title="How Vire works" sub="The loop, step by step" to="/loop" />
        </div>
      </Section>

      <Section title="Privacy" i={3}>
        <div className="group">
          <Row icon="lock" tone="voice" title="Only numbers leave the phone" sub="No video, no sound" />
          <Row icon="box" tone="voice" title="A sandbox of its own, on Modal" sub="Your model is made there, with the network blocked" />
          <Row icon="shield" tone="voice" title="A signal for the clinic, not a diagnosis" sub="No patient or clinic has used it yet" />
        </div>
      </Section>

      {addHome && (
        <Section title="This app" i={4}>
          <div className="group">
            <Row icon="share" title="Add Vire to your Home Screen" sub="It opens like an app" onClick={() => setSheet(true)} />
          </div>
        </Section>
      )}

      {app && (
        <Section title="This iPhone app" i={4}>
          <div className="group">
            <Row icon="check" title="Open here every time" sub="Start in this app, not in the lab" onClick={() => setUrl(`${location.origin}/app/`)} />
            <Row icon="out" title="Back to the lab" sub="The pages the app was built on" onClick={() => setUrl(`${location.origin}/#/ears`)} />
          </div>
        </Section>
      )}

      <p className="yu-foot rise" style={rise(5)}>
        <b>Vire</b>
        Built at Junction 2026 in Espoo.
      </p>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Add Vire to your Home Screen">
        <ol className="yu-hs-steps">
          <li>
            <span className="badge num">1</span>
            <span>
              In Safari, tap Share <I.share size={20} />
            </span>
          </li>
          <li>
            <span className="badge num">2</span>
            <span>Tap Add to Home Screen</span>
          </li>
          <li>
            <span className="badge num">3</span>
            <span>Tap Add</span>
          </li>
        </ol>
        <p className="small" style={{ marginTop: 14 }}>
          After that Vire opens like an app, full screen.
        </p>
      </Sheet>
    </Screen>
  )
}

// ---------- the paper ----------
// Title, authors and abstract copied from paper/vire.tex as it stood on 14.11.2026 at 23:00.
const PAGES = [1, 2, 3, 4, 5, 6]

export function Paper(_: { id?: string; topic?: string }) {
  const [page, setPage] = useState(true)
  return (
    <Screen nav="The paper" backTo="/you" glow="move">
      <div className="pad rise" style={rise(0)}>
        <div className="pills yu-paper-tags">
          <span className="pill">Hackathon preprint</span>
          <span className="pill">Not peer reviewed</span>
        </div>
        <h1 className="title-l">Vire: Per-Person Head-Gesture Models from Consumer Earbuds and a Closed Loop for Staying Well After TMS</h1>
        <p className="yu-paper-by">
          Touko Ursin and the Vire team
          <span>Junction 2026, Espoo, Finland</span>
        </p>
        {/* the iPhone app has no way back from a PDF, so there the pages below are the paper */}
        {!inApp() && (
          <div className="yu-paper-acts">
            <a className="btn btn-primary yu-open" href="/app/vire-paper.pdf" target="_blank" rel="noreferrer">
              <I.paper size={19} />
              Open the PDF
            </a>
            <a className="btn btn-quiet yu-open" href="/app/vire-paper.pdf" download="vire-paper.pdf">
              <I.down size={19} />
              Download
            </a>
          </div>
        )}
      </div>

      <Section title="What we measured" i={1}>
        <div className="stat-grid">
          <Stat icon="nod" tone="move" label="Nods" value="0.97" sub="AUC on a minute it never saw" />
          <Stat icon="shake" tone="move" label="Head shakes" value="0.97" sub="shuffled labels: 0.56 to 0.59" />
          <Stat icon="smile" label="Smile" value="0.64" sub={<b>Failed its check</b>} />
          <Stat icon="box" tone="ember" label="The search" value="46" unit="s" sub="366 models, one person" />
        </div>
        <p className="yu-paper-limit">Limits: one person, simulated patients, no clinical validation.</p>
      </Section>

      <Section title="Abstract" i={2}>
        <div className="card yu-paper-abs">
          <p>Transcranial magnetic stimulation (TMS) for depression is given at the clinic, but its benefit often fades at home: in a meta-analysis of 19 studies, 46.3% of initial responders still responded at twelve months.</p>
          <p>We built Vire, an iPhone app that uses AirPods as sensor and speaker. In a 65-second teaching minute the camera labels smiles, nods and head shakes while the AirPods’ motion is recorded; a sandbox without network then searches 366 candidate models for that person.</p>
          <p>With three teaching minutes from one person, the search took 46.06 s and reached an AUC of 0.972 for nods and 0.971 for head shakes on a minute it never saw (shuffled labels: 0.56 to 0.59). Smile reached 0.644 and failed its check. A shared model pretrained on 30 other people did not clearly win.</p>
          <p>The loop around the model (practice, re-check, per-person learner, clinic list) has run only with stand-in AirPods and simulated patients.</p>
        </div>
      </Section>

      {page && (
        <Section title="The pages" i={3}>
          <div className="yu-pages">
            {PAGES.map((n) => (
              <figure key={n} className="yu-page">
                <img src={`/app/paper-${n}.png`} alt={`Page ${n} of the paper`} loading={n > 1 ? 'lazy' : undefined} onError={() => setPage(false)} />
                <figcaption className="num">
                  {n} of {PAGES.length}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      <Section i={4}>
        <div className="group">
          <Row icon="spark" tone="face" title="The evidence" sub={`${ALL.length} studies, each one checked`} to="/research" />
        </div>
      </Section>
    </Screen>
  )
}
