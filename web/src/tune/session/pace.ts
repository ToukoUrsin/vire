// How the sound leads the breath down. It starts near the person's own pace and steps towards six breaths a
// minute. Each pace is held long enough to be read (at least 20 seconds), then the AirPods are asked: did the
// breath go with the sound? If it did, the sound goes slower. If no breath can be read at all, a still head
// counts instead, and that is written down as such. If the breath does not follow twice in a row, the sound
// eases back one step and stays there: that is this person's pace today. Pure.
import type { BreathRead } from '@shared/earsession'

export const PACE_GOAL = 6
export const PACE_DEFAULT = 10
/** the in-breath's share of a breath: out is longer than in */
export const IN_SHARE = 0.4

export function startPace(own: BreathRead | null | undefined): number {
  if (own && own.perMin !== null && own.conf >= 0.5 && own.perMin >= 6) return Math.max(8, Math.min(12, Math.round(own.perMin * 2) / 2))
  return PACE_DEFAULT
}

/** how many breaths at a pace make a stretch long enough to read */
export const breathsAt = (pace: number) => Math.max(2, Math.ceil(20 / (60 / pace)))

export const stepDown = (pace: number) => (pace - 1.5 >= 7 ? pace - 1.5 : Math.max(PACE_GOAL, pace - 1))

export interface Pacer {
  pace: number
  start: number
  /** checks in a row at this pace where the breath did not follow */
  misses: number
  /** the sound eased back and stays here */
  eased: boolean
}

export const newPacer = (start: number): Pacer => ({ pace: start, start, misses: 0, eased: false })

export function decide(p: Pacer, c: { follows: boolean; readable: boolean; still: boolean }): { next: Pacer; by: 'breath' | 'stillness' | 'held' } {
  const by = c.follows ? 'breath' : !c.readable && c.still ? 'stillness' : 'held'
  if (by !== 'held') return { next: { ...p, pace: p.eased ? p.pace : stepDown(p.pace), misses: 0 }, by }
  const misses = p.misses + 1
  if (misses >= 2 && p.pace < p.start && !p.eased) return { next: { ...p, pace: Math.min(p.start, p.pace + 1), misses: 0, eased: true }, by }
  return { next: { ...p, misses }, by }
}
