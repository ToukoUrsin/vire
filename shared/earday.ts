// What one teaching minute looks like from the AirPods alone, as a handful of plain numbers: how many of the
// asked smiles shifted the earbuds, how far, how fast and how wide the nods and head shakes were, how much the
// head moved. No camera is read here. The phone shows these against the person's own earlier minutes, and the
// server works them out from the stored minutes for the clinic's screen, so both read the same numbers.
import type { EarRecording, EarStep } from './ear'

export interface EarDay {
  at: string
  smiles: number
  asked: number
  smileDeg: number | null
  nodHz: number | null
  nodDeg: number | null
  shakeHz: number | null
  shakeDeg: number | null
  moveDegS: number
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** yaw without the jump at ±180 */
function unwrapYaw(rows: number[][]): number[] {
  if (!rows.length) return []
  const out = [rows[0][2]]
  for (let i = 1; i < rows.length; i++) {
    let d = rows[i][2] - rows[i - 1][2]
    while (d > 180) d -= 360
    while (d < -180) d += 360
    out.push(out[i - 1] + d)
  }
  return out
}

const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

interface AngleRow {
  t: number
  pitch: number
  yaw: number
  roll: number
}

function angleRows(rec: EarRecording): AngleRow[] {
  const source = Array.isArray(rec?.head) ? rec.head : []
  const rows = source
    .filter((row) => Array.isArray(row) && finite(row[0]) && finite(row[1]) && finite(row[2]) && finite(row[3]))
    .map((row) => row.slice())
    .sort((a, b) => a[0] - b[0])
  if (!rows.length) return []
  const yaw = unwrapYaw(rows)
  return rows.map((row, index) => ({ t: row[0], pitch: row[1], yaw: yaw[index], roll: row[3] }))
}

function meanAngles(rows: AngleRow[], t0: number, t1: number): [number, number, number] | null {
  const selected = rows.filter((row) => row.t >= t0 && row.t <= t1)
  if (!selected.length) return null
  return [
    selected.reduce((sum, row) => sum + row.pitch, 0) / selected.length,
    selected.reduce((sum, row) => sum + row.yaw, 0) / selected.length,
    selected.reduce((sum, row) => sum + row.roll, 0) / selected.length,
  ]
}

/**
 * How far the earbuds turned and tilted (yaw and roll) from just before the step to its middle. Pitch is left
 * out: a smile often comes with a small dip of the head, and that is the head moving, not the earbud in the ear.
 */
function shiftForStep(rows: AngleRow[], step: EarStep): number | null {
  const duration = Math.max(1, step.t1 - step.t0)
  // The center of a smile is the part after the initial movement settles and before its final release.
  const middle = meanAngles(rows, step.t0 + Math.min(600, duration * 0.3), step.t1 - Math.min(250, duration * 0.1))
  const before = meanAngles(rows, step.t0 - 800, step.t0 - 1)
  if (!middle || !before) return null
  return Math.hypot(middle[1] - before[1], middle[2] - before[2])
}

/**
 * The same measure where nothing was asked: how far the earbuds drift inside a still step, once what came
 * before it (a smile letting go, the last nod) has settled. A smile counts when the earbuds shift at least three
 * times the usual drift of a still step (the middle one: a smile let go late must not hide the others).
 */
function driftInStep(rows: AngleRow[], step: EarStep): number | null {
  const duration = step.t1 - step.t0
  if (!(duration >= 1200)) return null
  const first = meanAngles(rows, step.t0 + duration * 0.3, step.t0 + duration * 0.6)
  const second = meanAngles(rows, step.t0 + duration * 0.65, step.t0 + duration * 0.95)
  if (!first || !second) return null
  return Math.hypot(second[1] - first[1], second[2] - first[2])
}

function detrended(values: number[]): number[] {
  if (values.length < 2) return values.slice()
  const n = values.length
  const xMean = (n - 1) / 2
  const yMean = values.reduce((sum, value) => sum + value, 0) / n
  let xx = 0
  let xy = 0
  for (let i = 0; i < n; i++) {
    const x = i - xMean
    xx += x * x
    xy += x * (values[i] - yMean)
  }
  const slope = xx ? xy / xx : 0
  return values.map((value, i) => value - (yMean + slope * (i - xMean)))
}

interface SwingStats {
  hz: number
  deg: number
}

function swingsInStep(rows: AngleRow[], step: EarStep, key: 'pitch' | 'yaw'): SwingStats | null {
  const selected = rows.filter((row) => row.t >= step.t0 && row.t <= step.t1)
  if (selected.length < 8) return null
  const times = selected.map((row) => row.t)
  const values = detrended(selected.map((row) => row[key]))
  const sorted = values.slice().sort((a, b) => a - b)
  const low = sorted[Math.floor((sorted.length - 1) * 0.05)]
  const high = sorted[Math.floor((sorted.length - 1) * 0.95)]
  const deg = high - low
  if (!(deg >= 2)) return null

  // Count crossings with a small hysteresis so sensor noise around zero is not a swing.
  const gate = Math.max(0.45, deg * 0.08)
  let side = 0
  let crossings = 0
  for (const value of values) {
    if (side <= 0 && value >= gate) {
      if (side < 0) crossings++
      side = 1
    } else if (side >= 0 && value <= -gate) {
      if (side > 0) crossings++
      side = -1
    }
  }
  const seconds = Math.max(0.05, (times[times.length - 1] - times[0]) / 1000)
  return { hz: crossings / 2 / seconds, deg }
}

/** how fast the head turns, typically: degrees a second, from the gyro when the AirPods send it, else from the angles */
function motionMedian(rec: EarRecording, rows: AngleRow[]): number {
  if (rows.length < 2) return 0
  const source = (Array.isArray(rec?.head) ? rec.head : [])
    .filter((row) => Array.isArray(row) && finite(row[0]) && finite(row[1]) && finite(row[2]) && finite(row[3]))
    .map((row) => row.slice())
    .sort((a, b) => a[0] - b[0])
  const gyro = !!rec.device?.gyro
  const rates: number[] = []
  for (let i = 1; i < rows.length; i++) {
    const dt = (rows[i].t - rows[i - 1].t) / 1000
    if (!(dt > 0) || dt > 0.5) continue
    const r = source[i]
    if (gyro && finite(r[7]) && finite(r[8]) && finite(r[9])) rates.push(Math.hypot(r[7], r[8], r[9]))
    else rates.push(Math.hypot(rows[i].pitch - rows[i - 1].pitch, rows[i].yaw - rows[i - 1].yaw, rows[i].roll - rows[i - 1].roll) / Math.max(0.001, dt))
  }
  return median(rates) ?? 0
}

export function earMeasures(rec: EarRecording): EarDay {
  const rows = angleRows(rec)
  const steps = Array.isArray(rec?.steps) ? rec.steps.filter((step) => step && finite(step.t0) && finite(step.t1) && step.t1 > step.t0) : []
  const smileSteps = steps.filter((step) => step.ask === 'smile')
  const smileShifts = smileSteps.map((step) => shiftForStep(rows, step)).filter((value): value is number => value !== null && Number.isFinite(value))
  const stillShifts = steps
    .filter((step) => step.ask === 'rest' || step.ask === 'relax')
    .map((step) => driftInStep(rows, step))
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const floor = Math.max(0.5, 3 * (median(stillShifts) ?? 0))
  const smiles = smileShifts.filter((value) => value >= floor).length

  const nod = steps.filter((step) => step.ask === 'nod').map((step) => swingsInStep(rows, step, 'pitch')).filter((value): value is SwingStats => value !== null)
  const shake = steps.filter((step) => step.ask === 'shake').map((step) => swingsInStep(rows, step, 'yaw')).filter((value): value is SwingStats => value !== null)
  const nodDeg = median(nod.map((value) => value.deg))
  const shakeDeg = median(shake.map((value) => value.deg))
  return {
    at: typeof rec?.at === 'string' ? rec.at : '',
    smiles,
    asked: smileSteps.length,
    smileDeg: median(smileShifts),
    nodHz: nodDeg === null ? null : median(nod.map((value) => value.hz)),
    nodDeg,
    shakeHz: shakeDeg === null ? null : median(shake.map((value) => value.hz)),
    shakeDeg,
    moveDegS: motionMedian(rec, rows),
  }
}
