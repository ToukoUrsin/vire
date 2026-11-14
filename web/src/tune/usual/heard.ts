// The day's minute is done with the camera off, so no camera can say what happened in it. What is known is what
// was asked for, and when. The person's model reads the AirPods through the whole minute, and this counts: of
// the times a thing was asked for, how many did the model say it was happening; and in how many of the still
// moments did it say so anyway. Nothing here teaches the model: it is the model at work on a minute it never saw.
import type { EarEvent, EarModel2, EarRecording, EarStep } from '@shared/ear'
import { createEarReader } from '../ear'

export interface Heard {
  event: EarEvent
  /** how many times it was asked for in the minute */
  asked: number
  /** in how many of those the model said it was happening */
  heard: number
  /** the still moments of the minute, and in how many the model said it was happening */
  still: number
  wrong: number
}

/** the model answers a little after the thing starts (it looks back over a window), so an ask is given this much grace */
const LATE_MS = 900
/** how much of a still step is left out at its start: the thing before it takes a moment to end */
const SETTLE = 0.6

const WANTED: readonly EarEvent[] = ['smile', 'nod', 'shake']
const STILL = new Set<EarStep['ask']>(['rest', 'relax'])

/** Only the things the model may follow on its own (its check passed); the others are not listed. */
export function heardInMinute(model: EarModel2 | null, rec: EarRecording): Heard[] {
  if (!model) return []
  const events = WANTED.filter((e) => model.events[e]?.score.ok)
  if (!events.length || rec.head.length < 20) return []
  const reader = createEarReader(model)
  const said: Array<{ t: number; on: EarEvent[] }> = []
  for (const r of rec.head) {
    const now = reader.push({ t: r[0], pitch: r[1], yaw: r[2], roll: r[3], ax: r[4], ay: r[5], az: r[6], ...(rec.device.gyro ? { rx: r[7], ry: r[8], rz: r[9] } : {}), source: 'airpods' })
    if (now) said.push({ t: r[0], on: now.on })
  }
  const onIn = (e: EarEvent, t0: number, t1: number) => said.some((x) => x.t >= t0 && x.t <= t1 && x.on.includes(e))
  return events.map((event) => {
    const asks = rec.steps.filter((s) => s.ask === event)
    const still = rec.steps.filter((s) => STILL.has(s.ask) && s.t1 - s.t0 >= 1000)
    return {
      event,
      asked: asks.length,
      heard: asks.filter((s) => onIn(event, s.t0, s.t1 + LATE_MS)).length,
      still: still.length,
      wrong: still.filter((s) => onIn(event, s.t0 + (s.t1 - s.t0) * SETTLE, s.t1)).length,
    }
  }).filter((h) => h.asked > 0)
}
