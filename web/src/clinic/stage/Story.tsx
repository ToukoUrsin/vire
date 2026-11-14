// The ping as a story, on one line: five questions, the echo they resolve into, the dose, and the measure again.
// Each question's answer appears under it, in its channel's colour, when its phase ends.
import { useEffect, useRef } from 'react'
import type { Channel, PhaseKey, StepReading } from '@shared/types'
import { stepReadingText } from '../../app/echoText'
import { onFrame } from './loop'
import type { Measures, Run, Stage, View } from './store'

const STEPS: { key: PhaseKey; name: string; ch: Channel | null; grow: number }[] = [
  { key: 'settle', name: 'Settle', ch: null, grow: 16 },
  { key: 'nod', name: 'Nod', ch: 'move', grow: 20 },
  { key: 'laugh', name: 'Laugh', ch: 'smile', grow: 21 },
  { key: 'speak', name: 'Speak', ch: 'voice', grow: 16 },
  { key: 'breathe', name: 'Breathe', ch: 'heart', grow: 25 },
]

/** what the mirror read for one phase, in a few words */
export function answer(key: PhaseKey, _m: Measures, ended: boolean, known = true, phone?: StepReading, airpodsOnly = false): string {
  // the phone sends a step's reading as soon as it has one: the smile's time while the laugh still plays, the rest as each step ends
  if (phone) return stepReadingText(key, phone)
  if (!ended) return 'reading'
  return airpodsOnly ? 'not read' : known ? 'reading' : 'joined part-way'
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Story({ stage, view }: { stage: Stage; view: View }) {
  const fills = useRef<(HTMLElement | null)[]>([])
  const chips = useRef<(HTMLElement | null)[]>([])
  const againFill = useRef<HTMLElement>(null)
  const againChip = useRef<HTMLElement>(null)
  const doseChip = useRef<HTMLElement>(null)

  const run = stage.run
  const ping: Run | null = run?.kind === 'full' ? run : stage.firstRun
  const mini: Run | null = run?.kind === 'mini' ? run : null
  const state = (key: PhaseKey) => {
    const ph = ping?.phases.find((p) => p.key === key)
    if (!ph) return ping?.cold && ping.phases.length && STEPS.findIndex((s) => s.key === key) < STEPS.findIndex((s) => s.key === ping.phases[0].key) ? 'is-missed' : ''
    return ph.end === null && ping === run && view.mode === 'ping' ? 'is-now' : 'is-done'
  }
  const echoState = view.mode === 'echo' && !view.before ? 'is-now' : view.mode === 'reading' ? 'is-now is-wait' : view.echo || view.doseSeen || mini ? 'is-done' : ''
  const doseState = view.mode === 'dose' ? 'is-now' : view.doseSeen ? 'is-done' : ''
  const againState = mini ? (mini.endedAt === null && view.mode === 'ping' ? 'is-now' : 'is-done') : ''

  useEffect(() => {
    let lastText = 0
    return onFrame((now) => {
      const r = stage.run
      const pg = r?.kind === 'full' ? r : stage.firstRun
      const mn = r?.kind === 'mini' ? r : null
      STEPS.forEach((s, i) => {
        const el = fills.current[i]
        if (!el) return
        const ph = pg?.phases.find((p) => p.key === s.key)
        const k = !ph ? 0 : ph.end !== null ? 1 : ph.known ? Math.min(1, (now - ph.at) / ph.ms) : 0.5 + 0.12 * Math.sin(now / 500)
        el.style.transform = `scaleX(${k.toFixed(4)})`
      })
      if (againFill.current) {
        let k = 0
        if (mn) {
          const total = mn.phases.reduce((a, p) => a + p.ms, 0) + (mn.phases.length === 1 ? 10000 : 0)
          let got = 0
          for (const p of mn.phases) got += p.end !== null ? p.ms : Math.min(p.ms, now - p.at)
          k = mn.endedAt !== null ? 1 : Math.min(1, got / total)
        }
        againFill.current.style.transform = `scaleX(${k.toFixed(4)})`
      }
      if (now - lastText < 200) return
      lastText = now
      STEPS.forEach((s, i) => {
        const el = chips.current[i]
        if (!el) return
        const ph = pg?.phases.find((p) => p.key === s.key)
        const t = ph && pg ? answer(s.key, pg.m, ph.end !== null, ph.known, stage.phoneReadings[s.key], view.camera === false) : ''
        if (el.textContent !== t) el.textContent = t
      })
      if (againChip.current) {
        const cur = mn?.phases[mn.phases.length - 1]
        const t = mn && cur ? answer(mn.endedAt !== null ? 'breathe' : cur.key, mn.m, mn.endedAt !== null) || answer('laugh', mn.m, true) : ''
        if (againChip.current.textContent !== t) againChip.current.textContent = t
      }
      if (doseChip.current) {
        const t = !stage.doseSeen ? '' : stage.phase === 'dose' ? clock(now - stage.doseStart) : stage.doseEnd > stage.doseStart ? clock(stage.doseEnd - stage.doseStart) : ''
        if (doseChip.current.textContent !== t) doseChip.current.textContent = t
      }
    })
  }, [stage, view.camera])

  return (
    <ol className="sg-story" aria-label="The ping, step by step">
      {STEPS.map((s, i) => (
        <li key={s.key} className={state(s.key)} style={{ flexGrow: s.grow, ['--c' as string]: s.ch ? `var(--ch-${s.ch})` : 'var(--stage-ink)' }}>
          <span className="sg-step-bar">
            <i
              ref={(el) => {
                fills.current[i] = el
              }}
            />
          </span>
          <b>{s.name}</b>
          <span className="sg-chip">
            <i />
            <em
              ref={(el) => {
                chips.current[i] = el
              }}
            />
          </span>
        </li>
      ))}
      <li className={`sg-stop ${echoState}`} style={{ flexGrow: 11, ['--c' as string]: 'var(--stage-ink)' }}>
        <span className="sg-step-bar">
          <i style={{ transform: `scaleX(${echoState ? 1 : 0})` }} />
        </span>
        <b>Echo</b>
        <span className="sg-chip">
            <em>{view.first ? (!['steady', 'dipping', 'low'].includes(String(view.first.status)) ? `ping ${Math.min(3, view.first.pingsSoFar ?? 1)} of 3` : `${Math.round(view.first.strength)}, usual is 50`) : view.mode === 'reading' ? 'reading' : ''}</em>
        </span>
      </li>
      <li className={`sg-stop ${doseState}`} style={{ flexGrow: 11, ['--c' as string]: 'var(--ember)' }}>
        <span className="sg-step-bar">
          <i style={{ transform: `scaleX(${doseState ? 1 : 0})` }} />
        </span>
        <b>Dose</b>
        <span className="sg-chip">
          <em ref={doseChip} />
        </span>
      </li>
      <li className={`sg-stop ${againState}`} style={{ flexGrow: 16, ['--c' as string]: 'var(--stage-ink)' }}>
        <span className="sg-step-bar">
          <i ref={againFill} />
        </span>
        <b>Measure again</b>
        <span className="sg-chip">
          <em ref={againChip} />
        </span>
      </li>
    </ol>
  )
}
