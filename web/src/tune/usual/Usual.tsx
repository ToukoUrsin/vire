import type { EarRecording } from '@shared/ear'
import { earMeasures, type EarDay } from './measures'
import { usualRows, type UsualRow } from './usual'
import './usual.css'

interface UsualProps {
  days: EarDay[]
  big?: boolean
  demo?: boolean
  /** 'clinic': the words for someone looking at another person's minute, in the dark one-line look of the big screen */
  who?: 'you' | 'clinic'
  /** inside another page: no card of its own */
  inline?: boolean
}

const formatNumber = (value: number, key: UsualRow['key']): string => {
  if (key === 'smiles') return String(Math.round(value))
  if (key === 'nodHz' || key === 'shakeHz') return value < 10 ? value.toFixed(1) : value.toFixed(0)
  return value < 10 ? value.toFixed(1) : value.toFixed(0)
}

const valueText = (value: number | null, row: UsualRow): string =>
  value === null ? 'No reading' : row.of ? `${formatNumber(value, row.key)} of ${row.of}` : `${formatNumber(value, row.key)} ${row.unit}`

function position(value: number, low: number, high: number): number {
  if (high <= low) return 50
  return Math.max(2, Math.min(98, ((value - low) / (high - low)) * 100))
}

function Track({ row }: { row: UsualRow }) {
  const hasBand = row.lo !== null && row.hi !== null
  // the scale holds every minute, today, and the whole band: a band wider than the minutes is not cut off
  const values = [...row.earlier, ...(row.today === null ? [] : [row.today]), ...(hasBand ? [row.lo!, row.hi!] : [])]
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 1
  const span = Math.max(1e-6, maximum - minimum)
  const low = minimum - span * 0.12
  const high = maximum + span * 0.12
  return (
    <div className="us-track" aria-hidden="true">
      <div className="us-track-line" />
      {hasBand && (
        <div
          className="us-band"
          style={{ left: `${position(row.lo!, low, high)}%`, width: `${Math.max(2, position(row.hi!, low, high) - position(row.lo!, low, high))}%` }}
        />
      )}
      {hasBand && row.mid !== null && <div className="us-mid" style={{ left: `${position(row.mid, low, high)}%` }} />}
      {row.earlier.map((value, index) => <i className="us-tick" key={`${value}-${index}`} style={{ left: `${position(value, low, high)}%` }} />)}
      {row.today !== null && <b className="us-today" style={{ left: `${position(row.today, low, high)}%` }} />}
    </div>
  )
}

function UsualRowView({ row, whose }: { row: UsualRow; whose: string }) {
  const status = row.where === 'no usual yet' ? 'no usual yet' : `${row.where} ${whose} usual`
  return (
    <div className="us-row" data-where={row.where}>
      <div className="us-row-head">
        <span className="us-name">{row.name}</span>
        <strong>{valueText(row.today, row)}</strong>
      </div>
      <div className="us-row-track"><Track row={row} /><span className="us-status">{status}</span></div>
    </div>
  )
}

function UsualView({ days, big, demo = false, who = 'you', inline }: UsualProps) {
  const rows = usualRows(days)
  const earlierCount = Math.max(0, days.length - 1)
  const clinic = who === 'clinic'
  const whose = clinic ? 'their' : 'your'
  const band = clinic
    ? earlierCount >= 2
      ? `The band is their own ${earlierCount} earlier minutes.`
      : `Their usual shows from the third minute (${days.length} so far).`
    : earlierCount >= 2
      ? `The band is your own earlier minutes (${earlierCount} of them).`
      : `The band of your usual comes with the third minute (${days.length} so far).`
  return (
    <section className={`us-shell${big ? ' us-big' : ''}${clinic ? ' us-stage' : ''}${inline ? ' us-inline' : ''}`} data-usual={days.length} data-band={earlierCount >= 2 ? '1' : '0'}>
      <header className="us-head">
        <h1>Today against {whose} usual</h1>
        <p>From the AirPods alone. {band}</p>
        {demo && <span className="us-demo">Demo signals</span>}
      </header>
      <div className="us-list">
        {rows.map((row) => <UsualRowView key={row.key} row={row} whose={whose} />)}
      </div>
    </section>
  )
}

export function Usual(props: UsualProps) {
  return <UsualView {...props} />
}

export function UsualFromMinutes({ minutes, big, inline }: { minutes: EarRecording[]; big?: boolean; inline?: boolean }) {
  const sorted = (Array.isArray(minutes) ? minutes : []).slice().sort((a, b) => String(a?.at ?? '').localeCompare(String(b?.at ?? '')))
  const sim = sorted.filter((minute) => minute?.device?.shell === 'sim')
  const usable = sim.length === sorted.length ? sorted : sorted.filter((minute) => minute?.device?.shell !== 'sim')
  return <UsualView days={usable.map(earMeasures)} big={big} inline={inline} demo={sorted.length > 0 && sim.length === sorted.length} />
}
