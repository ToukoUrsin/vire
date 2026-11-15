// You: this person's own AirPods model (real, read from the model object), privacy, and the way to the rest.
import { useState, type CSSProperties } from 'react'
import type { EarEvent, EarModel2 } from '@shared/ear'
import { ALL } from '../data/refs'
import { inApp, useModel } from '../live/pods'
import { I, type IconName } from '../ui/icons'
import { Badge, Btn, Head, Row, Screen, Section, Sheet } from '../ui/kit'
import './you.css'

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
    <div className="card">
      <div className="yu-model-head">
        <Badge icon="airpods" tone="ember" size={46} />
        <div>
          <div className="row-title">Your own model</div>
          <div className="row-sub">{says}</div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="yu-model-scores">
          {rows.map((r, k) => {
            const checked = r.score.windows > 0
            return (
              <div key={r.id} className={`yu-score ${r.score.ok ? '' : 'is-off'}`}>
                <Badge icon={r.icon} tone={r.score.ok ? r.tone : 'plain'} />
                <div>
                  <div className="yu-score-top">
                    <span className="yu-score-name">{r.name}</span>
                    {checked && <span className="yu-score-num num">{r.score.auc.toFixed(2)}</span>}
                  </div>
                  {checked && (
                    <div className="yu-score-bar" role="img" aria-label={`${r.name}: ${r.score.auc.toFixed(2)}, where 0.50 is luck and 1.00 is never wrong`}>
                      <i style={{ '--w': along(r.score.auc), '--tone': `var(--${r.tone})`, '--k': k } as CSSProperties} />
                    </div>
                  )}
                  <div className="yu-score-word">{!checked ? 'Not checked yet' : r.score.ok ? 'Reads it from the AirPods alone' : 'The camera keeps this one'}</div>
                </div>
              </div>
            )
          })}
          <div className="yu-score-axis num" aria-hidden="true">
            <span>0.50 luck</span>
            <span>1.00 never wrong</span>
          </div>
        </div>
      )}

      <div className="yu-model-made">
        <p className="body-2 num">{made(m)}</p>
        <p className="small">The score: 1.00 is never wrong, 0.50 is luck. It is checked on {m.held === 'minute' ? 'a whole minute' : m.held === 'round' ? 'a round' : 'parts'} the model never saw.</p>
        {m.shell === 'sim' && <p className="small">This one was made from scripted signals, not from a person.</p>}
      </div>

      <div className="yu-model-acts">
        <Btn wide to="/live">
          See it live
        </Btn>
        <Btn kind="quiet" wide to="/train">
          Teach another minute
        </Btn>
      </div>
    </div>
  )
}

function Teach() {
  return (
    <div className="card">
      <div className="yu-teach">
        <Badge icon="airpods" tone="ember" size={46} />
        <div>
          <div className="row-title">Teach your AirPods</div>
          <div className="row-sub">65 seconds. The camera shows them your nod, your head shake and your smile.</div>
        </div>
      </div>
      <Btn wide to="/train">
        Teach them, 65 seconds
      </Btn>
      <p className="small" style={{ marginTop: 12 }}>
        Then Vire tells you which ones it can read from the AirPods alone.
      </p>
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
  return (
    <Screen>
      <Head title="You" sub="Your model, your data, and how Vire works." />

      <Section title="Your AirPods model" i={1}>
        {model ? <ModelCard m={model} /> : <Teach />}
      </Section>

      <Section title="Privacy" i={2}>
        <div className="group">
          <Row icon="lock" title="Only numbers leave the phone" sub="No video, no sound" />
          <Row icon="box" title="A sandbox of its own, on Modal" sub="Your model is made there, with the network blocked" />
          <Row icon="shield" title="A signal for the clinic, not a diagnosis" sub="No patient or clinic has used it yet" />
        </div>
      </Section>

      <Section title="More" i={3}>
        <div className="group">
          <Row icon="spark" title="The evidence" sub={`${ALL.length} studies, each one checked`} to="/research" />
          <Row icon="paper" title="The paper" sub="What we built and measured" to="/paper" />
          <Row icon="loop" title="How Vire works" sub="The loop, step by step" to="/loop" />
          {!app && !standalone() && <Row icon="share" title="Add Vire to your Home Screen" sub="It opens like an app" onClick={() => setSheet(true)} />}
        </div>
      </Section>

      {app && (
        <Section title="This iPhone app" i={4}>
          <div className="group">
            <Row icon="check" title="Open here every time" sub="Start in this app, not in the lab" onClick={() => setUrl(`${location.origin}/app/`)} />
            <Row icon="out" title="Back to the lab" sub="The pages the app was built on" onClick={() => setUrl(`${location.origin}/#/ears`)} />
          </div>
        </Section>
      )}

      <p className="yu-foot rise" style={{ '--i': 5 } as CSSProperties}>
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
export function Paper(_: { id?: string; topic?: string }) {
  const [page, setPage] = useState(true)
  return (
    <Screen nav="The paper" backTo="/you">
      <div className="pad rise" style={{ '--i': 0 } as CSSProperties}>
        <h1 className="title-l">Vire: Per-Person Head-Gesture Models from Consumer Earbuds and a Closed Loop for Staying Well After TMS</h1>
        <p className="yu-paper-by">
          Touko Ursin and the Vire team
          <span>Junction 2026, Espoo, Finland. Hackathon preprint, not peer reviewed.</span>
        </p>
      </div>

      <Section title="Abstract" i={1}>
        <div className="card yu-paper-abs">
          <p>Transcranial magnetic stimulation (TMS) for depression is given at the clinic, but its benefit often fades at home: in a meta-analysis of 19 studies, 46.3% of initial responders still responded at twelve months.</p>
          <p>We built Vire, an iPhone app that uses AirPods as sensor and speaker. In a 65-second teaching minute the camera labels smiles, nods and head shakes while the AirPods’ motion is recorded; a sandbox without network then searches 366 candidate models for that person.</p>
          <p>With three teaching minutes from one person, the search took 46.06 s and reached an AUC of 0.972 for nods and 0.971 for head shakes on a minute it never saw (shuffled labels: 0.56 to 0.59). Smile reached 0.644 and failed its check. A shared model pretrained on 30 other people did not clearly win.</p>
          <p>The loop around the model (practice, re-check, per-person learner, clinic list) has run only with stand-in AirPods and simulated patients.</p>
          <p className="yu-paper-limit">Limits: one person, simulated patients, no clinical validation.</p>
        </div>
      </Section>

      <Section i={2}>
        {/* the iPhone app has no way back from a PDF, so there the pages below are the paper */}
        {!inApp() && (
          <a className="btn btn-primary btn-wide yu-open" href="/app/vire-paper.pdf" target="_blank" rel="noreferrer">
            <I.paper size={19} />
            Open the PDF
          </a>
        )}
        {page && [1, 2, 3, 4, 5, 6].map((n) => <img key={n} className="yu-paper-page" src={`/app/paper-${n}.png`} alt={`Page ${n} of the paper`} loading={n > 1 ? 'lazy' : undefined} onError={() => setPage(false)} />)}
      </Section>

      <Section i={3}>
        <div className="group">
          <Row icon="spark" title="The evidence" sub={`${ALL.length} studies, each one checked`} to="/research" />
        </div>
      </Section>
    </Screen>
  )
}
