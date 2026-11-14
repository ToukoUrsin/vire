// /#/science: the evidence page. A judge scans it in 30 seconds, a researcher digs for five minutes.
// Every factual sentence here was checked against its source on 13 Nov 2026 (pitch/claims.md has the supporting
// sentence for each). What we validate is that the sensors read the body; the link to depression is cited literature.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CHANNELS } from '@shared/types'
import type { Channel } from '@shared/types'
import type { DailyStatus } from '@shared/types'
import { apiUrl } from '../shared/api'
import { loadDetect, loadHall, loadValidation } from './live'
import type { DetectData, Hall, RobustRow, Validation } from './live'
import Loop from './Loop'
import { REFS, REF_KEYS } from './refs'
import type { RefKey } from './refs'
import './science.css'

// ---------- small pieces ----------

function Cite({ k }: { k: RefKey }) {
  const r = REFS[k]
  return (
    <a className="sci-cite" href={r.href} target="_blank" rel="noreferrer">
      {r.short}
    </a>
  )
}

const one = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 })
const whole = (v: number) => Math.round(v).toLocaleString('en-GB')
const pctText = (v: number) => `${one(v)}%`
const signed = (v: number) => `${v > 0 ? '+' : ''}${(Math.round(v * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`

function when(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <span className="sci-wait">
      <i className="sci-wait-dot" aria-hidden="true" />
      {children}
    </span>
  )
}

function Tile({ label, value, unit, note, pending = 'running' }: { label: string; value: string | null; unit?: string; note?: ReactNode; pending?: string }) {
  return (
    <div className="sci-tile">
      <div className="sci-tile-label">{label}</div>
      {value === null ? (
        <div className="sci-tile-value sci-tile-pending">
          <Waiting>{pending}</Waiting>
        </div>
      ) : (
        <div className="sci-tile-value">
          {value}
          {unit && <span className="sci-tile-unit">{unit}</span>}
        </div>
      )}
      {note && <div className="sci-tile-note">{note}</div>}
    </div>
  )
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="sci-section" id={`sci-${id}`}>
      <h2>{title}</h2>
      {intro && <p className="sci-intro">{intro}</p>}
      {children}
    </section>
  )
}

const NAV: { id: string; label: string }[] = [
  { id: 'problem', label: 'Problem' },
  { id: 'loop', label: 'Loop' },
  { id: 'channels', label: 'Channels' },
  { id: 'sensors', label: 'Sensors' },
  { id: 'hall', label: 'Hall' },
  { id: 'model', label: 'Personal model' },
  { id: 'limits', label: 'Not claimed' },
  { id: 'detect', label: 'Detection' },
  { id: 'pilot', label: 'Pilot' },
  { id: 'sources', label: 'References' },
]

// the hash is the route (HashRouter), so sections are reached by scrolling, not by #anchors
const go = (id: string) => document.getElementById(`sci-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

// ---------- the four channels ----------

const CHANNEL_NAME: Record<Channel, string> = { smile: 'Smile', voice: 'Voice', heart: 'Heart', move: 'Move' }

interface ChannelCard {
  channel: Channel
  measure: string
  figure: string
  figureLabel: string
  study: ReactNode
  also?: ReactNode
  caveat: ReactNode
}

const CARDS: ChannelCard[] = [
  {
    channel: 'smile',
    measure: 'How much you smile in the 12 seconds after a laugh plays. Smile-seconds, as a share of your own biggest smile.',
    figure: '19 people',
    figureLabel: 'filmed when severe and again when eased',
    study: (
      <>
        People in treatment for depression were filmed in interviews when symptoms were severe and again when they were low. When severe, they smiled
        less. <Cite k="girard2014" />
      </>
    ),
    caveat: (
      <>
        That was an interview with no laugh track, and the treatment was medication or talk therapy. Nobody had TMS. Hand coding found the smile
        difference; the automatic coding did not reach significance. People also know the smile is measured, and can put one on.
      </>
    ),
  },
  {
    channel: 'voice',
    measure: 'How much your pitch moves while you say one line, in semitones. Pauses and speaking rate are recorded too.',
    figure: '35 patients',
    figureLabel: 'followed for six weeks',
    study: (
      <>
        Patients who responded to treatment had more pitch variability, paused less and spoke faster than at the start. Those who did not respond
        did not change. <Cite k="mundt2007" />
      </>
    ),
    also: (
      <>
        In a second study of 105 adults the timing results held: responders paused less and spoke faster (<Cite k="mundt2012" />
        ). In 585 people recorded for 18 months, more symptoms went with slower and quieter speech (<Cite k="cummins2023" />
        ).
      </>
    ),
    caveat: (
      <>
        Pitch variability did not show up again in the second study, so the number in our echo rests on 35 patients. Pauses and speaking rate have
        the better evidence. We record both, but the echo does not use them yet. The big study compares across people.
      </>
    ),
  },
  {
    channel: 'heart',
    measure: 'How far your heart rate swings with two paced breaths: the part of it that moves at the pace of the breath, in beats per minute.',
    figure: 'g = -0.46',
    figureLabel: 'resting heart rate variability, depression against controls',
    study: (
      <>
        Across 21 studies and 2,250 patients, people with unmedicated depression had lower resting heart rate variability than controls. The
        figure is for RMSSD, the measure with the largest gap.{' '}
        <Cite k="koch2019" />
      </>
    ),
    also: (
      <>
        Why look at the heart after TMS at all: during stimulation at the frontal sites used for depression, heart rate dropped in ten healthy
        volunteers (<Cite k="iseger2017" />
        ) and again in 20 (<Cite k="kaur2020" />
        ), and in 15 patients real iTBS slowed it more than sham in the first minute (<Cite k="iseger2020" />
        ). That is during stimulation. It says nothing about a breathing swing at home.
      </>
    ),
    caveat: (
      <>
        This is the weakest of the four. It is still in the app&apos;s echo, and the pilot&apos;s main score leaves it out. The studies are
        about resting variability across people. Nobody has shown that a swing over two breaths follows one person&apos;s mood. The clinical breathing test uses six breaths or more and beat-to-beat timing (<Cite k="shields2009" />
        ); we get two breaths, so we do not call it HRV. The reading itself is checked against an oximeter below; what it means for mood is not. A 2026 study found consistent slowing at only one of its prefrontal
        targets, with above-threshold stimulation (<Cite k="feng2026" />
        ).
      </>
    ),
  },
  {
    channel: 'move',
    measure: 'How fast you nod when asked to. Peak speed in degrees per second, from the AirPods or the camera.',
    figure: 'Smaller, slower',
    figureLabel: 'head movement when severe',
    study: (
      <>
        Same study as the smile: head movements were smaller and slower when symptoms were severe, and picked up as they eased.{' '}
        <Cite k="girard2014" />
      </>
    ),
    caveat: <>That was head motion in conversation. A nod on request is a different thing. One study, 19 people.</>,
  },
]

// ---------- sensors (validation.json) ----------

const CONDITION_NAME: Record<string, string> = {
  original: 'As recorded',
  light50: 'Half the light',
  light25: 'A quarter of the light',
  light12: 'Dark corner (12% light)',
  backlight: 'Against a bright window',
  noise: 'Noisy sensor',
  fps15: 'Half the frame rate',
  halfres: 'Face half the size',
}

function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="sci-notrun">not run</span>
  return (
    <span className="sci-meter" data-tip={pctText(value)}>
      <span className="sci-meter-num">{pctText(value)}</span>
      <span className="sci-meter-track" aria-hidden="true">
        <span className="sci-meter-fill" style={{ width: `${value}%` }} />
      </span>
    </span>
  )
}

function Robustness({ rows }: { rows: RobustRow[] }) {
  return (
    <div className="sci-card sci-robust">
      <h3>When the picture gets worse</h3>
      {rows.length > 0 && (
        <p className="sci-card-sub">
          A shorter cut of the same recordings, run again through video filters that imitate a hall. The first row is that cut with no filter,
          so it differs from the figures above.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="sci-pending-line">
          <Waiting>Still running:</Waiting> the same recordings again in dim light, against a window, at half the frame rate and with the face half
          the size.
        </p>
      ) : (
        <div className="sci-table-scroll">
          <table className="sci-table">
            <thead>
              <tr>
                <th scope="col">Condition</th>
                <th scope="col">Face found</th>
                <th scope="col">Pulse reported</th>
                <th scope="col">Smiles caught</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.condition}-${i}`}>
                  <th scope="row">{CONDITION_NAME[r.condition] ?? r.condition}</th>
                  <td>
                    <Meter value={r.faceFoundPct} />
                  </td>
                  <td>
                    <Meter value={r.pulseCoveragePct} />
                  </td>
                  <td>
                    <Meter value={r.smileSensitivityPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const OUR_LIMITS = [
  'These checks are about reading the body: the pulse rate, and whether a smile is found, in people who are not patients. They do not test any link between the readings and depression.',
]
// the file's own first line says the same thing as ours, but claims more than was checked ("validates that the sensors read the body")
const SAID_ALREADY = /^This (validates that the sensors read the body|checks two things)/i

function Sensors({ v }: { v: Validation | null }) {
  const p = v?.pulse ?? null
  const w = v?.swing ?? null
  const s = v?.smile ?? null
  const stamp = when(v?.generatedAt ?? null)
  const pulseMeta = [
    p?.subjects != null ? `${whole(p.subjects)} people` : null,
    p?.minutes != null ? `${one(p.minutes)} minutes of video` : null,
    p?.reference,
  ].filter((x): x is string => !!x)
  const smileMeta = [s?.clips != null ? `${whole(s.clips)} clips` : null, s?.people != null ? `${whole(s.people)} people` : null, s?.source].filter(
    (x): x is string => !!x,
  )
  return (
    <Section
      id="sensors"
      title="How well the sensors read"
      intro={
        <>
          We fed public recordings to the app&apos;s own sensing code as if they were its camera. Pulse is scored every 5 seconds against the finger
          oximeter recorded with the video. Smiles are scored against frames labelled by eye before any score was seen.
        </>
      }
    >
      <p className="sci-status">
        {v ? (
          <>
            <i className="sci-ok-dot" aria-hidden="true" />
            Measured{stamp ? ` ${stamp}` : ''}
          </>
        ) : (
          <Waiting>Measurement running. The numbers land here when the run finishes.</Waiting>
        )}
      </p>
      <div className="sci-two">
        <div className="sci-card">
          <h3>Pulse from the camera</h3>
          <p className="sci-card-sub">
            {p?.dataset ? (
              p.url ? (
                <a className="sci-cite" href={p.url} target="_blank" rel="noreferrer">
                  {p.dataset}
                </a>
              ) : (
                p.dataset
              )
            ) : (
              'UBFC-rPPG, faces filmed with a finger oximeter on'
            )}
            {pulseMeta.length > 0 && <> · {pulseMeta.join(' · ')}</>}
          </p>
          <div className="sci-tiles sci-tiles-2">
            <Tile label="Typical error" value={p?.maeBpm != null ? one(p.maeBpm) : null} unit="bpm" note="mean absolute error, when a number is shown" />
            <Tile label="Within 5 bpm" value={p?.within5Pct != null ? pctText(p.within5Pct) : null} note="of the readings shown" />
            <Tile label="Reported at all" value={p?.coveragePct != null ? pctText(p.coveragePct) : null} note="of the video time, not of scored windows. Nothing is shown when the signal is poor" />
            <Tile label="RMS error" value={p?.rmseBpm != null ? one(p.rmseBpm) : null} unit="bpm" />
          </div>
          {p?.note && <p className="sci-note">{p.note}</p>}
          <h4 className="sci-card-h4">The swing the echo uses</h4>
          <p className="sci-card-sub">
            The echo does not use the rate. It uses how far the rate swings with two paced breaths, read by fitting the beats at the breath&apos;s
            own period. Checked against the same oximeter{w?.people != null ? ` on the same ${whole(w.people)} people` : ''}, twenty seconds at a time.
          </p>
          <div className="sci-tiles sci-tiles-2">
            <Tile label="Typical error" value={w?.maeBpm != null ? one(w.maeBpm) : null} unit="bpm" note="mean absolute error of the swing, when one is shown" />
            <Tile
              label="Steady heart called a swing"
              value={w?.stillFalse != null && w.stillWindows != null ? `${whole(w.stillFalse)} of ${whole(w.stillWindows)}` : null}
              note={
                w?.stillFalseOld != null && w.stillWindows != null
                  ? `windows where the oximeter shows almost none. The reading this replaced called ${whole(w.stillFalseOld)} of ${whole(w.stillWindows)}`
                  : 'windows where the oximeter shows almost none'
              }
            />
            <Tile label="Shown at all" value={w?.shownPct != null ? pctText(w.shownPct) : null} note="of the windows. Nothing is shown when the fit is unsure by more than 2 bpm" />
            <Tile label="The reading it replaced" value={w?.oldMaeBpm != null ? one(w.oldMaeBpm) : null} unit="bpm" note="error of highest minus lowest rate, which is what the first version showed" />
          </div>
          <p className="sci-note">
            <b>What this does not show:</b> nobody in these recordings breathes to a pacer. They breathe as they like, so the check is on the part of
            the heart rate that moves at a ten-second period{w?.meanReferenceBpm != null ? ` (${one(w.meanReferenceBpm)} bpm on average here)` : ''}, which slow
            breathing makes large. A known paced swing is so far only simulated
            {w?.known12Bpm != null ? ` (a heart that swings by 12 reads ${one(w.known12Bpm)})` : ''} and synthetic video. No person has yet breathed
            to the pacer beside an oximeter. Still people, good light, uncompressed video.
          </p>
          <p className="sci-note">
            A published benchmark of the same method (POS, <Cite k="wang2017" />) reports 4.00 bpm on UBFC-rPPG (<Cite k="liu2023" />, one
            heart rate per whole video). That is a different test. Ours scores ten-second windows on part of the dataset and leaves out the
            moments when the app showed nothing, so the two numbers do not line up.
          </p>
        </div>
        <div className="sci-card">
          <h3>Smile from the camera</h3>
          <p className="sci-card-sub">{smileMeta.length > 0 ? smileMeta.join(' · ') : 'Stock video clips, six frames each labelled by eye'}</p>
          <div className="sci-tiles sci-tiles-2">
            <Tile label="Smiles caught" value={s?.sensitivityPct != null ? pctText(s.sensitivityPct) : null} note="of frames labelled a clear smile" />
            <Tile label="False alarms" value={s?.falsePositivePct != null ? pctText(s.falsePositivePct) : null} note="of frames labelled neutral" />
            <Tile label="Face found" value={s?.faceFoundPct != null ? pctText(s.faceFoundPct) : null} note="of labelled frames" />
          </div>
          {s?.note && <p className="sci-note">{s.note}</p>}
          <p className="sci-note">
            <b>Not checked:</b> size. This asks whether a smile is found. The echo uses how big the smile is and how long it lasts, and stock
            clips have no reference for that.
            {s?.note && /facing|framing/i.test(s.note) && ' The framing limits in the note were picked on these same clips, so the figure inside them is on the optimistic side.'}
          </p>
        </div>
      </div>
      <Robustness rows={v?.robustness ?? []} />
      <div className="sci-limits">
        <h3>Limits</h3>
        <ul className="sci-list">
          {[...OUR_LIMITS, ...(v?.limits ?? []).filter((l) => !SAID_ALREADY.test(l))].map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </Section>
  )
}

// ---------- detection simulation (detect.json) ----------

const chartOne = (v: number | null) => (v === null ? 'not reached' : `${one(v)} days`)
const chartDelta = (v: number) => (v === 0.25 ? '¼' : v === 0.5 ? '½' : v === 0.75 ? '¾' : v === 1.5 ? '1½' : whole(v))

function DetectionChart({ d }: { d: DetectData | null }) {
  const chart = d?.chart
  if (!chart) {
    return (
      <div className="sci-card sci-detect-empty">
        <Waiting>The simulation is still running. This chart will appear when it is ready.</Waiting>
      </div>
    )
  }
  const rows = [...chart.rows].sort((a, b) => a.delta - b.delta)
  const maxDays = 84
  const left = 48
  const right = 624
  const top = 18
  const bottom = 244
  const x = (delta: number) => left + (delta / 2) * (right - left)
  const y = (days: number | null) => (days === null ? null : bottom - (Math.min(days, maxDays) / maxDays) * (bottom - top))
  const virePoints = rows.map((r) => [x(r.delta), y(r.vire.medianDays)] as const).filter((p): p is readonly [number, number] => p[1] !== null)
  const qPoints = rows.map((r) => [x(r.delta), y(r.questionnaire.medianDays)] as const).filter((p): p is readonly [number, number] => p[1] !== null)
  const path = (points: readonly (readonly [number, number])[]) => points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const minBeat = rows.find((r) => r.vire.medianDays !== null && r.questionnaire.medianDays !== null && r.questionnaire.medianDays - r.vire.medianDays >= 3) ?? null
  const alt = rows
    .map((r) => `${chartDelta(r.delta)} spread: Vire ${chartOne(r.vire.medianDays)}, questionnaire ${chartOne(r.questionnaire.medianDays)}`)
    .join('; ')
  return (
    <div className="sci-detect-grid">
      <div className="sci-card sci-detect-chart-card">
        <div className="sci-chart-head">
          <div>
            <h3>Days to the short list</h3>
            <p className="sci-card-sub">Median days after the slide starts · {d.peoplePerCell ?? 4000} people per cell</p>
          </div>
          <div className="sci-chart-legend" aria-hidden="true">
            <span><i className="sci-chart-key sci-chart-key-vire" /> Vire</span>
            <span><i className="sci-chart-key sci-chart-key-questionnaire" /> weekly questionnaire</span>
          </div>
        </div>
        <svg className="sci-detect-chart" viewBox="0 0 640 330" role="img" aria-label={`Median days from a relapse slide to a flag. ${alt}`}>
          <title>Median days to a flag by effect size</title>
          <desc>{alt}. The Vire line is the real detector; the dashed line is a weekly questionnaire with noise chosen in its favour.</desc>
          {[0, 14, 28, 42, 56, 70, 84].map((tick) => (
            <g key={tick}>
              <line x1={left} x2={right} y1={y(tick)!} y2={y(tick)!} className="sci-chart-gridline" />
              <text x={left - 10} y={y(tick)! + 4} textAnchor="end" className="sci-chart-label">{tick}</text>
            </g>
          ))}
          <line x1={left} x2={right} y1={bottom} y2={bottom} className="sci-chart-axis" />
          {[0, 0.5, 1, 1.5, 2].map((tick) => (
            <g key={tick}>
              <line x1={x(tick)} x2={x(tick)} y1={bottom} y2={bottom + 5} className="sci-chart-axis" />
              <text x={x(tick)} y={bottom + 21} textAnchor="middle" className="sci-chart-label">{tick}</text>
            </g>
          ))}
          <text x={left} y={top - 7} className="sci-chart-axis-label">days</text>
          <text x={right} y={bottom + 46} textAnchor="end" className="sci-chart-axis-label">effect, person-spreads below usual</text>
          {qPoints.length > 1 && <path d={path(qPoints)} className="sci-chart-line sci-chart-line-questionnaire" />}
          {virePoints.length > 1 && <path d={path(virePoints)} className="sci-chart-line sci-chart-line-vire" />}
          {rows.map((r) => {
            const vy = y(r.vire.medianDays)
            const qy = y(r.questionnaire.medianDays)
            return (
              <g key={r.delta}>
                {vy !== null && <circle cx={x(r.delta)} cy={vy} r="4.5" className="sci-chart-point sci-chart-point-vire" />}
                {qy !== null && <circle cx={x(r.delta)} cy={qy} r="4" className="sci-chart-point sci-chart-point-questionnaire" />}
              </g>
            )
          })}
        </svg>
        <p className="sci-chart-alt"><b>Text view.</b> {alt}.</p>
      </div>
      <div className="sci-card sci-detect-cost">
        <h3>What the clinic pays for</h3>
        <div className="sci-tiles sci-tiles-2">
          <Tile label="Vire short-list episodes" value={one(chart.falseFlags.episodesPerPersonYear)} unit="per person-year" note={`at ${one(chart.adherence * 100)}% daily adherence`} />
          <Tile label="People ever flagged" value={pctText(chart.falseFlags.everFlagged12WeeksPct)} note="in 12 weeks with no relapse" />
        </div>
        <p className="sci-note">The chart uses the “dipping or low” list, no wobble, and all four channels. An episode is counted once when someone enters the list.</p>
        <p className="sci-note">{minBeat ? `At ${chartDelta(minBeat.delta)} spread, Vire is ${one(minBeat.questionnaire.medianDays! - minBeat.vire.medianDays!)} days earlier in this simulation.` : 'No tested effect reaches a three-day lead over the questionnaire.'}</p>
      </div>
    </div>
  )
}

function Detection({ data }: { data: DetectData | null }) {
  const chart = data?.chart
  return (
    <Section
      id="detect"
      title="If the echo does fade, how early would the clinic know?"
      intro="A simulation answers the next research question: what the current rule would do if a relapse moved the echo by a known amount."
    >
      <DetectionChart d={data} />
      {chart && (
        <div className="sci-detect-copy">
          <p>
            We ran Vire&apos;s real baseline, z-score, EWMA and status functions on {data?.peoplePerCell ?? 4000} made-up people for 84 home days. Their channels had measured missingness, day-to-day noise, and a separate slow wobble; the relapse slide took 14 days and then stayed.
          </p>
          <p>
            At a planning bar of under one false episode per person-year, no tested effect beats the generous weekly questionnaire by three days. At {(() => { const r = chart.rows.find((row) => row.questionnaire.medianDays !== null && row.vire.medianDays !== null && row.questionnaire.medianDays - row.vire.medianDays >= 3); return r ? `${chartDelta(r.delta)} person-spreads` : 'the smallest tested effect' })()}, Vire is {(() => { const r = chart.rows.find((row) => row.questionnaire.medianDays !== null && row.vire.medianDays !== null && row.questionnaire.medianDays - row.vire.medianDays >= 3); return r ? `${one(r.questionnaire.medianDays! - r.vire.medianDays!)} days earlier` : 'not earlier' })()} but costs {one(chart.falseFlags.episodesPerPersonYear)} false episodes per person-year.
          </p>
          <p>Nobody knows the real effect size. The pilot below measures whether the echo follows a person&apos;s PHQ-9 before anyone treats this picture as a forecast.</p>
          <p>It would be wrong if a fading laugh, a change in sleep or medicines, missing pings, or a wobble shared by all channels looked like relapse; those are not separated here.</p>
        </div>
      )}
    </Section>
  )
}

// ---------- the hall (GET /api/wall) ----------

function HallBlock({ hall }: { hall: Hall | null }) {
  const pings = hall?.pings ?? null
  const live = hall !== null && (pings ?? 0) > 0
  const stamp = when(hall?.generatedAt ?? null)
  // a spread over fewer than five people says nothing, so those rows stay out
  const again = CHANNELS.flatMap((c) => {
    const d = live ? (hall?.change[c] ?? null) : null
    return d && d.n >= 5 ? [{ c, d }] : []
  })
  return (
    <Section
      id="hall"
      title="From the hall"
      intro={
        <>
          Anyone at Junction can scan the wall and ping. A loud, dim hall is a hard place for a phone, so the number that counts here is how often
          each channel could be read at all.
        </>
      }
    >
      <p className="sci-status">
        {live ? (
          <>
            <i className="sci-ok-dot" aria-hidden="true" />
            Live{stamp ? `, updated ${stamp}` : ''}
            {hall?.simulated && <span className="sci-tag">simulated</span>}
          </>
        ) : (
          <Waiting>{hall ? 'The wall is open. Nobody has pinged yet.' : 'The wall is not open yet. Read rates show up here with the first pings.'}</Waiting>
        )}
      </p>
      <div className="sci-hall">
        <div className="sci-tiles sci-tiles-3">
          <Tile label="People" value={hall?.visitors != null ? whole(hall.visitors) : null} pending="waiting" note="with a finished ping" />
          <Tile label="Pings" value={pings != null ? whole(pings) : null} pending="waiting" />
          <Tile
            label="Came back"
            value={hall?.returning != null ? whole(hall.returning) : null}
            pending="waiting"
            note={hall?.minGapH != null ? `pinged again ${one(hall.minGapH)}+ hours later` : 'pinged again hours later'}
          />
        </div>
        <div className="sci-card sci-rates">
          <h3>Read rate by channel</h3>
          <p className="sci-card-sub">Share of pings where the phone got a usable reading</p>
          <ul className="sci-rate-list">
            {CHANNELS.map((c) => {
              const r = live ? (hall?.rates[c] ?? null) : null
              const tip =
                r === null
                  ? `${CHANNEL_NAME[c]}: no reading yet`
                  : `${CHANNEL_NAME[c]}: readable in ${pctText(r * 100)}${pings != null ? ` of ${whole(pings)} pings` : ' of pings'}`
              return (
                <li key={c} className="sci-rate" tabIndex={0} data-tip={tip} aria-label={tip}>
                  <span className="sci-rate-name">
                    <i className="sci-swatch" style={{ background: `var(--ch-${c})` }} aria-hidden="true" />
                    {CHANNEL_NAME[c]}
                  </span>
                  <span className="sci-rate-track" style={{ background: `color-mix(in srgb, var(--ch-${c}) 16%, var(--card))` }} aria-hidden="true">
                    {r !== null && <span className="sci-rate-fill" style={{ width: `${Math.max(r * 100, 1.5)}%`, background: `var(--ch-${c})` }} />}
                  </span>
                  <span className="sci-rate-num">{r === null ? <span className="sci-notrun">waiting</span> : pctText(r * 100)}</span>
                </li>
              )
            })}
          </ul>
          {live && hall && hall.devices.length > 0 && (
            <div className="sci-table-scroll">
              <table className="sci-table sci-table-tight">
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">Pings</th>
                    {CHANNELS.map((c) => (
                      <th scope="col" key={c}>
                        {CHANNEL_NAME[c]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hall.devices.slice(0, 6).map((d, i) => (
                    <tr key={`${d.label}-${i}`}>
                      <th scope="row">{d.label}</th>
                      <td>{d.pings != null ? whole(d.pings) : <span className="sci-notrun">none</span>}</td>
                      {CHANNELS.map((c) => (
                        <td key={c}>{d.rates[c] != null ? pctText(d.rates[c] * 100) : <span className="sci-notrun">none</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="sci-card sci-rates sci-again">
        <h3>Same person, hours apart</h3>
        <p className="sci-card-sub">
          How far each reading moved between a person&apos;s first and last ping. It is our only look at repeatability so far.
        </p>
        {again.length > 0 ? (
          <div className="sci-table-scroll">
            <table className="sci-table sci-table-tight">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">People</th>
                  <th scope="col">Typical change</th>
                  <th scope="col">Middle half</th>
                </tr>
              </thead>
              <tbody>
                {again.map(({ c, d }) => (
                  <tr key={c}>
                    <th scope="row">{CHANNEL_NAME[c]}</th>
                    <td>{whole(d.n)}</td>
                    <td>
                      {signed(d.median)}
                      {d.unit ? ` ${d.unit}` : ''}
                    </td>
                    <td>{d.q1 !== null && d.q3 !== null ? `${signed(d.q1)} to ${signed(d.q3)}` : <span className="sci-notrun">too few</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sci-note">
            <span className="sci-notrun">Waiting for five people to come back.</span>
          </p>
        )}
        <p className="sci-note">
          A change here mixes sensor noise with a real change in the person and in the light. We have not measured the two apart.
        </p>
      </div>
      <p className="sci-plain">
        These are hackers at a hackathon. A read rate says how often a phone got a reading in this hall. If their numbers sink by Sunday, a
        weekend with little sleep is the first thing we would suspect. None of it says anything about depression.
      </p>
    </Section>
  )
}

// ---------- the page ----------

export default function Science() {
  const [validation, setValidation] = useState<Validation | null>(null)
  const [hall, setHall] = useState<Hall | null>(null)
  const [detect, setDetect] = useState<DetectData | null>(null)
  const [daily, setDaily] = useState<DailyStatus | null>(null)

  useEffect(() => {
    let alive = true
    const pullValidation = () => void loadValidation().then((v) => alive && setValidation(v))
    const pullHall = () => void loadHall().then((h) => alive && setHall(h))
    const pullDetect = () => void loadDetect().then((d) => alive && setDetect(d))
    pullValidation()
    pullHall()
    pullDetect()
    const pullDaily = () => void fetch(apiUrl('daily')).then((r) => r.ok ? r.json() as Promise<DailyStatus> : null).then((v) => alive && setDaily(v))
    pullDaily()
    const a = window.setInterval(pullValidation, 60_000)
    const b = window.setInterval(pullHall, 30_000)
    const c = window.setInterval(pullDaily, 60_000)
    return () => {
      alive = false
      window.clearInterval(a)
      window.clearInterval(b)
      window.clearInterval(c)
    }
  }, [])

  useEffect(() => {
    const before = document.title
    document.title = 'Vire: the evidence'
    return () => {
      document.title = before
    }
  }, [])

  return (
    <div className="sci">
      <nav className="sci-nav" aria-label="Sections">
        <div className="sci-nav-in">
          <a className="sci-brand" href="#/">
            Vire
          </a>
          <div className="sci-chips">
            {NAV.map((n) => (
              <button key={n.id} type="button" className="sci-chip" onClick={() => go(n.id)}>
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="sci-wrap">
        <header className="sci-hero">
          <h1>What Vire rests on.</h1>
          <p className="sci-lead">
            After TMS, Vire follows your day through your AirPods against your own usual, answers a drift with a short practice, and shows your
            clinic what did not help. This page is the research under that, and what nobody knows yet. Much of it was written for the
            one-minute camera check, the version for people without AirPods: four small things for your body to answer, once a day.
          </p>
          <ul className="sci-facts">
            <li>
              <b>Camera pulse</b>
              {validation?.pulse?.maeBpm != null
                ? `${one(validation.pulse.maeBpm)} bpm off a finger oximeter${validation.pulse.coveragePct != null ? `, when it shows a number (${pctText(validation.pulse.coveragePct)} of the time)` : ''}`
                : 'being checked against a finger oximeter'}
            </li>
            <li>
              <b>Clear smiles found</b>
              {validation?.smile?.sensitivityPct != null
                ? `${pctText(validation.smile.sensitivityPct)} on public clips${validation.smile.falsePositivePct != null ? `, and ${pctText(validation.smile.falsePositivePct)} of neutral faces called a smile` : ''}`
                : 'being checked on public clips'}
            </li>
            <li>
              <b>Face model</b>trains on your own face in 44 ms
            </li>
            <li>
              <b>Patients</b>none yet
            </li>
            <li>
              <b>Link to depression</b>from published studies, untested by us
            </li>
          </ul>
        </header>
        {daily && (
          <section className="sci-daily" aria-label="Today's generated audio">
            <b>Made today by ElevenLabs</b>
            <span>Laugh {daily.laugh.generatedAt ? when(daily.laugh.generatedAt) ?? 'today' : 'shipped clip'}{daily.laugh.seconds != null ? ` · ${one(daily.laugh.seconds)} s` : ''}</span>
            <span>Question {daily.questionAudio.generatedAt ? when(daily.questionAudio.generatedAt) ?? 'today' : 'shipped clip'}{daily.questionAudio.seconds != null ? ` · ${one(daily.questionAudio.seconds)} s` : ''} · “{daily.question}”</span>
          </section>
        )}

        <Section id="problem" title="About half lose the response within a year">
          <div className="sci-tiles sci-tiles-3 sci-tiles-big">
            <Tile
              label="One TMS course"
              value="20 to 30"
              unit="sessions"
              note={
                <>
                  Daily clinic visits for 4 to 6 weeks. Then you go home. <Cite k="perera2016" />
                </>
              }
            />
            <Tile
              label="Still responding a year later"
              value="46.3%"
              note={
                <>
                  Of those who responded. 66.5% at 3 months, 52.9% at 6. A meta-analysis of 19 studies; the one-year figure rests on 9 of them,
                  247 patients, 95% CI 32.6 to 60.7%. <Cite k="senova2019" />
                </>
              }
            />
            <Tile
              label="Got it back with more TMS"
              value="32 of 38"
              note={
                <>
                  99 patients were followed for 24 weeks, all on an antidepressant. 38 got worse, and 32 of them regained the benefit when TMS was
                  added back. Open label, no control group. <Cite k="janicak2010" />
                </>
              }
            />
          </div>
          <p className="sci-plain">
            So going back seems to help. Whether everyone should get scheduled top-ups is unsettled: across studies, maintenance treatment went
            with a more durable response (<Cite k="senova2019" />
            ), but in a 49-patient pilot, all off antidepressants, one TMS session a month was not shown to do better than watching and
            re-treating (<Cite k="philip2016" />
            ). A 2026 study protocol notes that &ldquo;there are no validated markers of relapse&rdquo; (<Cite k="dine2026" />
            ). The open question is who to bring back, and when.
          </p>
          <p className="sci-plain">
            In the 99-patient study a clinician&apos;s rating, worse two weeks running, caught the 38. A questionnaire like the PHQ-9 can catch it
            too, if someone sends it and it gets filled in, and it takes less of a week than seven pings. What Vire would add is a reading that
            does not depend on how people rate themselves, though it still takes effort.
          </p>
        </Section>

        <Section id="loop" title="The loop">
          <div className="sci-loop-grid">
            <Loop />
            <div>
              <ol className="sci-steps">
                <li>
                  <b>Ping.</b> Sixty seconds. You nod, a laugh plays, you say one line, you take two slow breaths.
                </li>
                <li>
                  <b>Echo.</b> Four numbers, each against your own baseline, and their average. 50 is your usual.
                </li>
                <li>
                  <b>Dose.</b> One to three minutes through the earbuds: slow breathing with your heartbeat on screen, a forest you look around in, a
                  walk to a beat, a voice note to a friend.
                </li>
                <li>
                  <b>Learn.</b> A short ping after the dose. Over days the app keeps count of which dose is followed by a higher echo.
                </li>
                <li>
                  <b>Clinic.</b> Pings from the last two weeks of the TMS course set your well signature, and it stays fixed. Drift away from it
                  puts you on the clinic&apos;s short list, and so does going quiet for days. The clinic can ask you in for a booster.
                </li>
              </ol>
              <p className="sci-plain">
                Vire and the clinic get numbers. No video, no sound. The voice note is recorded on the phone and sent by you, to whoever you pick.
              </p>
              <div className="sci-aside">
                <h3>Why poke instead of just watching</h3>
                <p>
                  Across 19 lab studies, people with depression reacted less to positive stimuli than healthy people did (d = -0.53,{' '}
                  <Cite k="bylsma2008" />
                  ). That is one group against another, not one person followed over time. A reaction only shows when the body is given
                  something to react to, so Vire prompts. The passive route, a smart ring worn after TMS, is about
                  to be piloted elsewhere (<Cite k="dine2026" />
                  ). If watching turns out to be enough, that is the simpler answer.
                </p>
              </div>
              <p className="sci-fine">
                The maths: each channel is a z-score against a fixed baseline, the median and MAD of the person&apos;s clinic pings from the last two weeks
                of the course (or their first seven at home). Each is shown as 50 + 15z, kept between 0 and 100, and the echo is the mean over the
                channels that could be read, so what goes into it can differ from one day to the next. Drift is an exponentially weighted mean of the daily mean z (α = 0.3, about a week of memory). Drift
                below -0.75 is &ldquo;dipping&rdquo;; below -1.5 three days running is &ldquo;low&rdquo;. We picked those cut-offs by hand. Doses
                are picked by Thompson sampling, per person.
              </p>
            </div>
          </div>
        </Section>

        <Section id="channels" title="Four channels" intro="One prompt, one number and one study each.">
          <div className="sci-channels">
            {CARDS.map((c) => (
              <article className="sci-card sci-channel" key={c.channel}>
                <header>
                  <i className="sci-swatch sci-swatch-big" style={{ background: `var(--ch-${c.channel})` }} aria-hidden="true" />
                  <h3>{CHANNEL_NAME[c.channel]}</h3>
                </header>
                <p className="sci-measure">{c.measure}</p>
                <div className="sci-figure">
                  <span className="sci-figure-value">{c.figure}</span>
                  <span className="sci-figure-label">{c.figureLabel}</span>
                </div>
                <p className="sci-study">{c.study}</p>
                {c.also && <p className="sci-study sci-also">{c.also}</p>}
                <p className="sci-caveat">
                  <b>Careful:</b> {c.caveat}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <Sensors v={validation} />

        <HallBlock hall={hall} />

        <Section
          id="model"
          title="Why the model is personal"
          intro="In one earbud study, a motion sensor read a face far better with a model trained on its owner."
        >
          <div className="sci-two">
            <div>
              <div className="sci-tiles sci-tiles-2 sci-tiles-big">
                <Tile label="Trained on that person" value="89.9%" note="32 facial action units, 12 people" />
                <Tile label="One model for everyone" value="42.1%" note="same study, same task" />
              </div>
              <p className="sci-note">
                ExpressEar (<Cite k="verma2021" />
                ). The second figure is as reported in a review (<Cite k="roddiger2022" />
                ); we could not open the full paper.
              </p>
              <p className="sci-note">
                An in-ear motion sensor told smile from frown with F1 0.85, in a controlled setting and not in conversation (<Cite k="lee2019" />
                ).
              </p>
            </div>
            <div className="sci-card">
              <h3>What Vire does with that</h3>
              <ul className="sci-list">
                <li>
                  The studies here are about earbuds. Vire&apos;s personal model reads the camera, and we have not run the same comparison for it.
                </li>
                <li>Tune: two faces in about 15 seconds, with three more optional later for the muscle map. That gives your own range for the movements we use.</li>
                <li>From then on every reading is a share of your own range.</li>
                <li>
                  In our test the model trained in the browser in 44 ms and takes 3 KB. It told a person&apos;s faces apart on second takes it had
                  not seen 96 to 100% of the time. That is two people, from video clips played into the camera, and three or four of the five
                  faces each. Clips are easier than a live face.
                </li>
                <li>
                  An experiment, with AirPods in: during Tune the camera&apos;s smile reading trains a small model on the AirPods&apos; motion
                  alone. It is scored on parts of the recording it has not seen and switched off when it is no better than chance. The echo does
                  not use it.
                </li>
              </ul>
              <h3 className="sci-h3-gap">What the AirPods give an app</h3>
              <ul className="sci-list">
                <li>
                  Head motion (<Cite k="appleMotion" />
                  ).
                </li>
                <li>
                  Heart rate from AirPods Pro 3, in beats per minute, while a workout session runs (<Cite k="appleSupport" />, <Cite k="appleWorkout" />
                  ). The sensor pulses infrared light 256 times a second (<Cite k="appleNews" />
                  ).
                </li>
                <li>No beat-to-beat timing that we could find documented. That is why the heart channel is a swing in bpm.</li>
                <li>In Vire both come through the iPhone app, not the browser. We have not checked either against a reference.</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="limits" title="What Vire does not claim">
          <ul className="sci-nots">
            <li>It does not detect or diagnose depression.</li>
            <li>
              It does not read emotions. It measures muscle movement against your own range. &ldquo;Sad&rdquo; and &ldquo;angry&rdquo; are faces we
              ask for to find that range.
            </li>
            <li>No patient has used it.</li>
            <li>
              A fading echo is not a relapse, and nobody has shown that it comes before one. Today it is only a reason for the clinic to call.
            </li>
            <li>It is not shown to beat a questionnaire. The pilot below uses the PHQ-9 as the yardstick.</li>
            <li>
              A dose is not a treatment. The evidence for breathing with heart feedback (<Cite k="pizzoli2021" />) and for walking (
              <Cite k="noetel2024" />) comes from whole programmes. For nature sound it is about stress (<Cite k="buxton2021" />
              ).
            </li>
            <li>
              The app does not know which dose works. It offers more of whatever was followed by a higher echo, but after a low day the next
              reading tends to be higher anyway, dose or no dose. Without a control it may be rewarding chance.
            </li>
            <li>
              The laugh is only a probe. A 19-country test of posed smiles with 3,878 people found a small lift in happiness: about 5% of the scale
              (<Cite k="coles2022" />
              ).
            </li>
            <li>
              The echo may also move with sleep, caffeine, medicines and a bad day. We have not measured what any of them does to a channel. The
              baseline is personal and the drift is smoothed over about a week, but only a pilot can show that it follows symptoms and not
              tiredness.
            </li>
            <li>
              The baseline today comes from pings in the clinic, so going home could look like drift by itself.
            </li>
            <li>
              We do not know if the laugh still lands on day 30, or the nod, or the spoken line. If they wear off, a falling echo is boredom.
            </li>
            <li>
              It is not a safety net. It cannot see a crisis, and the app does not carry a clinic&apos;s crisis number yet. It must before any patient
              uses it.
            </li>
            <li>It is not a medical device. It is a research prototype built over a weekend.</li>
          </ul>
        </Section>

        <Detection data={detect} />

        <Section
          id="pilot"
          title="A pilot a TMS lab could run"
          intro={
            <>
              TMS-EEG sends a magnetic pulse and reads what the brain sends back. Aalto&apos;s group has automated that in the lab, with the EEG
              response steering the direction of the next pulse (<Cite k="tervo2022" />, six healthy volunteers). Across 30 patients, a smaller early prefrontal
              response (10 to 30 ms) went with a higher PHQ-9 (ρ = -0.43, <Cite k="ukharova2026" />
              ). Vire borrows the first half and nothing else: send something, read what comes back. A laugh in place of a pulse, read in seconds,
              is a far cruder probe, and nothing in Vire steers itself the way that loop does. Nobody has tested whether the two responses move
              together. We have no connection to the group; we read the papers.
            </>
          }
        >
          <p className="sci-plain">The app already collects the PHQ-2 weekly, so whether a person&apos;s echo moves with their score can be read from the first clinic&apos;s data.</p>
          <dl className="sci-protocol">
            <div>
              <dt>Who</dt>
              <dd>
                20 adults starting a standard daily TMS course for depression, with their own iPhone. Accelerated courses are left out: the
                baseline below needs two weeks. Twenty people can say whether this deserves a real study. They cannot prove it.
              </dd>
            </div>
            <div>
              <dt>How long</dt>
              <dd>
                The course, then 12 weeks at home. By 3 months about a third of responders have lost the response (<Cite k="senova2019" />
                ), so the people who slip in this pilot will be a handful, and the result leans on them.
              </dd>
            </div>
            <div>
              <dt>In the clinic</dt>
              <dd>
                A ping before and after each session. PHQ-9 every week from the first session. MADRS at start, at the end and at weeks 6 and 12
                after. Medicines and doses at the start. TMS-EEG at start and end where the lab already records it. Heart rate during
                stimulation.
              </dd>
            </div>
            <div>
              <dt>At home</dt>
              <dd>
                One ping a day from the last two weeks of the course onward, at an hour the person picks and keeps, in the best light the room
                has. PHQ-9 every week, and with it any change in medicines. Doses switched off, so they cannot move what is being measured.
              </dd>
            </div>
            <div>
              <dt>Baseline</dt>
              <dd>
                The well signature: each person&apos;s home pings from the last two weeks of the course, fixed before the home phase. It only
                means &ldquo;well&rdquo; for people who responded by the end of the course. Late responders and non-responders are analysed
                apart.
              </dd>
            </div>
            <div>
              <dt>Primary endpoint</dt>
              <dd>
                One score, fixed in advance: the mean of the smile, voice and move z-scores, from pings where all three could be read. Voice
                here is pauses and speaking rate, which held up in a second study. The pitch number in today&apos;s echo did not, and is
                reported apart. Heart stays out of it, for the reasons on its card and because a dim room may give no pulse at all. In the home weeks, does a person&apos;s weekly mean
                score move with their own PHQ-9 that week? Repeated-measures correlation. A slow slide into relapse is a trend, so the trend
                stays in.
              </dd>
            </div>
            <div>
              <dt>Also</dt>
              <dd>
                <ul className="sci-list">
                  <li>
                    Wear-off: in people whose PHQ-9 stays flat, does the score fall anyway? The main result is also shown with each person&apos;s
                    straight-line trend taken out.
                  </li>
                  <li>
                    Missing weeks. A week with fewer than three pings counts as missing and is set against that week&apos;s PHQ-9: the people
                    who stop may be the ones getting worse.
                  </li>
                  <li>Whether this week&apos;s score says anything about next week&apos;s PHQ-9 beyond this week&apos;s PHQ-9.</li>
                  <li>Each channel on its own, heart included, and how much it varies from day to day in stable weeks.</li>
                  <li>The course weeks, apart from the home weeks. During the course people are being stimulated and are changing.</li>
                  <li>
                    Where the lab records TMS-EEG anyway, the early response is kept next to the score, and heart slowing during stimulation
                    next to the heart channel, only to size a later study: in one study of 17 healthy people the test-retest
                    concordance of prefrontal responses was 0.40 on average, 0.30 to 0.57 depending on how the target was chosen (
                    <Cite k="sayali2026" />
                    ).
                  </li>
                </ul>
              </dd>
            </div>
            <div>
              <dt>Blinding and safety</dt>
              <dd>
                The clinic does not see the echo during the pilot and treats as usual. Patients see that a ping was recorded, without the score. A
                named clinician reads every PHQ-9 the day it comes in and follows the clinic&apos;s own protocol on any sign of risk. The app shows
                the clinic&apos;s crisis number.
              </dd>
            </div>
            <div>
              <dt>It failed if</dt>
              <dd>
                Fewer than half still ping four days a week at week 8. Or the correlation with PHQ-9 comes out weaker than -0.3, a bar we set by
                hand: under it the score accounts for less than a tenth of a person&apos;s week-to-week change. Or the score falls just as much in
                people whose PHQ-9 stays flat. A channel as noisy from day to day as its change over the course gets dropped.
              </dd>
            </div>
            <div>
              <dt>Not in this pilot</dt>
              <dd>
                Predicting relapse. If the score follows symptoms, that is the next study. This one needs ethics
                approval and consent like any other; Vire stores numbers only.
              </dd>
            </div>
          </dl>
        </Section>

        <Section
          id="sources"
          title="References"
          intro="Each one opened on 13 November 2026: the full text where it is open, the abstract where it is not. Where a figure is second-hand, the page says so."
        >
          <ol className="sci-refs">
            {REF_KEYS.map((k) => {
              const r = REFS[k]
              return (
                <li key={k}>
                  {r.full}{' '}
                  <a className="sci-cite" href={r.href} target="_blank" rel="noreferrer">
                    {'doi' in r && r.doi ? `doi:${r.doi}` : r.href.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                </li>
              )
            })}
          </ol>
        </Section>

        <footer className="sci-foot">
          <span>Vire. Built at Junction 2026, Espoo.</span>
          <a className="sci-cite" href="#/">
            Open the app
          </a>
        </footer>
      </main>
    </div>
  )
}
