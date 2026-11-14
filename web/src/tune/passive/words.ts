// The card's words, kept apart so they can be checked. Pure.
import type { DaySummary, PassiveUsual } from '@shared/earpassive'
import type { PassiveState } from './usePassive'

export const pct = (x: number) => `${Math.round(x * 100)}%`
export function duration(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function headDownSub(usual: PassiveUsual | null): string {
  const u = usual?.m.headDown
  if (!u) return 'no usual yet'
  return usual?.band ? `your usual ${pct(u.median)}` : `your usual so far ${pct(u.median)}`
}

/** where the usual comes from, in one line; with only today, says so */
export function usualLine(state: Pick<PassiveState, 'usual' | 'daysKept' | 'earlier' | 'today'>): string {
  const { usual, daysKept, earlier } = state
  if (!earlier) return 'Only today so far. Your usual starts from your next day with the AirPods.'
  const short = earlier > daysKept ? ` Days under 30 minutes are left out (${earlier - daysKept}).` : ''
  if (!daysKept) return `No day long enough for a usual yet.${short}`
  const from = `Your usual comes from ${plural(daysKept, 'earlier day', 'earlier days')}.`
  return usual?.band ? `${from}${short}` : `${from} Too early for a band.${short}`
}

export function uprightLine(today: DaySummary): string | null {
  if (!today.upright) return null
  return today.upright.from === 'walking'
    ? 'Head down means 20 degrees below how you hold your head when you walk.'
    : 'Head down means 20 degrees below the middle of your day so far. No walk yet to take it from.'
}

