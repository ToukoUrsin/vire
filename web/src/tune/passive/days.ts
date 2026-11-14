// Putting the days together: the ones worked out from the minutes on this device and the ones the server has
// for this device's key (a cleared page keeps only the second). Pure.
import { summarizeDay, summarizeDays, usualOf } from '../../../../shared/earpassive'
import type { DaySummary, PassiveBin, PassiveUsual } from '@shared/earpassive'

/** one summary per day and kind; where both have it, the one with more minutes worn */
export function mergeDays(local: DaySummary[], server: DaySummary[]): DaySummary[] {
  const by = new Map<string, DaySummary>()
  for (const d of [...server, ...local]) {
    const k = `${d.day}|${d.sim ? 's' : 'r'}`
    const have = by.get(k)
    if (!have || d.wornMin >= have.wornMin) by.set(k, d)
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day) || Number(a.sim) - Number(b.sim))
}

export interface DaysNow {
  today: DaySummary | null
  usual: PassiveUsual
  /** earlier days of the same kind with any minutes, whether or not they were long enough for the usual */
  earlier: number
}

/**
 * Today from today's minutes of this kind (a stand-in's or a person's, never both), and the usual from the
 * earlier days of the same kind.
 */
export function daysNow(bins: PassiveBin[], server: DaySummary[], today: string, sim: boolean): DaysNow {
  const mine = bins.filter((b) => (b.shell === 'sim') === sim)
  const all = mergeDays(summarizeDays(mine), server).filter((d) => d.sim === sim)
  return {
    today: summarizeDay(mine.filter((b) => b.day === today)),
    usual: usualOf(all, today, sim),
    earlier: all.filter((d) => d.day < today).length,
  }
}
